import { connection } from "next/server";
import type { GenerateAnnouncementResponse, TtsModelOption, TtsOptionsResponse } from "@/lib/api/contracts";
import { jsonError, jsonOk, jsonServerError, readJson } from "@/lib/api/http";
import { GENERATION_LOCK_MS, checkGenerate, toAnnouncementState } from "@/lib/announcements/state";
import { validateMp3 } from "@/lib/audio/mp3";
import { requireAdminApi, type AdminSessionContext } from "@/lib/auth/session";
import { buildAnnouncementObjectPath, dbErrorResponse, removeStorageObjects } from "@/lib/data/admin/uploads";
import { toAdminAnnouncement } from "@/lib/data/mappers";
import { EnvError } from "@/lib/env";
import { consumeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import {
  describeElevenLabsError,
  ElevenLabsError,
  elevenLabsErrorToApi,
  getElevenLabsClient,
} from "@/lib/tts/elevenlabs";
import { generationHash } from "@/lib/tts/hash";
import { languageDisplayName, normalizeLanguageCode, resolveLanguageForModel } from "@/lib/tts/models";
import { clearTtsOptionsCache, getTtsOptions } from "@/lib/tts/options";
import { idSchema } from "@/lib/validation/fields";
import { MAX_ANNOUNCEMENT_BYTES } from "@/lib/validation/limits";
import { generateAnnouncementRequestSchema, type GenerateAnnouncementRequestInput } from "@/lib/validation/tts";
import type { Tables, TablesUpdate } from "@/types/database";
import { generationFailureStatus, isOnAir, ON_AIR_GENERATE_REASON } from "@/components/admin/announcements/rules";

/**
 * POST /api/admin/announcements/[id]/generate → GenerateAnnouncementResponse (admin only).
 *
 * Generates an announcement's audio ONCE with ElevenLabs (server-side key), validates the MP3 and
 * stores it in the private `announcements` bucket. Playback never calls TTS.
 *
 *  1. The row must not be locked by a running generation (409) and must not be on air (409: on-air
 *     audio is never replaced in place; duplicate it or deactivate it first — see rules.ts).
 *  2. Model, text length and language are checked against the provider's options (400).
 *  3. A request identical to the one that produced the current audio (same generation hash) reuses
 *     it: `reused: true`, no provider call, no credits, no write — unless `force`.
 *  4. Rate limit `tts-generate:{adminId}`, 20 per 10 minutes, FAIL CLOSED (it costs money).
 *  5. Atomic lock: ONE conditional UPDATE sets status `generating`, generation_started_at and
 *     generation_attempts+1 only while the row is still in the state checked above and not locked
 *     (or its lock is stale). Zero rows updated ⇒ 409, so double clicks and parallel tabs never pay
 *     twice.
 *  6. Synthesize → validateMp3 → upload with the secret-key client (upsert false) → one guarded
 *     UPDATE points the row at the new audio (`ready`, approval cleared) → the previous object is
 *     removed only after that.
 *  7. Any failure after the lock releases it honestly: `failed` + last_error when there was no
 *     audio; otherwise the previous status and audio are kept and last_error records the failure.
 *
 * The provider call is not tied to the browser request: if the admin closes the tab, the paid
 * generation still completes and is stored (the page polls while a row is `generating`).
 */
export const dynamic = "force-dynamic";
/** Synthesis (≤ 45 s) + validation + upload must fit in one invocation. */
export const maxDuration = 60;

const GENERATE_RATE_LIMIT = { max: 20, windowSeconds: 600 } as const;
/** Leaves ~15 s of the 60 s budget for validation, upload and the database writes. */
const SYNTHESIS_TIMEOUT_MS = 45_000;
const MAX_LAST_ERROR_LENGTH = 1000;

type AnnouncementRow = Tables<"announcements">;

export async function POST(request: Request, context: RouteContext<"/api/admin/announcements/[id]/generate">): Promise<Response> {
  const access = await requireAdminApi();
  if (!access.ok) return access.response;
  const { ctx, supabase } = access;

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return jsonError(404, "not_found", "This announcement does not exist.");

  try {
    // Uses the secret-key client (rate limit, storage) — never prerender or cache.
    await connection();
    const body = await readJson(request, generateAnnouncementRequestSchema);
    if (!body.ok) return body.response;
    return await generate({ ctx, supabase, id, input: body.data, now: Date.now() });
  } catch (error) {
    if (error instanceof EnvError) {
      console.error("[tts] generate: server configuration is incomplete", error);
      return jsonError(503, "unavailable", "Audio generation is not available: the server configuration is incomplete.");
    }
    return jsonServerError("generate announcement failed", error);
  }
}

interface GenerateRun {
  ctx: AdminSessionContext;
  /** The admin's own client: every database read/write goes through RLS. */
  supabase: TypedSupabaseClient;
  id: string;
  input: GenerateAnnouncementRequestInput;
  now: number;
}

function providerErrorResponse(error: ElevenLabsError): Response {
  const mapped = elevenLabsErrorToApi(error);
  return jsonError(mapped.status, mapped.code, mapped.message, mapped.fields);
}

function clip(text: string): string {
  return text.length > MAX_LAST_ERROR_LENGTH ? `${text.slice(0, MAX_LAST_ERROR_LENGTH - 1)}…` : text;
}

async function generate(run: GenerateRun): Promise<Response> {
  const { supabase, input, now } = run;

  // --- Load and gate ---------------------------------------------------------------------
  const current = await supabase.from("announcements").select("*").eq("id", run.id).maybeSingle();
  if (current.error) return dbErrorResponse("generate: announcement lookup failed", current.error);
  const row = current.data;
  if (!row) return jsonError(404, "not_found", "This announcement no longer exists.");

  const venue = await supabase.from("businesses").select("id, branding_version").eq("id", row.business_id).maybeSingle();
  if (venue.error) return dbErrorResponse("generate: venue lookup failed", venue.error);
  if (!venue.data) return jsonError(404, "not_found", "This announcement's venue no longer exists.");
  const business = { brandingVersion: venue.data.branding_version };

  const lockCheck = checkGenerate(toAnnouncementState(row), now);
  if (!lockCheck.ok) return jsonError(409, "conflict", lockCheck.reason);

  // --- Provider options ---------------------------------------------------------------------
  let options: TtsOptionsResponse;
  try {
    options = await getTtsOptions();
  } catch (error) {
    if (error instanceof ElevenLabsError) return providerErrorResponse(error);
    throw error;
  }
  if (!options.configured) return jsonError(503, "tts_not_configured", options.reason);

  const model = options.models.find((candidate) => candidate.id === input.modelId);
  if (!model) {
    const message = "This model is not available for this ElevenLabs account. Choose another model.";
    return jsonError(400, "invalid_request", message, { modelId: message });
  }

  const spokenText = (row.spoken_text ?? row.text).trim();
  if (!spokenText) return jsonError(400, "invalid_request", "This announcement has no wording to speak. Edit its wording first.");
  if (model.maxCharacters !== null && spokenText.length > model.maxCharacters) {
    return jsonError(
      400,
      "invalid_request",
      `The spoken wording has ${spokenText.length} characters, but ${model.name} accepts at most ${model.maxCharacters} per request. Shorten it or choose another model.`,
    );
  }

  const language = checkLanguage(model, input.languageCode, row.language);
  if (!language.ok) return language.response;

  const voice = options.voices.find((candidate) => candidate.id === input.voiceId);
  const voiceName = voice?.name ?? input.voiceName ?? null;
  const hash = generationHash({ spokenText, voiceId: input.voiceId, modelId: model.id, languageCode: language.providerCode });

  // --- Reuse: same request as the current audio ⇒ no paid call --------------------------------
  if (!input.force && row.generation_hash === hash && row.audio_path !== null && row.source === "tts") {
    const response: GenerateAnnouncementResponse = { announcement: toAdminAnnouncement(row), reused: true };
    return jsonOk(response);
  }

  if (
    isOnAir(
      { status: row.status, needsReview: row.needs_review, approvedAt: row.approved_at, brandingVersion: row.branding_version },
      business,
    )
  ) {
    return jsonError(409, "conflict", ON_AIR_GENERATE_REASON);
  }

  const limit = await consumeRateLimit({ key: `tts-generate:${run.ctx.userId}`, ...GENERATE_RATE_LIMIT, failClosed: true });
  if (!limit.allowed) return rateLimitErrorResponse(limit);

  // --- Atomic lock ------------------------------------------------------------------------
  const lock = await acquireLock(supabase, row, now);
  if (!lock.ok) return lock.response;
  const lockedAt = lock.lockedAt;

  const release = (message: string) => releaseLock(supabase, row, lockedAt, message);

  // --- Synthesize ---------------------------------------------------------------------------
  let audio: Uint8Array;
  try {
    // No retries: a retried timeout or 5xx may be billed twice; the admin can simply try again.
    const result = await getElevenLabsClient({ maxRetries: 0 }).synthesize({
      voiceId: input.voiceId,
      modelId: model.id,
      text: spokenText,
      languageCode: language.providerCode,
      timeoutMs: SYNTHESIS_TIMEOUT_MS,
    });
    audio = result.audio;
    console.info(
      `[tts] generated announcement ${row.id}: model ${model.id}, request ${result.requestId ?? "n/a"}, ` +
        `${result.characterCount ?? spokenText.length} characters, ${audio.byteLength} bytes`,
    );
  } catch (error) {
    if (error instanceof ElevenLabsError) {
      console.warn(`[tts] generate ${row.id}: ElevenLabs ${error.kind} (status ${error.status ?? "none"}, request ${error.requestId ?? "n/a"})`);
      await release(describeElevenLabsError(error));
      // A rejected key or voice means the cached options are out of date.
      if (error.kind === "auth" || error.kind === "voice_not_found") clearTtsOptionsCache();
      return providerErrorResponse(error);
    }
    await release("Generating the audio failed because of an unexpected server error. Try again.");
    throw error;
  }

  const checked = await validateMp3(audio, { maxBytes: MAX_ANNOUNCEMENT_BYTES });
  if (!checked.ok) {
    console.error(`[tts] generate ${row.id}: provider audio rejected (${checked.code})`);
    await release(`ElevenLabs returned audio that cannot be used: ${checked.reason}`);
    return jsonError(502, "tts_failed", `ElevenLabs returned audio that cannot be used: ${checked.reason}`);
  }

  // --- Store --------------------------------------------------------------------------------
  const path = buildAnnouncementObjectPath(row.business_id, row.id);
  let admin: TypedSupabaseClient;
  try {
    admin = createSupabaseAdminClient();
    const stored = await admin.storage.from("announcements").upload(path, audio, {
      contentType: "audio/mpeg",
      cacheControl: "3600",
      upsert: false,
    });
    if (stored.error) throw stored.error;
  } catch (error) {
    console.error(`[tts] generate ${row.id}: storing ${path} failed`, error);
    await release("The audio was generated but could not be saved to storage. Try again.");
    if (error instanceof EnvError) throw error;
    return jsonError(503, "unavailable", "The audio was generated but could not be saved to storage. Please try again.");
  }

  // --- Point the row at the new audio (only if this request still holds the lock) -------------
  const storedLanguage =
    input.languageCode && normalizeLanguageCode(input.languageCode) !== normalizeLanguageCode(row.language) ? input.languageCode : row.language;
  const patch: TablesUpdate<"announcements"> = {
    status: "ready",
    source: "tts",
    audio_path: path,
    audio_duration_seconds: checked.durationSeconds,
    audio_size_bytes: audio.byteLength,
    voice_id: input.voiceId,
    voice_name: voiceName,
    model_id: model.id,
    language: storedLanguage,
    generation_hash: hash,
    generation_started_at: null,
    last_error: null,
    needs_review: false,
    review_reason: null,
    approved_at: null,
    approved_by: null,
  };
  const updated = await supabase
    .from("announcements")
    .update(patch)
    .eq("id", row.id)
    .eq("status", "generating")
    .eq("generation_started_at", lockedAt)
    .select("*")
    .maybeSingle();
  if (updated.error) {
    await removeStorageObjects(admin, "announcements", [path], "generate: row update failed");
    await release("The audio was generated but the announcement could not be updated. Try again.");
    return dbErrorResponse("generate: announcement update failed", updated.error);
  }
  if (!updated.data) {
    // Deleted meanwhile, or the lock went stale and another request took over: this audio is unused.
    await removeStorageObjects(admin, "announcements", [path], "generate: lock lost");
    return jsonError(
      409,
      "conflict",
      "The announcement was changed or deleted while its audio was being generated, so the new audio was discarded. Refresh the page.",
    );
  }

  // The row points at the new audio; only now is the previous object unreferenced.
  if (row.audio_path !== null && row.audio_path !== path) {
    await removeStorageObjects(admin, "announcements", [row.audio_path], "generate: previous audio");
  }

  const response: GenerateAnnouncementResponse = { announcement: toAdminAnnouncement(updated.data), reused: false };
  return jsonOk(response);
}

type LanguageCheck = { ok: true; providerCode: string | undefined } | { ok: false; response: Response };

/**
 * The language must be one the model lists (when it lists any): an explicitly requested code, or
 * otherwise the announcement's own language. Returns the `language_code` to send (never for
 * eleven_multilingual_v2, which detects the language from the text).
 */
function checkLanguage(model: TtsModelOption, requested: string | undefined, announcementLanguage: string): LanguageCheck {
  const desired = requested ?? announcementLanguage;
  const code = normalizeLanguageCode(desired);
  if (model.languages.length > 0 && (!code || !model.languages.some((language) => language.code === code))) {
    const name = code ? languageDisplayName(code) : desired;
    const message = requested
      ? `${model.name} does not support ${name} (“${requested}”). Choose one of the model's languages or another model.`
      : `${model.name} does not support this announcement's language, ${name} (“${announcementLanguage}”). Choose a language or another model.`;
    return { ok: false, response: jsonError(400, "invalid_request", message, { languageCode: message }) };
  }
  return { ok: true, providerCode: resolveLanguageForModel(model, desired) };
}

type LockResult = { ok: true; lockedAt: string } | { ok: false; response: Response };

/**
 * One conditional UPDATE: succeeds only while the row is exactly as checked (same status, audio and
 * attempt count) and not locked by a fresh generation. Concurrent requests serialise on the row
 * lock and re-evaluate these conditions, so at most one of them gets a row back.
 */
async function acquireLock(supabase: TypedSupabaseClient, row: AnnouncementRow, now: number): Promise<LockResult> {
  const staleBefore = new Date(now - GENERATION_LOCK_MS).toISOString();
  let lock = supabase
    .from("announcements")
    .update({
      status: "generating",
      generation_started_at: new Date(now).toISOString(),
      generation_attempts: row.generation_attempts + 1,
    })
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("generation_attempts", row.generation_attempts)
    .or(`status.neq.generating,generation_started_at.is.null,generation_started_at.lt."${staleBefore}"`);
  lock = row.audio_path === null ? lock.is("audio_path", null) : lock.eq("audio_path", row.audio_path);
  const locked = await lock.select("*").maybeSingle();
  if (locked.error) return { ok: false, response: dbErrorResponse("generate: lock failed", locked.error) };
  if (!locked.data || locked.data.generation_started_at === null) {
    return {
      ok: false,
      response: jsonError(
        409,
        "conflict",
        "Audio is already being generated for this announcement, or it changed a moment ago. Wait a moment and refresh the page.",
      ),
    };
  }
  return { ok: true, lockedAt: locked.data.generation_started_at };
}

/**
 * Releases this request's lock after a failure. Without previous audio the row becomes `failed`;
 * with audio, the previous status and audio are kept (rules.ts generationFailureStatus). Never throws.
 */
async function releaseLock(supabase: TypedSupabaseClient, row: AnnouncementRow, lockedAt: string, message: string): Promise<void> {
  const patch: TablesUpdate<"announcements"> = {
    status: generationFailureStatus(row.status, row.audio_path !== null),
    last_error: clip(message),
    generation_started_at: null,
  };
  try {
    const { error } = await supabase
      .from("announcements")
      .update(patch)
      .eq("id", row.id)
      .eq("status", "generating")
      .eq("generation_started_at", lockedAt)
      .select("id")
      .maybeSingle();
    if (error) console.error(`[tts] generate ${row.id}: could not record the failure`, error);
  } catch (error) {
    console.error(`[tts] generate ${row.id}: could not record the failure`, error);
  }
}
