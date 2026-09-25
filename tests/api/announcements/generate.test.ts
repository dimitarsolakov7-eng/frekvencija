import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateAnnouncementResponse } from "@/lib/api/contracts";
import { ElevenLabsError } from "@/lib/tts/elevenlabs";
import { generationHash } from "@/lib/tts/hash";
import { encodeToneMp3, randomBytes } from "../../fixtures/audio";
import { FakeSupabase } from "./fake-supabase";
import {
  ACTIVE_ID,
  ADMIN_ID,
  announcementRow,
  BUSINESS_ID,
  configuredOptions,
  DRAFT_ID,
  errorOf,
  FLAGGED_ACTIVE_ID,
  FLAGGED_ACTIVE_PATH,
  GENERATING_ID,
  jsonRequest,
  OTHER_VOICE_ID,
  READY_TTS_ID,
  READY_TTS_PATH,
  seedWorld,
  STALE_GENERATING_ID,
  UNKNOWN_ID,
  VENUE_USER_ID,
  VOICE_ID,
} from "./fixtures";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeSupabase,
  consumeRateLimit: vi.fn(),
  getTtsOptions: vi.fn(),
  clearTtsOptionsCache: vi.fn(),
  synthesize: vi.fn(),
  clientOptions: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => h.db.client("user") }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => h.db.client("admin") }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  consumeRateLimit: h.consumeRateLimit,
}));
vi.mock("@/lib/tts/options", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tts/options")>()),
  getTtsOptions: h.getTtsOptions,
  clearTtsOptionsCache: h.clearTtsOptionsCache,
}));
vi.mock("@/lib/tts/elevenlabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tts/elevenlabs")>()),
  getElevenLabsClient: (options: unknown) => {
    h.clientOptions.push(options);
    return { synthesize: h.synthesize };
  },
}));

const { POST } = await import("@/app/api/admin/announcements/[id]/generate/route");

const MP3 = encodeToneMp3({ seconds: 1.2, channels: 1, kbps: 64 });
const NEW_PATH = new RegExp(`^${BUSINESS_ID}/${DRAFT_ID}/[0-9a-f]{32}\\.mp3$`);

function generate(id: string, body: unknown) {
  return POST(jsonRequest(`/api/admin/announcements/${id}/generate`, body), { params: Promise.resolve({ id }) });
}

function body(overrides: Record<string, unknown> = {}) {
  return { voiceId: VOICE_ID, voiceName: "Rachel (client)", modelId: "eleven_multilingual_v2", languageCode: "en", ...overrides };
}

function synthesized(audio: Uint8Array = MP3) {
  return { audio, contentType: "audio/mpeg", requestId: "req-ok", characterCount: 40 };
}

async function ok(response: Response): Promise<GenerateAnnouncementResponse> {
  if (response.status !== 200) throw new Error(`expected 200, got ${response.status}: ${await response.text()}`);
  return (await response.json()) as GenerateAnnouncementResponse;
}

beforeEach(() => {
  h.db = new FakeSupabase();
  seedWorld(h.db);
  h.db.currentUserId = ADMIN_ID;
  h.consumeRateLimit.mockReset().mockResolvedValue({ allowed: true, degraded: false });
  h.getTtsOptions.mockReset().mockResolvedValue(configuredOptions());
  h.clearTtsOptionsCache.mockReset();
  h.synthesize.mockReset().mockResolvedValue(synthesized());
  h.clientOptions = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/announcements/[id]/generate — access and input", () => {
  it("answers 401 when signed out and 403 for a venue user, without touching the provider", async () => {
    h.db.currentUserId = null;
    expect(await errorOf(await generate(DRAFT_ID, body()))).toMatchObject({ status: 401, code: "unauthenticated" });
    h.db.currentUserId = VENUE_USER_ID;
    expect(await errorOf(await generate(DRAFT_ID, body()))).toMatchObject({ status: 403, code: "forbidden" });
    expect(h.getTtsOptions).not.toHaveBeenCalled();
    expect(h.synthesize).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed or unknown announcement id", async () => {
    expect(await errorOf(await generate("not-a-uuid", body()))).toMatchObject({ status: 404, code: "not_found" });
    expect(await errorOf(await generate(UNKNOWN_ID, body()))).toMatchObject({ status: 404, code: "not_found" });
  });

  it("rejects an invalid body with 400 and field errors", async () => {
    const error = await errorOf(await generate(DRAFT_ID, { modelId: "eleven_multilingual_v2", voiceId: "../../etc" }));
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(error.fields).toHaveProperty("voiceId");
  });
});

describe("POST /api/admin/announcements/[id]/generate — gates before any paid call", () => {
  it("answers 409 while another generation holds a fresh lock", async () => {
    const error = await errorOf(await generate(GENERATING_ID, body()));
    expect(error).toMatchObject({ status: 409, code: "conflict" });
    expect(error.message).toContain("being generated");
    expect(h.getTtsOptions).not.toHaveBeenCalled();
    expect(h.synthesize).not.toHaveBeenCalled();
  });

  it("answers 503 tts_not_configured when no API key is set, and leaves the row alone", async () => {
    h.getTtsOptions.mockResolvedValue({ configured: false, reason: "Text-to-speech is not configured. Uploading MP3 announcements still works." });
    const before = h.db.row("announcements", DRAFT_ID);
    const error = await errorOf(await generate(DRAFT_ID, body()));
    expect(error).toMatchObject({ status: 503, code: "tts_not_configured" });
    expect(error.message).toContain("Uploading MP3");
    expect(h.db.row("announcements", DRAFT_ID)).toEqual(before);
    expect(h.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("maps a transient provider failure while loading options", async () => {
    h.getTtsOptions.mockRejectedValue(new ElevenLabsError("provider_unavailable", "ElevenLabs 503: down"));
    expect(await errorOf(await generate(DRAFT_ID, body()))).toMatchObject({ status: 502, code: "tts_failed" });
  });

  it("rejects a model the account does not offer", async () => {
    const error = await errorOf(await generate(DRAFT_ID, body({ modelId: "eleven_turbo_v2" })));
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(error.fields).toHaveProperty("modelId");
  });

  it("rejects a languageCode the model does not list with 400 and a clear message", async () => {
    const error = await errorOf(await generate(DRAFT_ID, body({ languageCode: "sr" })));
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(error.message).toContain("Eleven Multilingual v2 does not support Serbian");
    expect(error.fields).toHaveProperty("languageCode");
    expect(h.consumeRateLimit).not.toHaveBeenCalled();
    expect(h.synthesize).not.toHaveBeenCalled();
  });

  it("rejects an announcement whose own language the model does not list when no languageCode is sent", async () => {
    h.db.patchRow("announcements", DRAFT_ID, { language: "hu" });
    const error = await errorOf(await generate(DRAFT_ID, body({ languageCode: undefined })));
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(error.message).toContain("Hungarian");
  });

  it("rejects spoken wording longer than the model's per-request limit", async () => {
    const error = await errorOf(await generate(DRAFT_ID, body({ modelId: "eleven_v3" })));
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(error.message).toContain("at most 20");
  });

  it("refuses to regenerate an on-air announcement in place (409) and points to Duplicate", async () => {
    const error = await errorOf(await generate(ACTIVE_ID, body({ voiceId: OTHER_VOICE_ID })));
    expect(error).toMatchObject({ status: 409, code: "conflict" });
    expect(error.message).toContain("Duplicate");
    expect(h.consumeRateLimit).not.toHaveBeenCalled();
    expect(h.synthesize).not.toHaveBeenCalled();
    expect(h.db.row("announcements", ACTIVE_ID)).toMatchObject({ status: "active", generation_attempts: 0 });
  });

  it("rate-limits per admin (tts-generate:{adminId}, 20 per 10 minutes, fail closed) with 429", async () => {
    h.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "limited" });
    const error = await errorOf(await generate(DRAFT_ID, body()));
    expect(error).toMatchObject({ status: 429, code: "rate_limited" });
    expect(h.consumeRateLimit).toHaveBeenCalledWith({ key: `tts-generate:${ADMIN_ID}`, max: 20, windowSeconds: 600, failClosed: true });
    expect(h.synthesize).not.toHaveBeenCalled();
    expect(h.db.row("announcements", DRAFT_ID)).toMatchObject({ status: "draft", generation_attempts: 0 });
  });

  it("answers 503 when the limiter is down (fail closed)", async () => {
    h.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "unavailable" });
    expect(await errorOf(await generate(DRAFT_ID, body()))).toMatchObject({ status: 503, code: "unavailable" });
    expect(h.synthesize).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/announcements/[id]/generate — reuse and locking", () => {
  it("reuses matching audio: reused:true, no provider call, no rate limit, no write", async () => {
    const spoken = "Welcome to Emerald Bar. Enjoy the music.";
    h.db.patchRow("announcements", READY_TTS_ID, {
      generation_hash: generationHash({ spokenText: spoken, voiceId: VOICE_ID, modelId: "eleven_multilingual_v2" }),
    });
    const eventsBefore = h.db.events.length;
    const result = await ok(await generate(READY_TTS_ID, body()));
    expect(result.reused).toBe(true);
    expect(result.announcement).toMatchObject({ id: READY_TTS_ID, status: "ready", hasAudio: true });
    expect(h.synthesize).not.toHaveBeenCalled();
    expect(h.consumeRateLimit).not.toHaveBeenCalled();
    expect(h.db.events.length).toBe(eventsBefore);
  });

  it("regenerates despite a matching hash when force is set", async () => {
    const spoken = "Welcome to Emerald Bar. Enjoy the music.";
    h.db.patchRow("announcements", READY_TTS_ID, {
      generation_hash: generationHash({ spokenText: spoken, voiceId: VOICE_ID, modelId: "eleven_multilingual_v2" }),
    });
    const result = await ok(await generate(READY_TTS_ID, body({ force: true })));
    expect(result.reused).toBe(false);
    expect(h.synthesize).toHaveBeenCalledTimes(1);
  });

  it("answers 409 when the atomic lock matches no row (another request locked it first)", async () => {
    h.db.beforeNext("db:announcements:update", () => {
      h.db.patchRow("announcements", DRAFT_ID, { status: "generating", generation_started_at: new Date().toISOString(), generation_attempts: 1 });
    });
    const error = await errorOf(await generate(DRAFT_ID, body()));
    expect(error).toMatchObject({ status: 409, code: "conflict" });
    expect(h.synthesize).not.toHaveBeenCalled();
    expect(h.db.row("announcements", DRAFT_ID)).toMatchObject({ status: "generating", generation_attempts: 1 });
  });

  it("makes exactly one paid call for a double click", async () => {
    const [first, second] = await Promise.all([generate(DRAFT_ID, body()), generate(DRAFT_ID, body())]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(h.synthesize).toHaveBeenCalledTimes(1);
    expect(h.db.row("announcements", DRAFT_ID)).toMatchObject({ status: "ready", generation_attempts: 1 });
  });

  it("re-checks lock staleness inside the conditional update itself", async () => {
    // Same status and attempt count as read, but the lock was refreshed meanwhile: only the
    // database-side "not generating, or stale" condition can reject this.
    h.db.beforeNext("db:announcements:update", () => {
      h.db.patchRow("announcements", STALE_GENERATING_ID, { generation_started_at: new Date().toISOString() });
    });
    const error = await errorOf(await generate(STALE_GENERATING_ID, body()));
    expect(error).toMatchObject({ status: 409, code: "conflict" });
    expect(h.synthesize).not.toHaveBeenCalled();
  });

  it("takes over a stale (> 3 min) generating lock", async () => {
    const result = await ok(await generate(STALE_GENERATING_ID, body()));
    expect(result.announcement.status).toBe("ready");
    expect(h.db.row("announcements", STALE_GENERATING_ID)).toMatchObject({ generation_attempts: 3, generation_started_at: null });
  });
});

describe("POST /api/admin/announcements/[id]/generate — success", () => {
  it("synthesizes, validates, uploads with the secret-key client and marks the row ready for approval", async () => {
    const result = await ok(await generate(DRAFT_ID, body()));

    expect(h.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceId: VOICE_ID,
        modelId: "eleven_multilingual_v2",
        text: "Welcome to Emerald Bar. Enjoy the music.",
        languageCode: undefined,
      }),
    );
    expect(h.clientOptions).toEqual([{ maxRetries: 0 }]);

    const row = h.db.row("announcements", DRAFT_ID)!;
    expect(row).toMatchObject({
      status: "ready",
      source: "tts",
      voice_id: VOICE_ID,
      voice_name: "Rachel",
      model_id: "eleven_multilingual_v2",
      language: "en",
      generation_hash: generationHash({ spokenText: "Welcome to Emerald Bar. Enjoy the music.", voiceId: VOICE_ID, modelId: "eleven_multilingual_v2" }),
      generation_started_at: null,
      generation_attempts: 1,
      last_error: null,
      needs_review: false,
      approved_at: null,
      approved_by: null,
      audio_size_bytes: MP3.byteLength,
    });
    expect(row.audio_path).toMatch(NEW_PATH);
    expect(Number(row.audio_duration_seconds)).toBeGreaterThan(1);
    expect(h.db.hasObject("announcements", row.audio_path as string)).toBe(true);
    expect(h.db.events).toContain(`storage:admin:upload:announcements/${row.audio_path as string}`);
    expect(h.db.events.filter((event) => event.startsWith("db:admin:"))).toEqual([]);

    expect(result).toMatchObject({ reused: false, announcement: { id: DRAFT_ID, status: "ready", source: "tts", hasAudio: true } });
  });

  it("removes the previous audio only after the row points at the new audio", async () => {
    await ok(await generate(READY_TTS_ID, body({ voiceId: OTHER_VOICE_ID, voiceName: "Adam" })));
    const row = h.db.row("announcements", READY_TTS_ID)!;
    expect(row.audio_path).not.toBe(READY_TTS_PATH);
    expect(h.db.hasObject("announcements", READY_TTS_PATH)).toBe(false);
    expect(h.db.hasObject("announcements", row.audio_path as string)).toBe(true);

    const finalUpdate = h.db.events.lastIndexOf("db:user:update:announcements");
    const removal = h.db.events.indexOf(`storage:admin:remove:announcements/${READY_TTS_PATH}`);
    expect(finalUpdate).toBeGreaterThan(-1);
    expect(removal).toBeGreaterThan(finalUpdate);
  });

  it("regenerates a flagged (off-air) announcement and clears the review flag and approval", async () => {
    await ok(await generate(FLAGGED_ACTIVE_ID, body()));
    expect(h.db.row("announcements", FLAGGED_ACTIVE_ID)).toMatchObject({
      status: "ready",
      needs_review: false,
      review_reason: null,
      approved_at: null,
    });
    expect(h.db.hasObject("announcements", FLAGGED_ACTIVE_PATH)).toBe(false);
  });

  it("sends language_code for models that accept it and keeps the stored regional tag", async () => {
    h.db.seed("announcements", [
      announcementRow("4e000000-0000-4000-8000-000000000020", { text: "Dobro došli.", spoken_text: null, language: "sr-Latn" }),
    ]);
    await ok(await generate("4e000000-0000-4000-8000-000000000020", body({ modelId: "eleven_v3", languageCode: "sr" })));
    expect(h.synthesize).toHaveBeenCalledWith(expect.objectContaining({ languageCode: "sr", text: "Dobro došli." }));
    expect(h.db.row("announcements", "4e000000-0000-4000-8000-000000000020")).toMatchObject({ language: "sr-Latn", model_id: "eleven_v3" });
  });

  it("stores the chosen language when the admin picks a different one", async () => {
    await ok(await generate(DRAFT_ID, body({ languageCode: "hr" })));
    expect(h.db.row("announcements", DRAFT_ID)).toMatchObject({ language: "hr" });
  });
});

describe("POST /api/admin/announcements/[id]/generate — failures", () => {
  it("records a provider error honestly: failed status, last_error, released lock, mapped status", async () => {
    h.synthesize.mockRejectedValue(
      new ElevenLabsError("quota", "ElevenLabs 402 (insufficient_credits): You have 0 credits left.", { status: 402, requestId: "req-402" }),
    );
    const error = await errorOf(await generate(DRAFT_ID, body()));
    expect(error).toMatchObject({ status: 502, code: "tts_failed" });
    const row = h.db.row("announcements", DRAFT_ID)!;
    expect(row).toMatchObject({ status: "failed", generation_started_at: null, generation_attempts: 1, audio_path: null });
    expect(row.last_error).toContain("credits");
    expect(row.last_error).toContain("req-402");
    expect(h.db.objectPaths("announcements").some((path) => path.includes(DRAFT_ID))).toBe(false);
  });

  it("keeps existing audio and status when regenerating a flagged announcement fails", async () => {
    h.synthesize.mockRejectedValue(new ElevenLabsError("timeout", "ElevenLabs did not respond within 45 s."));
    const error = await errorOf(await generate(FLAGGED_ACTIVE_ID, body()));
    expect(error).toMatchObject({ status: 504, code: "tts_failed" });
    const row = h.db.row("announcements", FLAGGED_ACTIVE_ID)!;
    expect(row).toMatchObject({ status: "active", needs_review: true, audio_path: FLAGGED_ACTIVE_PATH, generation_started_at: null });
    expect(row.last_error).toContain("did not respond in time");
    expect(h.db.hasObject("announcements", FLAGGED_ACTIVE_PATH)).toBe(true);
  });

  it("keeps a ready announcement's audio when regeneration fails", async () => {
    h.synthesize.mockRejectedValue(new ElevenLabsError("provider_unavailable", "ElevenLabs 500: boom"));
    await generate(READY_TTS_ID, body({ voiceId: OTHER_VOICE_ID }));
    expect(h.db.row("announcements", READY_TTS_ID)).toMatchObject({ status: "ready", audio_path: READY_TTS_PATH, voice_id: VOICE_ID });
  });

  it("maps a rejected key to 503 tts_not_configured and drops the cached options", async () => {
    h.synthesize.mockRejectedValue(new ElevenLabsError("auth", "ElevenLabs 401 (invalid_api_key): Invalid API key", { status: 401 }));
    expect(await errorOf(await generate(DRAFT_ID, body()))).toMatchObject({ status: 503, code: "tts_not_configured" });
    expect(h.clearTtsOptionsCache).toHaveBeenCalled();
  });

  it("maps a provider rate limit to 429 and an unknown voice to 400 with fields.voiceId", async () => {
    h.synthesize.mockRejectedValueOnce(new ElevenLabsError("rate_limited", "ElevenLabs 429: busy", { status: 429 }));
    expect(await errorOf(await generate(DRAFT_ID, body()))).toMatchObject({ status: 429, code: "rate_limited" });

    h.synthesize.mockRejectedValueOnce(new ElevenLabsError("voice_not_found", "ElevenLabs 404: voice", { status: 404 }));
    const error = await errorOf(await generate(DRAFT_ID, body()));
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(error.fields).toHaveProperty("voiceId");
    expect(h.db.row("announcements", DRAFT_ID)).toMatchObject({ status: "failed", generation_attempts: 2 });
  });

  it("rejects provider audio that is not a valid MP3 without storing it", async () => {
    h.synthesize.mockResolvedValue(synthesized(randomBytes(4096)));
    const error = await errorOf(await generate(DRAFT_ID, body()));
    expect(error).toMatchObject({ status: 502, code: "tts_failed" });
    const row = h.db.row("announcements", DRAFT_ID)!;
    expect(row.status).toBe("failed");
    expect(row.last_error).toContain("cannot be used");
    expect(h.db.events.some((event) => event.includes(":upload:"))).toBe(false);
  });

  it("records a storage failure after generation", async () => {
    h.db.failNext("storage:upload", { name: "StorageUnknownError", message: "fetch failed" });
    const error = await errorOf(await generate(DRAFT_ID, body()));
    expect(error).toMatchObject({ status: 503, code: "unavailable" });
    const row = h.db.row("announcements", DRAFT_ID)!;
    expect(row).toMatchObject({ status: "failed", generation_started_at: null });
    expect(row.last_error).toContain("could not be saved");
  });

  it("discards the new audio when the announcement is deleted during generation", async () => {
    h.synthesize.mockImplementation(async () => {
      h.db.tables.announcements = h.db.tables.announcements.filter((row) => row.id !== DRAFT_ID);
      return synthesized();
    });
    const error = await errorOf(await generate(DRAFT_ID, body()));
    expect(error).toMatchObject({ status: 409, code: "conflict" });
    expect(h.db.objectPaths("announcements").some((path) => path.includes(DRAFT_ID))).toBe(false);
  });

  it("releases the lock when something unexpected throws", async () => {
    h.synthesize.mockRejectedValue(new TypeError("boom"));
    expect(await errorOf(await generate(DRAFT_ID, body()))).toMatchObject({ status: 500, code: "server_error" });
    expect(h.db.row("announcements", DRAFT_ID)).toMatchObject({ status: "failed", generation_started_at: null });
  });
});
