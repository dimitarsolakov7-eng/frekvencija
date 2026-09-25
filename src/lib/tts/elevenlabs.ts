/**
 * Minimal server-only ElevenLabs REST client (plain fetch, no SDK). Verified against the live API and
 * the OpenAPI spec in docs/research/elevenlabs.md §12; error handling follows §4 of that note.
 *
 * The API key only ever travels in the `xi-api-key` request header. It is never logged, and any echo
 * of it in a provider message is redacted before the message is stored on an error.
 */
import "server-only";
import { z } from "zod";
import type { ApiErrorCode } from "@/lib/api/contracts";
import { getServerEnv } from "@/lib/env";
import { DEFAULT_OUTPUT_FORMAT, modelAcceptsLanguageCode } from "./models";

export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";

/** Every value accepted by `output_format` (OpenAPI enum, 2026-09). */
export const OUTPUT_FORMATS = [
  "alaw_8000",
  "mp3_22050_32", "mp3_24000_48", "mp3_44100_32", "mp3_44100_64", "mp3_44100_96",
  "mp3_44100_128", // default; allowed on every plan
  "mp3_44100_192", // Creator tier or above
  "opus_48000_32", "opus_48000_64", "opus_48000_96", "opus_48000_128", "opus_48000_192",
  "pcm_8000", "pcm_16000", "pcm_22050", "pcm_24000", "pcm_32000",
  "pcm_44100", // Pro tier or above
  "pcm_48000",
  "ulaw_8000",
  "wav_8000", "wav_16000", "wav_22050", "wav_24000", "wav_32000",
  "wav_44100", // Pro tier or above
  "wav_48000",
] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const LISTING_TIMEOUT_MS = 15_000;
const TTS_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_MAX_VOICE_PAGES = 10;
const MAX_ERROR_MESSAGE_LENGTH = 500;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ElevenLabsErrorKind =
  | "auth" // bad/missing/expired key, missing key scope, IP allowlist (401/403, 404 workspace_not_found)
  | "quota" // out of credits, or the plan/tier does not allow this voice/format (402, legacy 401 quota_exceeded)
  | "rate_limited" // 429: concurrency limit, rate limit, system_busy
  | "validation" // 400/422: bad text, voice settings, model, language_code, text too long
  | "voice_not_found" // voice id unknown or not accessible to this account
  | "provider_unavailable" // 5xx/408, network failure, unexpected non-audio 200
  | "timeout" // our deadline fired (connect, headers or body)
  | "not_configured"; // no ELEVENLABS_API_KEY on this server

export class ElevenLabsError extends Error {
  readonly kind: ElevenLabsErrorKind;
  /** HTTP status of the provider response, or null when there was none (network, timeout, config). */
  readonly status: number | null;
  /** `detail.code` (current format) or `detail.status` (legacy format). */
  readonly providerCode: string | null;
  /** Provider request id (`request-id` header or `detail.request_id`) for support tickets. */
  readonly requestId: string | null;
  /** Parsed `Retry-After`, when the provider sent one. */
  readonly retryAfterMs: number | null;

  constructor(
    kind: ElevenLabsErrorKind,
    message: string,
    extra: {
      status?: number | null;
      providerCode?: string | null;
      requestId?: string | null;
      retryAfterMs?: number | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = "ElevenLabsError";
    this.kind = kind;
    this.status = extra.status ?? null;
    this.providerCode = extra.providerCode ?? null;
    this.requestId = extra.requestId ?? null;
    this.retryAfterMs = extra.retryAfterMs ?? null;
  }

  /** Worth retrying later with backoff (never auth/quota/validation/voice_not_found/not_configured). */
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "provider_unavailable" || this.kind === "timeout";
  }
}

const hasToken = (tokens: readonly string[], ...wanted: string[]) => tokens.some((token) => wanted.includes(token));

/**
 * Maps a provider error to a kind. `tokens` are the lower-cased `detail.type/code/status` values;
 * `voiceScoped` means the URL contained a voice id. Order matters: quota errors arrive as 401, so
 * they are recognised before the generic auth rule.
 */
export function classifyElevenLabsError(
  status: number,
  tokens: readonly string[],
  message: string,
  voiceScoped: boolean,
): Exclude<ElevenLabsErrorKind, "timeout" | "not_configured"> {
  const text = message.toLowerCase();
  if (hasToken(tokens, "voice_not_found", "voice_does_not_exist", "voice_access_denied")) return "voice_not_found";
  if (hasToken(tokens, "model_not_found", "unsupported_model", "model_access_denied")) return "validation";
  if (
    status === 402 ||
    hasToken(tokens, "quota_exceeded", "insufficient_credits", "payment_required", "subscription_required", "feature_not_available") ||
    /quota|credits|upgrade your subscription|tier or above/.test(text)
  ) {
    return "quota";
  }
  if (
    status === 429 ||
    hasToken(tokens, "too_many_concurrent_requests", "concurrent_limit_exceeded", "rate_limit_exceeded", "rate_limit_error", "system_busy")
  ) {
    return "rate_limited";
  }
  if (
    status === 401 ||
    status === 403 ||
    hasToken(
      tokens,
      "authentication_error",
      "authorization_error",
      "invalid_api_key",
      "missing_api_key",
      "needs_authorization",
      "missing_permissions",
      "unauthorized",
      "workspace_not_found",
    )
  ) {
    return "auth";
  }
  if (status === 404) return voiceScoped ? "voice_not_found" : "provider_unavailable";
  if (status === 408 || status >= 500) return "provider_unavailable";
  return "validation"; // 400, 409, 413, 422 and other 4xx
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function clip(text: string, max = MAX_ERROR_MESSAGE_LENGTH): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function errorFromResponse(res: Response, voiceScoped: boolean, redact: (text: string) => string): Promise<ElevenLabsError> {
  const raw = await res.text().catch(() => "");
  let detail: unknown;
  try {
    detail = (JSON.parse(raw) as { detail?: unknown }).detail;
  } catch {
    detail = undefined;
  }

  const tokens: string[] = [];
  let providerCode: string | null = null;
  let bodyRequestId: string | null = null;
  // HTML error pages (proxies, 503 maintenance) carry nothing useful for the admin.
  let message = raw.trim() && !raw.trimStart().startsWith("<") ? raw.trim() : `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;

  if (Array.isArray(detail)) {
    // FastAPI/pydantic 422: [{ type, loc: ["body","voice_settings","stability"], msg, input, ctx }]
    tokens.push("validation_error");
    providerCode = "validation_error";
    message = detail
      .map((item: unknown) => {
        const entry = (item ?? {}) as { loc?: unknown; msg?: unknown };
        const location = Array.isArray(entry.loc) ? entry.loc.join(".") : "request";
        return `${location}: ${typeof entry.msg === "string" ? entry.msg : "invalid"}`;
      })
      .join("; ");
  } else if (detail && typeof detail === "object") {
    // Current: { type, code, message, status (legacy mirror), request_id, param }; legacy: { status, message }
    const d = detail as Record<string, unknown>;
    for (const key of ["type", "code", "status"] as const) {
      const value = d[key];
      if (typeof value === "string") tokens.push(value.toLowerCase());
    }
    providerCode = typeof d.code === "string" ? d.code : typeof d.status === "string" ? d.status : null;
    if (typeof d.message === "string") message = d.message;
    if (typeof d.request_id === "string") bodyRequestId = d.request_id;
  } else if (typeof detail === "string") {
    message = detail;
  }

  const kind = classifyElevenLabsError(res.status, tokens, message, voiceScoped);
  return new ElevenLabsError(kind, redact(clip(`ElevenLabs ${res.status}${providerCode ? ` (${providerCode})` : ""}: ${message}`)), {
    status: res.status,
    providerCode,
    requestId: res.headers.get("request-id") ?? bodyRequestId ?? res.headers.get("x-trace-id"),
    retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
  });
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface ElevenLabsClientOptions {
  apiKey: string;
  /** e.g. "https://api.us.elevenlabs.io" to pin the US region. */
  baseUrl?: string;
  /** Injectable for tests. Defaults to the global fetch at call time. */
  fetch?: typeof fetch;
  /** Retries for retryable failures (see `retryable`); synthesis only retries 429s. Default 2. */
  maxRetries?: number;
  /** Injectable backoff sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface CallOptions {
  timeoutMs?: number;
  /** Caller cancellation: re-thrown as-is (not classified). */
  signal?: AbortSignal;
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

interface RequestSpec {
  method: "GET" | "POST";
  path: string;
  query?: Query;
  body?: unknown;
  voiceScoped?: boolean;
}

interface Transport {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  maxRetries: number;
  sleep: (ms: number) => Promise<void>;
  redact: (text: string) => string;
}

function buildUrl(base: string, path: string, query?: Query): string {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item)); // repeated-key arrays
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * One HTTP attempt: fetch + body read under ONE deadline, so a stalled audio body also times out.
 * `read` must consume the body inside this call.
 */
async function attempt<T>(t: Transport, spec: RequestSpec, co: CallOptions, timeoutMs: number, read: (res: Response) => Promise<T>): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = co.signal ? AbortSignal.any([timeout, co.signal]) : timeout;
  const doFetch = t.fetch ?? fetch;
  try {
    const res = await doFetch(buildUrl(t.baseUrl, spec.path, spec.query), {
      method: spec.method,
      headers: {
        "xi-api-key": t.apiKey,
        ...(spec.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      signal,
      cache: "no-store", // Next.js: never keep provider responses in the Data Cache
    });
    if (!res.ok) throw await errorFromResponse(res, spec.voiceScoped ?? false, t.redact);
    return await read(res);
  } catch (error) {
    if (error instanceof ElevenLabsError) throw error;
    if (co.signal?.aborted) throw co.signal.reason ?? error;
    if (timeout.aborted) {
      const limit = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} s` : `${timeoutMs} ms`;
      throw new ElevenLabsError("timeout", `ElevenLabs did not respond within ${limit}.`, { cause: error });
    }
    throw new ElevenLabsError("provider_unavailable", "Network error while contacting ElevenLabs.", { cause: error });
  }
}

async function request<T>(
  t: Transport,
  spec: RequestSpec,
  co: CallOptions,
  defaultTimeoutMs: number,
  shouldRetry: (error: ElevenLabsError) => boolean,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  for (let attemptIndex = 0; ; attemptIndex++) {
    try {
      return await attempt(t, spec, co, co.timeoutMs ?? defaultTimeoutMs, read);
    } catch (error) {
      if (!(error instanceof ElevenLabsError) || attemptIndex >= t.maxRetries || !shouldRetry(error) || co.signal?.aborted) {
        throw error;
      }
      const backoff = error.retryAfterMs ?? 500 * 2 ** attemptIndex;
      await t.sleep(Math.min(backoff, MAX_RETRY_DELAY_MS));
    }
  }
}

// ---------------------------------------------------------------------------
// Response schemas (lenient: only what we use; unknown keys are stripped)
// ---------------------------------------------------------------------------

const ModelSchema = z.object({
  model_id: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  can_do_text_to_speech: z.boolean().nullish(),
  requires_alpha_access: z.boolean().nullish(),
  can_use_style: z.boolean().nullish(),
  can_use_speaker_boost: z.boolean().nullish(),
  maximum_text_length_per_request: z.number().nullish(),
  languages: z.array(z.object({ language_id: z.string(), name: z.string() })).nullish(),
  model_rates: z.object({ character_cost_multiplier: z.number() }).nullish(),
});

const VoiceSchema = z.object({
  voice_id: z.string(),
  name: z.string().nullish(),
  category: z.string().nullish(), // generated | cloned | premade | professional | famous | high_quality
  description: z.string().nullish(),
  labels: z.record(z.string(), z.string()).nullish(), // accent, gender, age, language, use_case, ...
  preview_url: z.string().nullish(),
  verified_languages: z
    .array(
      z.object({
        language: z.string(),
        model_id: z.string(),
        accent: z.string().nullish(),
        locale: z.string().nullish(),
      }),
    )
    .nullish(),
});

const VoicesPageSchema = z.object({
  voices: z.array(VoiceSchema),
  has_more: z.boolean(),
  next_page_token: z.string().nullish(),
});

const SubscriptionSchema = z.object({
  tier: z.string(),
  status: z.string(),
  character_count: z.number(),
  character_limit: z.number(),
  next_character_count_reset_unix: z.number().nullish(),
});

async function parseJson<S extends z.ZodType>(res: Response, schema: S): Promise<z.output<S>> {
  // Read as text first: an abort while reading must propagate unwrapped so it is classified as a timeout.
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ElevenLabsError("provider_unavailable", "ElevenLabs returned a response that is not valid JSON.", { status: res.status });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ElevenLabsError("provider_unavailable", `Unexpected ElevenLabs response shape: ${clip(parsed.error.message, 300)}`, {
      status: res.status,
    });
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TtsModel {
  modelId: string;
  name: string;
  description: string | null;
  /** `language_id` values as returned by /v1/models, with their names. */
  languages: { id: string; name: string }[];
  maxTextLength: number | null;
  costMultiplier: number | null;
  canUseStyle: boolean;
  canUseSpeakerBoost: boolean;
}

export interface Voice {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  labels: Record<string, string>;
  previewUrl: string | null;
  verifiedLanguages: { language: string; modelId: string; accent: string | null; locale: string | null }[];
}

export interface VoiceSettings {
  /** 0..1 (422 outside); eleven_v3 reportedly only accepts 0, 0.5 or 1. */
  stability?: number;
  /** 0..1 (422 outside). */
  similarity_boost?: number;
  /** 0..1 by convention; values above 0 add latency. */
  style?: number;
  use_speaker_boost?: boolean;
  /** 0.7..1.2 per the best-practices doc. */
  speed?: number;
}

export interface Subscription {
  tier: string;
  status: string;
  characterCount: number;
  characterLimit: number;
  nextResetUnix: number | null;
}

export interface SynthesizeInput extends CallOptions {
  voiceId: string;
  modelId: string;
  text: string;
  /** ISO 639-1. Never sent to eleven_multilingual_v2; use resolveLanguageForModel() to choose it. */
  languageCode?: string;
  voiceSettings?: VoiceSettings;
  outputFormat?: OutputFormat;
  /** 0..4294967295, best-effort determinism only. */
  seed?: number;
  applyTextNormalization?: "auto" | "on" | "off";
}

export interface SynthesizeResult {
  audio: Uint8Array;
  contentType: string;
  requestId: string | null;
  /** Characters billed, when the provider reports it. */
  characterCount: number | null;
}

export interface ElevenLabsClient {
  /** GET /v1/models → text-to-speech capable models that need no alpha access. */
  listModels(options?: CallOptions): Promise<TtsModel[]>;
  /** GET /v2/voices, following next_page_token for at most `maxPages` pages of 100 (default 10). */
  listVoices(options?: CallOptions & { search?: string; maxPages?: number }): Promise<Voice[]>;
  /** GET /v1/user/subscription (the key needs the user_read scope). */
  getSubscription(options?: CallOptions): Promise<Subscription>;
  /** POST /v1/text-to-speech/{voice_id}?output_format=… → the whole audio file in memory. */
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
}

/** Builds the JSON body sent to the TTS endpoint. Exported so the request can be inspected in tests. */
export function buildSynthesizeBody(input: Omit<SynthesizeInput, "voiceId" | "outputFormat" | "timeoutMs" | "signal">): Record<string, unknown> {
  const body: Record<string, unknown> = { text: input.text.trim(), model_id: input.modelId };
  if (input.languageCode && modelAcceptsLanguageCode(input.modelId)) body.language_code = input.languageCode;
  if (input.voiceSettings) body.voice_settings = input.voiceSettings;
  if (input.seed !== undefined) body.seed = input.seed;
  if (input.applyTextNormalization) body.apply_text_normalization = input.applyTextNormalization;
  return body;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createElevenLabsClient(options: ElevenLabsClientOptions): ElevenLabsClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new ElevenLabsError("not_configured", "ElevenLabs is not configured: ELEVENLABS_API_KEY is not set.");
  }
  const transport: Transport = {
    apiKey,
    baseUrl: options.baseUrl ?? ELEVENLABS_BASE_URL,
    fetch: options.fetch,
    maxRetries: Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES)),
    sleep: options.sleep ?? defaultSleep,
    redact: (text) => text.split(apiKey).join("[redacted]"),
  };
  const retryListing = (error: ElevenLabsError) => error.retryable;
  // A 429 means nothing was generated, so retrying cannot bill twice. Timeouts and 5xx might have
  // been processed (and charged) upstream, so synthesis leaves those to the admin.
  const retrySynthesis = (error: ElevenLabsError) => error.kind === "rate_limited";

  return {
    async listModels(co = {}) {
      const models = await request(transport, { method: "GET", path: "/v1/models" }, co, LISTING_TIMEOUT_MS, retryListing, (res) =>
        parseJson(res, z.array(ModelSchema)),
      );
      return models
        .filter((model) => model.can_do_text_to_speech === true && model.requires_alpha_access !== true)
        .map((model) => ({
          modelId: model.model_id,
          name: model.name?.trim() || model.model_id,
          description: model.description?.trim() || null,
          languages: (model.languages ?? []).map((language) => ({ id: language.language_id, name: language.name })),
          maxTextLength: model.maximum_text_length_per_request ?? null,
          costMultiplier: model.model_rates?.character_cost_multiplier ?? null,
          canUseStyle: model.can_use_style === true,
          canUseSpeakerBoost: model.can_use_speaker_boost === true,
        }));
    },

    async listVoices(co = {}) {
      const maxPages = Math.max(1, Math.floor(co.maxPages ?? DEFAULT_MAX_VOICE_PAGES));
      const voices: Voice[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < maxPages; page++) {
        const data = await request(
          transport,
          {
            method: "GET",
            path: "/v2/voices",
            query: { page_size: 100, include_total_count: false, search: co.search, next_page_token: pageToken },
          },
          co,
          LISTING_TIMEOUT_MS,
          retryListing,
          (res) => parseJson(res, VoicesPageSchema),
        );
        for (const voice of data.voices) {
          voices.push({
            voiceId: voice.voice_id,
            name: voice.name?.trim() || voice.voice_id,
            category: voice.category ?? null,
            description: voice.description?.trim() || null,
            labels: voice.labels ?? {},
            previewUrl: voice.preview_url ?? null,
            verifiedLanguages: (voice.verified_languages ?? []).map((language) => ({
              language: language.language,
              modelId: language.model_id,
              accent: language.accent ?? null,
              locale: language.locale ?? null,
            })),
          });
        }
        if (!data.has_more || !data.next_page_token) break;
        pageToken = data.next_page_token;
      }
      return voices;
    },

    async getSubscription(co = {}) {
      const data = await request(transport, { method: "GET", path: "/v1/user/subscription" }, co, LISTING_TIMEOUT_MS, retryListing, (res) =>
        parseJson(res, SubscriptionSchema),
      );
      return {
        tier: data.tier,
        status: data.status,
        characterCount: data.character_count,
        characterLimit: data.character_limit,
        nextResetUnix: data.next_character_count_reset_unix ?? null,
      };
    },

    async synthesize(input) {
      const body = buildSynthesizeBody(input);
      if (!body.text) throw new ElevenLabsError("validation", "There is no text to speak.");
      const outputFormat = input.outputFormat ?? DEFAULT_OUTPUT_FORMAT;

      return request(
        transport,
        {
          method: "POST",
          path: `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`,
          query: { output_format: outputFormat },
          body,
          voiceScoped: true,
        },
        { timeoutMs: input.timeoutMs, signal: input.signal },
        TTS_TIMEOUT_MS,
        retrySynthesis,
        async (res) => {
          const contentType = res.headers.get("content-type") ?? "";
          const requestId = res.headers.get("request-id");
          if (!contentType.startsWith("audio/") && !contentType.startsWith("application/octet-stream")) {
            throw new ElevenLabsError("provider_unavailable", `ElevenLabs returned "${contentType || "no content type"}" instead of audio.`, {
              status: res.status,
              requestId,
            });
          }
          const audio = new Uint8Array(await res.arrayBuffer());
          if (audio.byteLength === 0) {
            throw new ElevenLabsError("provider_unavailable", "ElevenLabs returned empty audio.", { status: res.status, requestId });
          }
          const cost = res.headers.get("character-cost") ?? res.headers.get("x-character-count");
          const characterCount = cost !== null && cost.trim() !== "" && Number.isFinite(Number(cost)) ? Number(cost) : null;
          return { audio, contentType, requestId, characterCount };
        },
      );
    },
  };
}

/**
 * Client built from ELEVENLABS_API_KEY. Throws `ElevenLabsError("not_configured")` when the key is
 * missing; check `isTtsConfigured()` first to show a "not configured" state instead.
 */
export function getElevenLabsClient(overrides: Omit<ElevenLabsClientOptions, "apiKey"> = {}): ElevenLabsClient {
  return createElevenLabsClient({ ...overrides, apiKey: getServerEnv().elevenLabsApiKey ?? "" });
}

// ---------------------------------------------------------------------------
// Mapping for route handlers / server actions
// ---------------------------------------------------------------------------

/**
 * Honest admin-facing explanation, suitable for `announcements.last_error` (≤ 1000 characters) and
 * API error messages. Includes the provider request id when there is one.
 */
export function describeElevenLabsError(error: ElevenLabsError): string {
  const providerDetail = error.message.replace(/^ElevenLabs \d{3}( \([^)]*\))?: /, "");
  let text: string;
  switch (error.kind) {
    case "not_configured":
      text = "Text-to-speech is not configured on the server (ELEVENLABS_API_KEY is missing).";
      break;
    case "auth":
      text =
        "ElevenLabs rejected the API key or its permissions. Check ELEVENLABS_API_KEY; the key needs " +
        "text-to-speech, voices (read) and models (read) access.";
      break;
    case "quota":
      text = `ElevenLabs refused the request because of the account's plan or remaining credits: ${providerDetail}`;
      break;
    case "rate_limited":
      text = "ElevenLabs is handling too many requests for this account right now. Wait a moment and try again.";
      break;
    case "validation":
      text = `ElevenLabs rejected the request: ${providerDetail}`;
      break;
    case "voice_not_found":
      text = "The selected voice is not available to this ElevenLabs account. Choose another voice.";
      break;
    case "provider_unavailable":
      text = "ElevenLabs is temporarily unavailable or returned an unexpected response. Try again in a few minutes.";
      break;
    case "timeout":
      text = "ElevenLabs did not respond in time. Try again.";
      break;
  }
  return clip(error.requestId ? `${text} (ElevenLabs request id: ${error.requestId})` : text, 1000);
}

export interface ElevenLabsApiError {
  status: number;
  code: ApiErrorCode;
  message: string;
  fields?: Record<string, string>;
}

/** Maps an ElevenLabsError onto the app's API error vocabulary (docs/research/elevenlabs.md §13). */
export function elevenLabsErrorToApi(error: ElevenLabsError): ElevenLabsApiError {
  const message = describeElevenLabsError(error);
  switch (error.kind) {
    case "not_configured":
    case "auth":
      return { status: 503, code: "tts_not_configured", message };
    case "quota":
      return { status: 502, code: "tts_failed", message };
    case "rate_limited":
      return { status: 429, code: "rate_limited", message };
    case "validation":
      return { status: 400, code: "invalid_request", message };
    case "voice_not_found":
      return { status: 400, code: "invalid_request", message, fields: { voiceId: message } };
    case "provider_unavailable":
      return { status: 502, code: "tts_failed", message };
    case "timeout":
      return { status: 504, code: "tts_failed", message };
  }
}
