import { connection } from "next/server";
import type { SignUploadResponse } from "@/lib/api/contracts";
import { jsonError, jsonOk, jsonServerError, readJson } from "@/lib/api/http";
import { checkUploadAudio, toAnnouncementState } from "@/lib/announcements/state";
import { requireAdminApi } from "@/lib/auth/session";
import {
  buildAnnouncementObjectPath,
  buildGenreCoverObjectPath,
  buildLogoObjectPath,
  buildTrackObjectPath,
  classifyStorageError,
  dbErrorResponse,
  isImageExtension,
  isLogoExtension,
  sealUploadEnvelope,
  sanitizeOriginalFileName,
} from "@/lib/data/admin/uploads";
import { EnvError } from "@/lib/env";
import { consumeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import type { StorageBucket, TypedSupabaseClient } from "@/lib/supabase/types";
import { createUploadToken } from "@/lib/uploads/token";
import { checkUploadFile, UPLOAD_RULES } from "@/lib/validation/limits";
import { signUploadRequestSchema, type SignUploadRequestInput } from "@/lib/validation/uploads";

/**
 * POST /api/admin/uploads/sign (docs/ARCHITECTURE.md §8, step 2).
 *
 * Checks the declared file (name/size/type) and that the target exists, chooses the object path,
 * creates a Supabase signed upload URL WITH THE ADMIN'S OWN CLIENT (storage INSERT policy) and returns
 * it with an HMAC upload token that /complete trusts. The token (envelope) also carries the original
 * file name; see src/lib/data/admin/uploads.ts.
 */
export const dynamic = "force-dynamic";

const SIGN_RATE_LIMIT = { max: 120, windowSeconds: 600 } as const;

type TargetResolution = { ok: true; path: string; targetId: string | null } | { ok: false; response: Response };

async function resolveTarget(
  supabase: TypedSupabaseClient,
  request: SignUploadRequestInput,
  extension: string,
): Promise<TargetResolution> {
  switch (request.kind) {
    case "track": {
      // New track: its id is chosen now so the object can live under tracks/{trackId}/.
      return { ok: true, path: buildTrackObjectPath(crypto.randomUUID()), targetId: null };
    }
    case "track-replace": {
      const { data, error } = await supabase.from("tracks").select("id").eq("id", request.trackId).maybeSingle();
      if (error) return { ok: false, response: dbErrorResponse("upload sign: track lookup failed", error) };
      if (!data) return { ok: false, response: jsonError(404, "not_found", "This track no longer exists. Refresh the page.") };
      return { ok: true, path: buildTrackObjectPath(data.id), targetId: data.id };
    }
    case "announcement": {
      const { data, error } = await supabase.from("announcements").select("*").eq("id", request.announcementId).maybeSingle();
      if (error) return { ok: false, response: dbErrorResponse("upload sign: announcement lookup failed", error) };
      if (!data) {
        return { ok: false, response: jsonError(404, "not_found", "This announcement no longer exists. Refresh the page.") };
      }
      const gate = checkUploadAudio(toAnnouncementState(data), new Date());
      if (!gate.ok) return { ok: false, response: jsonError(409, "conflict", gate.reason) };
      return { ok: true, path: buildAnnouncementObjectPath(data.business_id, data.id), targetId: data.id };
    }
    case "logo": {
      if (!isLogoExtension(extension)) {
        return { ok: false, response: jsonError(415, "unsupported_media", "Use a PNG, JPEG or WebP image.") };
      }
      const { data, error } = await supabase.from("businesses").select("id").eq("id", request.businessId).maybeSingle();
      if (error) return { ok: false, response: dbErrorResponse("upload sign: venue lookup failed", error) };
      if (!data) return { ok: false, response: jsonError(404, "not_found", "This venue no longer exists. Refresh the page.") };
      return { ok: true, path: buildLogoObjectPath(data.id, extension), targetId: data.id };
    }
    case "genre-cover": {
      if (!isImageExtension(extension)) {
        return { ok: false, response: jsonError(415, "unsupported_media", "Use a PNG, JPEG or WebP image.") };
      }
      const { data, error } = await supabase.from("genres").select("id").eq("id", request.genreId).maybeSingle();
      if (error) return { ok: false, response: dbErrorResponse("upload sign: genre lookup failed", error) };
      if (!data) return { ok: false, response: jsonError(404, "not_found", "This genre no longer exists. Refresh the page.") };
      return { ok: true, path: buildGenreCoverObjectPath(data.id, extension), targetId: data.id };
    }
  }
}

function signedUploadErrorResponse(bucket: StorageBucket, error: unknown): Response {
  switch (classifyStorageError(error)) {
    case "forbidden":
      console.error(`[uploads] storage refused to sign an upload to "${bucket}"`, error);
      return jsonError(
        403,
        "forbidden",
        "File storage refused to create an upload link for your account. Check that the storage policies are installed.",
      );
    case "not_found":
      console.error(`[uploads] storage bucket "${bucket}" is missing`, error);
      return jsonError(503, "unavailable", `The "${bucket}" storage bucket does not exist yet. Apply the storage migration and try again.`);
    case "conflict":
      return jsonError(409, "conflict", "A file already exists at the chosen storage location. Please try again.");
    case "unavailable":
      console.error(`[uploads] storage unavailable while signing an upload to "${bucket}"`, error);
      return jsonError(503, "unavailable", "File storage is temporarily unavailable. Please try again in a moment.");
    default:
      return jsonServerError(`upload sign: createSignedUploadUrl failed for "${bucket}"`, error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireAdminApi();
  if (!access.ok) return access.response;
  const { ctx, supabase } = access;

  try {
    // The rate limiter uses the secret-key client.
    await connection();
    const limit = await consumeRateLimit({ key: `upload-sign:${ctx.userId}`, ...SIGN_RATE_LIMIT, failClosed: false });
    if (!limit.allowed) return rateLimitErrorResponse(limit);

    const body = await readJson(request, signUploadRequestSchema);
    if (!body.ok) return body.response;
    const input = body.data;

    const check = checkUploadFile(input.kind, { name: input.fileName, size: input.fileSize, type: input.contentType });
    if (!check.ok) {
      const status = check.code === "payload_too_large" ? 413 : check.code === "unsupported_media" ? 415 : 400;
      return jsonError(status, check.code, check.message);
    }

    const target = await resolveTarget(supabase, input, check.extension);
    if (!target.ok) return target.response;

    const rule = UPLOAD_RULES[input.kind];
    // Mint the token before touching Storage: a missing secret fails fast with nothing to clean up.
    const uploadToken = sealUploadEnvelope(
      createUploadToken({ kind: input.kind, bucket: rule.bucket, path: target.path, targetId: target.targetId, userId: ctx.userId }),
      sanitizeOriginalFileName(input.fileName),
    );

    let signed: Awaited<ReturnType<ReturnType<TypedSupabaseClient["storage"]["from"]>["createSignedUploadUrl"]>>;
    try {
      signed = await supabase.storage.from(rule.bucket).createSignedUploadUrl(target.path);
    } catch (error) {
      return signedUploadErrorResponse(rule.bucket, error);
    }
    if (signed.error || !signed.data) return signedUploadErrorResponse(rule.bucket, signed.error);

    const response: SignUploadResponse = {
      uploadToken,
      bucket: rule.bucket,
      path: target.path,
      signedUrl: signed.data.signedUrl,
      token: signed.data.token,
      maxBytes: rule.maxBytes,
    };
    return jsonOk(response);
  } catch (error) {
    if (error instanceof EnvError) {
      console.error("[uploads] sign: server configuration is incomplete", error);
      return jsonError(503, "unavailable", "Uploads are not configured on this server yet.");
    }
    return jsonServerError("upload sign failed", error);
  }
}
