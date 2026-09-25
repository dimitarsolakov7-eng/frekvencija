import { connection } from "next/server";
import type { AdminSessionContext } from "@/lib/auth/session";
import type { CompleteUploadResponse } from "@/lib/api/contracts";
import { jsonError, jsonOk, jsonServerError, readJson } from "@/lib/api/http";
import { CLEARED_AUDIO_FIELDS, checkUploadAudio, toAnnouncementState } from "@/lib/announcements/state";
import { fileNameToTitle, validateMp3, type Mp3Metadata } from "@/lib/audio/mp3";
import { requireAdminApi } from "@/lib/auth/session";
import {
  dbErrorResponse,
  downloadStorageObject,
  IMAGE_CONTENT_TYPE_BY_EXTENSION,
  openUploadEnvelope,
  parseUploadObjectPath,
  pathMatchesTarget,
  removeStorageObjects,
  type ImageExtension,
} from "@/lib/data/admin/uploads";
import { toAdminAnnouncement, toAdminTrack } from "@/lib/data/mappers";
import { EnvError } from "@/lib/env";
import { validateLogo, type LogoValidation } from "@/lib/files/image";
import { signGenreCoverObject, signLogoObject } from "@/lib/media/signing";
import { consumeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { describeUploadTokenFailure, verifyUploadToken, type UploadTokenPayload } from "@/lib/uploads/token";
import { formatBytes, UPLOAD_RULES } from "@/lib/validation/limits";
import { UNKNOWN_ARTIST } from "@/lib/validation/tracks";
import { completeUploadRequestSchema, type CompleteUploadRequestInput } from "@/lib/validation/uploads";
import type { TablesInsert, TablesUpdate } from "@/types/database";

/**
 * POST /api/admin/uploads/complete (docs/ARCHITECTURE.md §8, step 4).
 *
 * Verifies the upload token, downloads the stored object with the secret-key client, validates the
 * bytes (validateMp3 / validateLogo) and only then creates or updates the database row with the
 * ADMIN'S OWN client (RLS). Rules for the stored object:
 * - invalid content, or a target that is gone/changed ⇒ the new object is removed;
 * - a replaced object (track audio, announcement audio, logo, genre cover) is removed only after the
 *   row points at the new one;
 * - a replayed token (the row already points at this path) ⇒ 409 and nothing is touched.
 * Metadata overrides apply to "track" (title, artist, genreIds) and "track-replace" (title, artist);
 * they are ignored for announcements, logos and genre covers.
 */
export const dynamic = "force-dynamic";
/** Downloading and validating up to 50 MB can take a while on a cold function. */
export const maxDuration = 60;

const COMPLETE_RATE_LIMIT = { max: 120, windowSeconds: 600 } as const;

const ALREADY_COMPLETED = "This upload has already been completed.";
const UPLOAD_MISSING = "The upload did not finish; please try again.";

type TrackMetadata = CompleteUploadRequestInput["metadata"];

interface Completion {
  ctx: AdminSessionContext;
  /** The admin's own client: every database read/write goes through RLS. */
  supabase: TypedSupabaseClient;
  /** Secret-key client: only for downloading the object to validate it and for removing objects. */
  admin: TypedSupabaseClient;
  payload: UploadTokenPayload;
  originalFileName: string | null;
  metadata: TrackMetadata;
}

type Step<T> = { ok: true; value: T } | { ok: false; response: Response };

/** Removes the object this upload stored (it is not referenced by any row). */
function discardUpload(c: Completion, reason: string): Promise<boolean> {
  return removeStorageObjects(c.admin, c.payload.bucket, [c.payload.path], `complete ${c.payload.kind}: ${reason}`);
}

async function downloadUpload(c: Completion): Promise<Step<Uint8Array>> {
  const { bucket, path, kind } = c.payload;
  const maxBytes = UPLOAD_RULES[kind].maxBytes;
  const outcome = await downloadStorageObject(c.admin, bucket, path, maxBytes);
  if (outcome.ok) return { ok: true, value: outcome.bytes };
  switch (outcome.reason) {
    case "missing":
      return { ok: false, response: jsonError(404, "not_found", UPLOAD_MISSING) };
    case "too_large":
      await discardUpload(c, "object exceeds the size limit");
      return { ok: false, response: jsonError(415, "unsupported_media", `The file is larger than ${formatBytes(maxBytes)}.`) };
    case "unavailable":
      console.error(`[uploads] complete: storage unavailable while downloading ${bucket}/${path}`, outcome.cause);
      return { ok: false, response: jsonError(503, "unavailable", "File storage is temporarily unavailable. Please try again.") };
    default:
      return { ok: false, response: jsonServerError(`complete: download of ${bucket}/${path} failed`, outcome.cause) };
  }
}

async function validateAudioUpload(c: Completion): Promise<Step<{ audio: Mp3Metadata; sizeBytes: number }>> {
  const download = await downloadUpload(c);
  if (!download.ok) return download;
  const audio = await validateMp3(download.value, { maxBytes: UPLOAD_RULES[c.payload.kind].maxBytes });
  if (!audio.ok) {
    await discardUpload(c, `not a valid MP3 (${audio.code})`);
    return { ok: false, response: jsonError(415, "unsupported_media", audio.reason) };
  }
  return { ok: true, value: { audio, sizeBytes: download.value.byteLength } };
}

async function verifyGenresExist(supabase: TypedSupabaseClient, genreIds: readonly string[]): Promise<Step<null>> {
  const { data, error } = await supabase.from("genres").select("id").in("id", [...genreIds]);
  if (error) return { ok: false, response: dbErrorResponse("complete track: genre lookup failed", error) };
  if ((data ?? []).length !== genreIds.length) {
    return {
      ok: false,
      response: jsonError(400, "invalid_request", "One or more selected genres no longer exist. Refresh the page and choose again.", {
        genreIds: "One or more selected genres no longer exist.",
      }),
    };
  }
  return { ok: true, value: null };
}

function genreAssignmentErrorResponse(error: { code?: string | null; message?: string | null }): Response {
  if (error.code === "23503") {
    return jsonError(400, "invalid_request", "One or more selected genres no longer exist. Refresh the page and choose again.", {
      genreIds: "One or more selected genres no longer exist.",
    });
  }
  return dbErrorResponse("complete track: set_track_genres failed", error);
}

// ---------------------------------------------------------------------------
// track: create a new catalogue row
// ---------------------------------------------------------------------------

async function completeTrack(c: Completion, trackId: string): Promise<Response> {
  const existing = await c.supabase.from("tracks").select("id").eq("id", trackId).maybeSingle();
  // Unknown whether a row references the object, so leave it alone on a lookup failure.
  if (existing.error) return dbErrorResponse("complete track: replay check failed", existing.error);
  if (existing.data) return jsonError(409, "conflict", ALREADY_COMPLETED);

  const genreIds = c.metadata?.genreIds ?? [];
  if (genreIds.length > 0) {
    const genres = await verifyGenresExist(c.supabase, genreIds);
    if (!genres.ok) {
      await discardUpload(c, "genre check failed");
      return genres.response;
    }
  }

  const validated = await validateAudioUpload(c);
  if (!validated.ok) return validated.response;
  const { audio, sizeBytes } = validated.value;

  const insert: TablesInsert<"tracks"> = {
    id: trackId,
    title: c.metadata?.title ?? audio.title ?? fileNameToTitle(c.originalFileName ?? ""),
    artist: c.metadata?.artist ?? audio.artist ?? UNKNOWN_ARTIST,
    duration_seconds: audio.durationSeconds,
    storage_path: c.payload.path,
    file_size_bytes: sizeBytes,
    mime_type: "audio/mpeg",
    bitrate_kbps: audio.bitrateKbps,
    sample_rate_hz: audio.sampleRateHz,
    original_filename: c.originalFileName,
    is_active: true,
    created_by: c.ctx.userId,
  };
  const created = await c.supabase.from("tracks").insert(insert).select("*").single();
  if (created.error || !created.data) {
    // A concurrent completion of the same token created the row: the object is in use.
    if (created.error?.code === "23505") return jsonError(409, "conflict", ALREADY_COMPLETED);
    await discardUpload(c, "track insert failed");
    return created.error
      ? dbErrorResponse("complete track: insert failed", created.error)
      : jsonServerError("complete track: insert returned no row", null);
  }
  const track = created.data;

  if (genreIds.length > 0) {
    const assigned = await c.supabase.rpc("set_track_genres", { p_track_id: track.id, p_genre_ids: [...genreIds] });
    if (assigned.error) {
      // Roll back so the admin can simply retry the whole upload; keep the object if the row stays.
      const removed = await c.supabase.from("tracks").delete().eq("id", track.id);
      if (removed.error) {
        console.error(`[uploads] complete track: could not roll back track ${track.id} after a genre failure`, removed.error);
      } else {
        await discardUpload(c, "genre assignment failed");
      }
      return genreAssignmentErrorResponse(assigned.error);
    }
  }

  const response: CompleteUploadResponse = { kind: "track", track: toAdminTrack(track, genreIds) };
  return jsonOk(response);
}

// ---------------------------------------------------------------------------
// track-replace: point an existing track at new audio
// ---------------------------------------------------------------------------

async function completeTrackReplace(c: Completion, trackId: string): Promise<Response> {
  const { path } = c.payload;
  const current = await c.supabase.from("tracks").select("*").eq("id", trackId).maybeSingle();
  if (current.error) return dbErrorResponse("complete track-replace: track lookup failed", current.error);
  const track = current.data;
  if (!track) {
    await discardUpload(c, "track no longer exists");
    return jsonError(404, "not_found", "This track no longer exists, so the new audio was discarded.");
  }
  if (track.storage_path === path) return jsonError(409, "conflict", ALREADY_COMPLETED);

  // Genres are unchanged by a replacement; read them now so the response is accurate.
  const genres = await c.supabase.from("track_genres").select("genre_id").eq("track_id", track.id);
  if (genres.error) {
    await discardUpload(c, "genre lookup failed");
    return dbErrorResponse("complete track-replace: genre lookup failed", genres.error);
  }
  const genreIds = (genres.data ?? []).map((row) => row.genre_id);

  const validated = await validateAudioUpload(c);
  if (!validated.ok) return validated.response;
  const { audio, sizeBytes } = validated.value;

  const patch: TablesUpdate<"tracks"> = {
    storage_path: path,
    duration_seconds: audio.durationSeconds,
    file_size_bytes: sizeBytes,
    mime_type: "audio/mpeg",
    bitrate_kbps: audio.bitrateKbps,
    sample_rate_hz: audio.sampleRateHz,
    original_filename: c.originalFileName,
    ...(c.metadata?.title !== undefined ? { title: c.metadata.title } : {}),
    ...(c.metadata?.artist !== undefined ? { artist: c.metadata.artist } : {}),
  };
  // Guarded on the path we read, so exactly that object is the one to remove afterwards.
  const updated = await c.supabase
    .from("tracks")
    .update(patch)
    .eq("id", track.id)
    .eq("storage_path", track.storage_path)
    .select("*")
    .maybeSingle();
  if (updated.error) {
    if (updated.error.code === "23505") return jsonError(409, "conflict", ALREADY_COMPLETED);
    await discardUpload(c, "track update failed");
    return dbErrorResponse("complete track-replace: update failed", updated.error);
  }
  if (!updated.data) {
    const now = await c.supabase.from("tracks").select("storage_path").eq("id", track.id).maybeSingle();
    if (!now.error && now.data?.storage_path === path) return jsonError(409, "conflict", ALREADY_COMPLETED);
    if (now.error) {
      console.error("[uploads] complete track-replace: could not re-read the track after a lost update", now.error);
      return jsonError(409, "conflict", "The track changed while the file was uploading. Refresh the page and try again.");
    }
    await discardUpload(c, "track changed during upload");
    return jsonError(409, "conflict", "The track changed or was removed while the file was uploading. Refresh the page and try again.");
  }

  // The row now points at the new object; only now is the previous audio safe to delete.
  await removeStorageObjects(c.admin, "music", [track.storage_path], "complete track-replace: previous audio");

  const response: CompleteUploadResponse = { kind: "track-replace", track: toAdminTrack(updated.data, genreIds) };
  return jsonOk(response);
}

// ---------------------------------------------------------------------------
// announcement: attach uploaded audio (⇒ ready, approval required again)
// ---------------------------------------------------------------------------

async function completeAnnouncement(c: Completion, businessId: string, announcementId: string): Promise<Response> {
  const { path } = c.payload;
  const current = await c.supabase.from("announcements").select("*").eq("id", announcementId).maybeSingle();
  if (current.error) return dbErrorResponse("complete announcement: lookup failed", current.error);
  const row = current.data;
  if (!row) {
    await discardUpload(c, "announcement no longer exists");
    return jsonError(404, "not_found", "This announcement no longer exists, so the audio was discarded.");
  }
  if (row.audio_path === path) return jsonError(409, "conflict", ALREADY_COMPLETED);
  if (row.business_id !== businessId) {
    await discardUpload(c, "announcement moved to another venue");
    return jsonError(409, "conflict", "This announcement changed while the file was uploading. Refresh the page and try again.");
  }
  const gate = checkUploadAudio(toAnnouncementState(row), new Date());
  if (!gate.ok) {
    await discardUpload(c, "generation in progress");
    return jsonError(409, "conflict", gate.reason);
  }

  const validated = await validateAudioUpload(c);
  if (!validated.ok) return validated.response;
  const { audio, sizeBytes } = validated.value;

  const patch: TablesUpdate<"announcements"> = {
    ...CLEARED_AUDIO_FIELDS,
    audio_path: path,
    audio_duration_seconds: audio.durationSeconds,
    audio_size_bytes: sizeBytes,
    source: "upload",
    status: "ready",
    needs_review: false,
    review_reason: null,
    approved_at: null,
    approved_by: null,
    generation_hash: null,
    generation_started_at: null,
    voice_id: null,
    voice_name: null,
    model_id: null,
    last_error: null,
  };
  // Guarded on the state we checked: a generation that started (or another upload that finished)
  // while this file was being validated makes the update match nothing.
  let update = c.supabase.from("announcements").update(patch).eq("id", row.id).eq("status", row.status);
  update = row.audio_path === null ? update.is("audio_path", null) : update.eq("audio_path", row.audio_path);
  update =
    row.generation_started_at === null
      ? update.is("generation_started_at", null)
      : update.eq("generation_started_at", row.generation_started_at);
  const updated = await update.select("*").maybeSingle();
  if (updated.error) {
    await discardUpload(c, "announcement update failed");
    return dbErrorResponse("complete announcement: update failed", updated.error);
  }
  if (!updated.data) {
    const now = await c.supabase.from("announcements").select("audio_path").eq("id", row.id).maybeSingle();
    if (!now.error && now.data?.audio_path === path) return jsonError(409, "conflict", ALREADY_COMPLETED);
    if (now.error) {
      console.error("[uploads] complete announcement: could not re-read the row after a lost update", now.error);
    } else {
      await discardUpload(c, "announcement changed during upload");
    }
    return jsonError(
      409,
      "conflict",
      "The announcement changed while the file was uploading (for example, audio generation started). Refresh the page and try again.",
    );
  }

  if (row.audio_path !== null) {
    await removeStorageObjects(c.admin, "announcements", [row.audio_path], "complete announcement: previous audio");
  }

  const response: CompleteUploadResponse = { kind: "announcement", announcement: toAdminAnnouncement(updated.data) };
  return jsonOk(response);
}

// ---------------------------------------------------------------------------
// logo: swap the venue logo
// ---------------------------------------------------------------------------

async function completeLogo(c: Completion, businessId: string, extension: ImageExtension): Promise<Response> {
  const { path } = c.payload;
  const current = await c.supabase.from("businesses").select("id, logo_path").eq("id", businessId).maybeSingle();
  if (current.error) return dbErrorResponse("complete logo: venue lookup failed", current.error);
  const business = current.data;
  if (!business) {
    await discardUpload(c, "venue no longer exists");
    return jsonError(404, "not_found", "This venue no longer exists, so the logo was discarded.");
  }
  if (business.logo_path === path) return jsonError(409, "conflict", ALREADY_COMPLETED);

  const download = await downloadUpload(c);
  if (!download.ok) return download.response;
  const logo = validateLogo(download.value, IMAGE_CONTENT_TYPE_BY_EXTENSION[extension], { maxBytes: UPLOAD_RULES.logo.maxBytes });
  if (!logo.ok) {
    await discardUpload(c, `not a valid logo (${logo.code})`);
    return jsonError(415, "unsupported_media", logo.reason);
  }

  const base = c.supabase.from("businesses").update({ logo_path: path }).eq("id", business.id);
  const guarded = business.logo_path === null ? base.is("logo_path", null) : base.eq("logo_path", business.logo_path);
  const updated = await guarded.select("id, logo_path").maybeSingle();
  if (updated.error) {
    await discardUpload(c, "venue update failed");
    return dbErrorResponse("complete logo: update failed", updated.error);
  }
  if (!updated.data) {
    const now = await c.supabase.from("businesses").select("logo_path").eq("id", business.id).maybeSingle();
    if (!now.error && now.data?.logo_path === path) return jsonError(409, "conflict", ALREADY_COMPLETED);
    if (now.error) {
      console.error("[uploads] complete logo: could not re-read the venue after a lost update", now.error);
    } else {
      await discardUpload(c, "logo changed during upload");
    }
    return jsonError(409, "conflict", "The venue's logo changed while the file was uploading. Refresh the page and try again.");
  }

  if (business.logo_path !== null) {
    await removeStorageObjects(c.admin, "logos", [business.logo_path], "complete logo: previous logo");
  }

  let logoUrl: string;
  try {
    logoUrl = (await signLogoObject(c.supabase, path)).url;
  } catch (error) {
    console.error(`[uploads] complete logo: saved ${path} but could not sign a preview URL`, error);
    return jsonError(500, "server_error", "The logo was saved, but its preview link could not be created. Refresh the page to see it.");
  }

  const response: CompleteUploadResponse = { kind: "logo", businessId: business.id, logoPath: path, logoUrl };
  return jsonOk(response);
}

// ---------------------------------------------------------------------------
// genre-cover: swap a genre's cover image
// ---------------------------------------------------------------------------

/** validateLogo() words its size message for logos; say "genre covers" instead. */
function coverRejectionReason(result: Extract<LogoValidation, { ok: false }>, bytes: number, maxBytes: number): string {
  if (result.code === "too_large") {
    return `The image is ${formatBytes(bytes)}; genre covers can be at most ${formatBytes(maxBytes)}.`;
  }
  return result.reason;
}

async function completeGenreCover(c: Completion, genreId: string, extension: ImageExtension): Promise<Response> {
  const { path } = c.payload;
  const current = await c.supabase.from("genres").select("id, cover_path").eq("id", genreId).maybeSingle();
  if (current.error) return dbErrorResponse("complete genre-cover: genre lookup failed", current.error);
  const genre = current.data;
  if (!genre) {
    await discardUpload(c, "genre no longer exists");
    return jsonError(404, "not_found", "This genre no longer exists, so the cover was discarded.");
  }
  if (genre.cover_path === path) return jsonError(409, "conflict", ALREADY_COMPLETED);

  const download = await downloadUpload(c);
  if (!download.ok) return download.response;
  const maxBytes = UPLOAD_RULES["genre-cover"].maxBytes;
  // Same content rules as logos: PNG, JPEG or WebP by magic bytes, matching the signed extension.
  const image = validateLogo(download.value, IMAGE_CONTENT_TYPE_BY_EXTENSION[extension], { maxBytes });
  if (!image.ok) {
    await discardUpload(c, `not a valid cover image (${image.code})`);
    return jsonError(415, "unsupported_media", coverRejectionReason(image, download.value.byteLength, maxBytes));
  }

  // Guarded on the cover we read, so exactly that object is the one to remove afterwards.
  const base = c.supabase.from("genres").update({ cover_path: path }).eq("id", genre.id);
  const guarded = genre.cover_path === null ? base.is("cover_path", null) : base.eq("cover_path", genre.cover_path);
  const updated = await guarded.select("id, cover_path").maybeSingle();
  if (updated.error) {
    await discardUpload(c, "genre update failed");
    return dbErrorResponse("complete genre-cover: update failed", updated.error);
  }
  if (!updated.data) {
    const now = await c.supabase.from("genres").select("cover_path").eq("id", genre.id).maybeSingle();
    if (!now.error && now.data?.cover_path === path) return jsonError(409, "conflict", ALREADY_COMPLETED);
    if (now.error) {
      console.error("[uploads] complete genre-cover: could not re-read the genre after a lost update", now.error);
    } else {
      await discardUpload(c, now.data ? "cover changed during upload" : "genre deleted during upload");
    }
    return jsonError(409, "conflict", "The genre changed while the cover was uploading. Refresh the page and try again.");
  }

  // The row now points at the new object; only now is the previous cover safe to delete.
  if (genre.cover_path !== null) {
    await removeStorageObjects(c.admin, "genre-covers", [genre.cover_path], "complete genre-cover: previous cover");
  }

  let coverUrl: string;
  try {
    // The admin's own client: the "genre-covers: admin select" storage policy covers it.
    coverUrl = (await signGenreCoverObject(c.supabase, path)).url;
  } catch (error) {
    console.error(`[uploads] complete genre-cover: saved ${path} but could not sign a preview URL`, error);
    return jsonError(500, "server_error", "The cover was saved, but its preview link could not be created. Refresh the page to see it.");
  }

  const response: CompleteUploadResponse = { kind: "genre-cover", genreId: genre.id, coverPath: path, coverUrl };
  return jsonOk(response);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const access = await requireAdminApi();
  if (!access.ok) return access.response;
  const { ctx, supabase } = access;

  try {
    // This handler uses the secret-key client (download, cleanup, rate limit).
    await connection();
    const limit = await consumeRateLimit({ key: `upload-complete:${ctx.userId}`, ...COMPLETE_RATE_LIMIT, failClosed: false });
    if (!limit.allowed) return rateLimitErrorResponse(limit);

    const body = await readJson(request, completeUploadRequestSchema);
    if (!body.ok) return body.response;

    const envelope = openUploadEnvelope(body.data.uploadToken);
    if (!envelope.ok) return jsonError(400, "invalid_request", describeUploadTokenFailure(envelope.reason));

    const verified = verifyUploadToken(envelope.uploadToken, { expectedUserId: ctx.userId });
    if (!verified.ok) {
      const status = verified.reason === "user_mismatch" ? 403 : 400;
      return jsonError(status, status === 403 ? "forbidden" : "invalid_request", describeUploadTokenFailure(verified.reason));
    }
    const payload = verified.payload;
    const parts = parseUploadObjectPath(payload.kind, payload.path);
    if (!parts || !pathMatchesTarget(parts, payload.targetId)) {
      return jsonError(400, "invalid_request", describeUploadTokenFailure("invalid_payload"));
    }

    const completion: Completion = {
      ctx,
      supabase,
      admin: createSupabaseAdminClient(),
      payload,
      originalFileName: envelope.originalFileName,
      metadata: body.data.metadata,
    };

    switch (parts.kind) {
      case "track":
        return await completeTrack(completion, parts.trackId);
      case "track-replace":
        return await completeTrackReplace(completion, parts.trackId);
      case "announcement":
        return await completeAnnouncement(completion, parts.businessId, parts.announcementId);
      case "logo":
        return await completeLogo(completion, parts.businessId, parts.extension);
      case "genre-cover":
        return await completeGenreCover(completion, parts.genreId, parts.extension);
    }
  } catch (error) {
    if (error instanceof EnvError) {
      console.error("[uploads] complete: server configuration is incomplete", error);
      return jsonError(503, "unavailable", "Uploads are not configured on this server yet.");
    }
    return jsonServerError("upload complete failed", error);
  }
}
