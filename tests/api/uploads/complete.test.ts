import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompleteUploadResponse, SignUploadResponse } from "@/lib/api/contracts";
import { openUploadEnvelope, sealUploadEnvelope } from "@/lib/data/admin/uploads";
import { MAX_ANNOUNCEMENT_BYTES, MAX_GENRE_COVER_BYTES, MAX_TRACK_BYTES } from "@/lib/validation/limits";
import { FakeSupabase } from "./fake-supabase";
import {
  ACTIVE_ANNOUNCEMENT_ID,
  ACTIVE_ANNOUNCEMENT_PATH,
  ADMIN_ID,
  BUSINESS_ID,
  DRAFT_ANNOUNCEMENT_ID,
  errorOf,
  GENRE_JAZZ,
  GENRE_LOUNGE,
  JPEG_BYTES,
  jsonRequest,
  MP3_BYTES,
  mp3Metadata,
  OLD_COVER_PATH,
  OLD_LOGO_PATH,
  OTHER_ADMIN_ID,
  PNG_BYTES,
  seedWorld,
  TRACK_ID,
  TRACK_PATH,
  UNKNOWN_ID,
  VENUE_USER_ID,
} from "./fixtures";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeSupabase,
  consumeRateLimit: vi.fn(),
  validateMp3: vi.fn(),
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
vi.mock("@/lib/audio/mp3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audio/mp3")>()),
  validateMp3: h.validateMp3,
}));

const { POST: signRoute } = await import("@/app/api/admin/uploads/sign/route");
const { POST: completeRoute } = await import("@/app/api/admin/uploads/complete/route");

const NOT_MP3 = { ok: false, code: "not_mp3", reason: "This is not an MP3 file. Upload an MP3 (MPEG Layer III) audio file." } as const;

async function signUpload(body: Record<string, unknown>): Promise<SignUploadResponse> {
  const response = await signRoute(jsonRequest("/api/admin/uploads/sign", body));
  expect(response.status).toBe(200);
  return (await response.json()) as SignUploadResponse;
}

/** Sign, then store the bytes where the browser's signed upload would have put them. */
async function upload(body: Record<string, unknown>, bytes: Uint8Array, contentType: string): Promise<SignUploadResponse> {
  const signed = await signUpload(body);
  h.db.putObject(signed.bucket, signed.path, bytes, contentType);
  return signed;
}

function complete(uploadToken: string, metadata?: Record<string, unknown>): Promise<Response> {
  return completeRoute(jsonRequest("/api/admin/uploads/complete", metadata ? { uploadToken, metadata } : { uploadToken }));
}

async function completeOk(uploadToken: string, metadata?: Record<string, unknown>): Promise<CompleteUploadResponse> {
  const response = await complete(uploadToken, metadata);
  if (response.status !== 200) throw new Error(`expected 200, got ${response.status}: ${await response.text()}`);
  return (await response.json()) as CompleteUploadResponse;
}

function trackFile(fileName = "01 - Blue_Moon.mp3") {
  return { fileName, fileSize: MP3_BYTES.length, contentType: "audio/mpeg" };
}

function eventIndex(event: string): number {
  const index = h.db.events.indexOf(event);
  expect(index, `event ${event} in ${JSON.stringify(h.db.events)}`).toBeGreaterThanOrEqual(0);
  return index;
}

function trackIdOf(path: string): string {
  return path.split("/")[1];
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "fake_secret_test_key_for_upload_route_tests");
  vi.stubEnv("UPLOAD_TOKEN_SECRET", "");
  h.db = new FakeSupabase();
  seedWorld(h.db);
  h.db.currentUserId = ADMIN_ID;
  h.consumeRateLimit.mockReset();
  h.consumeRateLimit.mockResolvedValue({ allowed: true, degraded: false });
  h.validateMp3.mockReset();
  h.validateMp3.mockResolvedValue(mp3Metadata());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("POST /api/admin/uploads/complete — access and tokens", () => {
  it("answers 401 when signed out and 403 for a venue user", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");

    h.db.currentUserId = null;
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 401, code: "unauthenticated" });
    h.db.currentUserId = VENUE_USER_ID;
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 403, code: "forbidden" });
    expect(h.db.hasObject("music", signed.path)).toBe(true);
  });

  it("rate-limits per admin (upload-complete:{userId})", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    h.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "limited" });
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 429, code: "rate_limited" });
    expect(h.consumeRateLimit).toHaveBeenLastCalledWith({ key: `upload-complete:${ADMIN_ID}`, max: 120, windowSeconds: 600, failClosed: false });
  });

  it("rejects a tampered envelope with 400", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    const parts = signed.uploadToken.split(".");
    parts[2] = Buffer.from("evil.mp3").toString("base64url");
    const error = await errorOf(await complete(parts.join(".")));
    expect(error).toMatchObject({ status: 400, code: "invalid_request", message: "The upload token is invalid. Please upload the file again." });
    expect(h.db.hasObject("music", signed.path)).toBe(true);
  });

  it("rejects a forged inner token even inside a valid envelope", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    const opened = openUploadEnvelope(signed.uploadToken);
    if (!opened.ok) throw new Error("envelope should open");
    const [segment, signature] = opened.uploadToken.split(".");
    const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
    payload.path = TRACK_PATH;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
    const error = await errorOf(await complete(sealUploadEnvelope(forged, "x.mp3")));
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(h.db.hasObject("music", TRACK_PATH)).toBe(true);
  });

  it("rejects a bare foundation token (no envelope) as malformed", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    const opened = openUploadEnvelope(signed.uploadToken);
    if (!opened.ok) throw new Error("envelope should open");
    expect(await errorOf(await complete(opened.uploadToken))).toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("rejects an expired token with 400 and says so", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 8, 25, 12, 0, 0));
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    vi.setSystemTime(Date.UTC(2026, 8, 25, 12, 16, 0));
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(error.message).toContain("expired");
    expect(h.db.rows("tracks")).toHaveLength(2);
  });

  it("answers 403 when another admin tries to complete the upload", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    h.db.currentUserId = OTHER_ADMIN_ID;
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 403, code: "forbidden", message: "This upload was started by a different account." });
    expect(h.db.hasObject("music", signed.path)).toBe(true);
    expect(h.validateMp3).not.toHaveBeenCalled();
  });

  it("answers 404 when the object was never uploaded", async () => {
    const signed = await signUpload({ kind: "track", ...trackFile() });
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 404, code: "not_found", message: "The upload did not finish; please try again." });
    expect(h.db.rows("tracks")).toHaveLength(2);
  });

  it("answers 503 on a storage outage and keeps the object for a later attempt", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    h.db.failNext("storage:download", { name: "StorageUnknownError", message: "fetch failed" });
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 503, code: "unavailable" });
    expect(h.db.hasObject("music", signed.path)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/admin/uploads/complete — new track", () => {
  it("creates the track row with the admin's client from the validated audio", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    const body = await completeOk(signed.uploadToken, { genreIds: [GENRE_JAZZ] });

    const trackId = trackIdOf(signed.path);
    expect(body).toEqual({
      kind: "track",
      track: expect.objectContaining({
        id: trackId,
        title: "Blue Moon",
        artist: "Unknown Artist",
        durationSeconds: 187.42,
        fileSizeBytes: MP3_BYTES.length,
        bitrateKbps: 192,
        originalFilename: "01 - Blue_Moon.mp3",
        isActive: true,
        removedAt: null,
        genreIds: [GENRE_JAZZ],
      }),
    });
    expect(h.db.row("tracks", trackId)).toMatchObject({
      storage_path: signed.path,
      sample_rate_hz: 44100,
      mime_type: "audio/mpeg",
      created_by: ADMIN_ID,
      is_active: true,
    });
    expect(h.db.rows("track_genres").filter((row) => row.track_id === trackId)).toEqual([
      expect.objectContaining({ genre_id: GENRE_JAZZ }),
    ]);
    expect(h.validateMp3).toHaveBeenCalledWith(MP3_BYTES, { maxBytes: MAX_TRACK_BYTES });
    expect(h.db.events).toEqual(
      expect.arrayContaining([`storage:admin:download:music/${signed.path}`, "db:user:insert:tracks", "rpc:user:set_track_genres"]),
    );
    expect(h.db.hasObject("music", signed.path)).toBe(true);
  });

  it("prefers metadata over ID3 tags over the file name", async () => {
    h.validateMp3.mockResolvedValue(mp3Metadata({ title: "Tagged Title", artist: "Tagged Artist" }));
    const tagged = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    const fromTags = await completeOk(tagged.uploadToken);
    expect(fromTags.kind === "track" && fromTags.track).toMatchObject({ title: "Tagged Title", artist: "Tagged Artist", genreIds: [] });

    const overridden = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    const fromMetadata = await completeOk(overridden.uploadToken, { title: "  Override  ", artist: "Band" });
    expect(fromMetadata.kind === "track" && fromMetadata.track).toMatchObject({ title: "Override", artist: "Band" });
  });

  it("stores a sanitised original file name carried in the upload token", async () => {
    const signed = await upload({ kind: "track", ...trackFile("Café‮ Night\u0007.mp3") }, MP3_BYTES, "audio/mpeg");
    const body = await completeOk(signed.uploadToken);
    expect(body.kind === "track" && body.track).toMatchObject({ originalFilename: "Café Night .mp3", title: "Café Night" });
  });

  it("removes the object and answers 415 when the file is not a valid MP3", async () => {
    h.validateMp3.mockResolvedValueOnce(NOT_MP3);
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 415, code: "unsupported_media", message: NOT_MP3.reason });
    expect(h.db.hasObject("music", signed.path)).toBe(false);
    expect(h.db.events).toContain(`storage:admin:remove:music/${signed.path}`);
    expect(h.db.rows("tracks")).toHaveLength(2);
  });

  it("removes the object when the track row cannot be inserted", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    h.db.failNext("db:tracks:insert", { code: "XX000", message: "internal error" });
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 500, code: "server_error" });
    expect(h.db.hasObject("music", signed.path)).toBe(false);
    expect(h.db.row("tracks", trackIdOf(signed.path))).toBeUndefined();
  });

  it("maps an RLS refusal on insert to 403 and still cleans up", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    h.db.failNext("db:tracks:insert", { code: "42501", message: "new row violates row-level security policy" });
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 403, code: "forbidden" });
    expect(h.db.hasObject("music", signed.path)).toBe(false);
  });

  it("rejects unknown genres before downloading and removes the object", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    const error = await errorOf(await complete(signed.uploadToken, { genreIds: [GENRE_JAZZ, UNKNOWN_ID] }));
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(error.fields).toHaveProperty("genreIds");
    expect(h.db.hasObject("music", signed.path)).toBe(false);
    expect(h.validateMp3).not.toHaveBeenCalled();
  });

  it("rolls back the row and the object when assigning genres fails", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    h.db.failNext("rpc:set_track_genres", { code: "42501", message: "Only platform admins can perform this action" });
    const error = await errorOf(await complete(signed.uploadToken, { genreIds: [GENRE_LOUNGE] }));
    expect(error).toMatchObject({ status: 403, code: "forbidden" });
    expect(h.db.row("tracks", trackIdOf(signed.path))).toBeUndefined();
    expect(h.db.hasObject("music", signed.path)).toBe(false);
    expect(eventIndex("db:user:delete:tracks")).toBeLessThan(eventIndex(`storage:admin:remove:music/${signed.path}`));
  });

  it("answers 409 when the same token is completed twice and keeps the object", async () => {
    const signed = await upload({ kind: "track", ...trackFile() }, MP3_BYTES, "audio/mpeg");
    await completeOk(signed.uploadToken);
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 409, code: "conflict", message: "This upload has already been completed." });
    expect(h.db.hasObject("music", signed.path)).toBe(true);
    expect(h.db.rows("tracks")).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/admin/uploads/complete — track replacement", () => {
  it("points the track at the new audio, then deletes the old object", async () => {
    h.validateMp3.mockResolvedValue(mp3Metadata({ title: "Ignored Tag", durationSeconds: 201.5, bitrateKbps: 256 }));
    const signed = await upload({ kind: "track-replace", trackId: TRACK_ID, ...trackFile("blue-moon-remaster.mp3") }, MP3_BYTES, "audio/mpeg");
    const body = await completeOk(signed.uploadToken);

    expect(body).toEqual({
      kind: "track-replace",
      track: expect.objectContaining({
        id: TRACK_ID,
        title: "Blue Moon",
        artist: "The Quartet",
        durationSeconds: 201.5,
        bitrateKbps: 256,
        fileSizeBytes: MP3_BYTES.length,
        originalFilename: "blue-moon-remaster.mp3",
        genreIds: [GENRE_JAZZ, GENRE_LOUNGE],
      }),
    });
    expect(h.db.row("tracks", TRACK_ID)).toMatchObject({ storage_path: signed.path, created_by: ADMIN_ID });
    expect(h.db.hasObject("music", signed.path)).toBe(true);
    expect(h.db.hasObject("music", TRACK_PATH)).toBe(false);
    expect(eventIndex("db:user:update:tracks")).toBeLessThan(eventIndex(`storage:admin:remove:music/${TRACK_PATH}`));
  });

  it("applies title and artist overrides", async () => {
    const signed = await upload({ kind: "track-replace", trackId: TRACK_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    const body = await completeOk(signed.uploadToken, { title: "Blue Moon (Remaster)", artist: "The Quartet & Friends" });
    expect(body.kind === "track-replace" && body.track).toMatchObject({ title: "Blue Moon (Remaster)", artist: "The Quartet & Friends" });
  });

  it("keeps the old audio when the new file is invalid", async () => {
    h.validateMp3.mockResolvedValueOnce(NOT_MP3);
    const signed = await upload({ kind: "track-replace", trackId: TRACK_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 415, code: "unsupported_media" });
    expect(h.db.hasObject("music", signed.path)).toBe(false);
    expect(h.db.hasObject("music", TRACK_PATH)).toBe(true);
    expect(h.db.row("tracks", TRACK_ID)).toMatchObject({ storage_path: TRACK_PATH });
  });

  it("keeps the old audio when the update fails", async () => {
    const signed = await upload({ kind: "track-replace", trackId: TRACK_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    h.db.failNext("db:tracks:update", { code: "XX000", message: "internal error" });
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 500, code: "server_error" });
    expect(h.db.hasObject("music", signed.path)).toBe(false);
    expect(h.db.hasObject("music", TRACK_PATH)).toBe(true);
    expect(h.db.row("tracks", TRACK_ID)).toMatchObject({ storage_path: TRACK_PATH });
  });

  it("discards the upload when the track was deleted meanwhile", async () => {
    const signed = await upload({ kind: "track-replace", trackId: TRACK_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    h.db.tables.tracks = h.db.tables.tracks.filter((row) => row.id !== TRACK_ID);
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 404, code: "not_found" });
    expect(h.db.hasObject("music", signed.path)).toBe(false);
  });

  it("answers 409 and discards the upload when the track changed during validation", async () => {
    const otherPath = `tracks/${TRACK_ID}/${"e".repeat(32)}.mp3`;
    h.validateMp3.mockImplementationOnce(async () => {
      h.db.patchRow("tracks", TRACK_ID, { storage_path: otherPath });
      return mp3Metadata();
    });
    const signed = await upload({ kind: "track-replace", trackId: TRACK_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 409, code: "conflict" });
    expect(h.db.hasObject("music", signed.path)).toBe(false);
    expect(h.db.hasObject("music", TRACK_PATH)).toBe(true);
    expect(h.db.row("tracks", TRACK_ID)).toMatchObject({ storage_path: otherPath });
  });

  it("answers 409 on a replayed token and touches nothing", async () => {
    const signed = await upload({ kind: "track-replace", trackId: TRACK_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    await completeOk(signed.uploadToken);
    const eventsBefore = h.db.events.length;
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 409, code: "conflict" });
    expect(h.db.hasObject("music", signed.path)).toBe(true);
    expect(h.db.events.slice(eventsBefore).filter((event) => !event.startsWith("db:user:select"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/admin/uploads/complete — announcement audio", () => {
  it("attaches the audio as a fresh upload awaiting approval and removes the previous audio afterwards", async () => {
    h.validateMp3.mockResolvedValue(mp3Metadata({ durationSeconds: 5.25 }));
    const signed = await upload({ kind: "announcement", announcementId: ACTIVE_ANNOUNCEMENT_ID, ...trackFile("welcome.mp3") }, MP3_BYTES, "audio/mpeg");
    const body = await completeOk(signed.uploadToken);

    expect(body).toEqual({
      kind: "announcement",
      announcement: expect.objectContaining({
        id: ACTIVE_ANNOUNCEMENT_ID,
        businessId: BUSINESS_ID,
        status: "ready",
        source: "upload",
        hasAudio: true,
        audioDurationSeconds: 5.25,
        voiceId: null,
        voiceName: null,
        modelId: null,
        lastError: null,
        needsReview: false,
        reviewReason: null,
        approvedAt: null,
        generationStartedAt: null,
      }),
    });
    expect(h.db.row("announcements", ACTIVE_ANNOUNCEMENT_ID)).toMatchObject({
      audio_path: signed.path,
      audio_size_bytes: MP3_BYTES.length,
      generation_hash: null,
      approved_by: null,
      text: "Welcome to EmeraldBar.",
    });
    expect(h.validateMp3).toHaveBeenCalledWith(MP3_BYTES, { maxBytes: MAX_ANNOUNCEMENT_BYTES });
    expect(h.db.hasObject("announcements", ACTIVE_ANNOUNCEMENT_PATH)).toBe(false);
    expect(eventIndex("db:user:update:announcements")).toBeLessThan(eventIndex(`storage:admin:remove:announcements/${ACTIVE_ANNOUNCEMENT_PATH}`));
  });

  it("does not try to remove anything for a draft without audio", async () => {
    const signed = await upload({ kind: "announcement", announcementId: DRAFT_ANNOUNCEMENT_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    await completeOk(signed.uploadToken);
    expect(h.db.events.some((event) => event.includes(":remove:"))).toBe(false);
    expect(h.db.row("announcements", DRAFT_ANNOUNCEMENT_ID)).toMatchObject({ status: "ready", audio_path: signed.path });
  });

  it("answers 409 and discards the upload when a generation started before completion", async () => {
    const signed = await upload({ kind: "announcement", announcementId: DRAFT_ANNOUNCEMENT_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    h.db.patchRow("announcements", DRAFT_ANNOUNCEMENT_ID, { status: "generating", generation_started_at: new Date().toISOString() });
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 409, code: "conflict" });
    expect(error.message).toContain("being generated");
    expect(h.db.hasObject("announcements", signed.path)).toBe(false);
    expect(h.validateMp3).not.toHaveBeenCalled();
  });

  it("answers 409 when a generation starts while the file is being validated", async () => {
    h.validateMp3.mockImplementationOnce(async () => {
      h.db.patchRow("announcements", DRAFT_ANNOUNCEMENT_ID, { status: "generating", generation_started_at: new Date().toISOString() });
      return mp3Metadata();
    });
    const signed = await upload({ kind: "announcement", announcementId: DRAFT_ANNOUNCEMENT_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 409, code: "conflict" });
    expect(h.db.hasObject("announcements", signed.path)).toBe(false);
    expect(h.db.row("announcements", DRAFT_ANNOUNCEMENT_ID)).toMatchObject({ status: "generating", audio_path: null });
  });

  it("removes an invalid file and leaves the announcement as it was", async () => {
    h.validateMp3.mockResolvedValueOnce(NOT_MP3);
    const signed = await upload({ kind: "announcement", announcementId: ACTIVE_ANNOUNCEMENT_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 415, code: "unsupported_media" });
    expect(h.db.hasObject("announcements", signed.path)).toBe(false);
    expect(h.db.hasObject("announcements", ACTIVE_ANNOUNCEMENT_PATH)).toBe(true);
    expect(h.db.row("announcements", ACTIVE_ANNOUNCEMENT_ID)).toMatchObject({ status: "active", audio_path: ACTIVE_ANNOUNCEMENT_PATH });
  });

  // ANN-01: an upload never touches the wording; the studio saves wording edits only after this.
  it("keeps the stored wording, respelling included, whether the file is rejected or attached", async () => {
    h.db.patchRow("announcements", ACTIVE_ANNOUNCEMENT_ID, { spoken_text: "Welcome to Emerald Bar.", placement: "both" });
    const wording = { text: "Welcome to EmeraldBar.", spoken_text: "Welcome to Emerald Bar.", placement: "both", language: "en" };

    h.validateMp3.mockResolvedValueOnce(NOT_MP3);
    const rejected = await upload({ kind: "announcement", announcementId: ACTIVE_ANNOUNCEMENT_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    expect(await errorOf(await complete(rejected.uploadToken))).toMatchObject({ status: 415 });
    expect(h.db.row("announcements", ACTIVE_ANNOUNCEMENT_ID)).toMatchObject({
      ...wording,
      status: "active",
      source: "tts",
      audio_path: ACTIVE_ANNOUNCEMENT_PATH,
      approved_by: ADMIN_ID,
    });
    expect(h.db.hasObject("announcements", ACTIVE_ANNOUNCEMENT_PATH)).toBe(true);

    const accepted = await upload({ kind: "announcement", announcementId: ACTIVE_ANNOUNCEMENT_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    await completeOk(accepted.uploadToken);
    expect(h.db.row("announcements", ACTIVE_ANNOUNCEMENT_ID)).toMatchObject({ ...wording, status: "ready", source: "upload", audio_path: accepted.path });
  });

  it("answers 409 on a replayed token", async () => {
    const signed = await upload({ kind: "announcement", announcementId: DRAFT_ANNOUNCEMENT_ID, ...trackFile() }, MP3_BYTES, "audio/mpeg");
    await completeOk(signed.uploadToken);
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 409, code: "conflict" });
    expect(h.db.hasObject("announcements", signed.path)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/admin/uploads/complete — venue logo", () => {
  const logoFile = { fileName: "emeraldbar.png", fileSize: PNG_BYTES.length, contentType: "image/png" };

  it("swaps the logo, removes the previous one afterwards and returns a signed URL", async () => {
    const signed = await upload({ kind: "logo", businessId: BUSINESS_ID, ...logoFile }, PNG_BYTES, "image/png");
    const body = await completeOk(signed.uploadToken);

    expect(body).toEqual({
      kind: "logo",
      businessId: BUSINESS_ID,
      logoPath: signed.path,
      logoUrl: expect.stringContaining(`/object/sign/logos/${signed.path}?token=read-jwt`),
    });
    expect(h.db.row("businesses", BUSINESS_ID)).toMatchObject({ logo_path: signed.path });
    expect(h.db.hasObject("logos", OLD_LOGO_PATH)).toBe(false);
    expect(eventIndex("db:user:update:businesses")).toBeLessThan(eventIndex(`storage:admin:remove:logos/${OLD_LOGO_PATH}`));
    expect(h.db.events).toContain(`storage:user:createSignedUrl:logos/${signed.path}`);
    expect(h.validateMp3).not.toHaveBeenCalled();
  });

  it("sets a first logo without removing anything", async () => {
    h.db.patchRow("businesses", BUSINESS_ID, { logo_path: null });
    const signed = await upload({ kind: "logo", businessId: BUSINESS_ID, ...logoFile }, PNG_BYTES, "image/png");
    await completeOk(signed.uploadToken);
    expect(h.db.events.some((event) => event.includes(":remove:"))).toBe(false);
    expect(h.db.hasObject("logos", OLD_LOGO_PATH)).toBe(true);
  });

  it("rejects bytes that do not match the declared image type and removes them", async () => {
    const signed = await upload({ kind: "logo", businessId: BUSINESS_ID, ...logoFile }, JPEG_BYTES, "image/png");
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 415, code: "unsupported_media" });
    expect(error.message).toContain("JPEG");
    expect(h.db.hasObject("logos", signed.path)).toBe(false);
    expect(h.db.row("businesses", BUSINESS_ID)).toMatchObject({ logo_path: OLD_LOGO_PATH });
    expect(h.db.hasObject("logos", OLD_LOGO_PATH)).toBe(true);
  });

  it("answers 409 on a replayed token", async () => {
    const signed = await upload({ kind: "logo", businessId: BUSINESS_ID, ...logoFile }, PNG_BYTES, "image/png");
    await completeOk(signed.uploadToken);
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 409, code: "conflict" });
    expect(h.db.hasObject("logos", signed.path)).toBe(true);
  });

  it("reports honestly when the logo was saved but could not be signed", async () => {
    const signed = await upload({ kind: "logo", businessId: BUSINESS_ID, ...logoFile }, PNG_BYTES, "image/png");
    h.db.failNext("storage:createSignedUrl", { message: "gateway timeout", status: 504, statusCode: "504" });
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 500, code: "server_error" });
    expect(error.message).toContain("The logo was saved");
    expect(h.db.row("businesses", BUSINESS_ID)).toMatchObject({ logo_path: signed.path });
  });
});

describe("POST /api/admin/uploads/complete — genre cover", () => {
  const coverFile = { fileName: "jazz-cover.png", fileSize: PNG_BYTES.length, contentType: "image/png" };

  it("swaps the cover, removes the previous image afterwards and returns a signed URL", async () => {
    const signed = await upload({ kind: "genre-cover", genreId: GENRE_JAZZ, ...coverFile }, PNG_BYTES, "image/png");
    expect(signed.bucket).toBe("genre-covers");
    const body = await completeOk(signed.uploadToken);

    expect(body).toEqual({
      kind: "genre-cover",
      genreId: GENRE_JAZZ,
      coverPath: signed.path,
      coverUrl: expect.stringContaining(`/object/sign/genre-covers/${signed.path}?token=read-jwt`),
    });
    expect(h.db.row("genres", GENRE_JAZZ)).toMatchObject({ cover_path: signed.path });
    // The row is updated with the admin's own client (RLS), and only then is the old image removed.
    expect(h.db.hasObject("genre-covers", OLD_COVER_PATH)).toBe(false);
    expect(h.db.hasObject("genre-covers", signed.path)).toBe(true);
    expect(eventIndex("db:user:update:genres")).toBeLessThan(eventIndex(`storage:admin:remove:genre-covers/${OLD_COVER_PATH}`));
    // The preview URL is signed with the admin's own client (storage policy "genre-covers: admin select").
    expect(h.db.events).toContain(`storage:user:createSignedUrl:genre-covers/${signed.path}`);
    expect(h.validateMp3).not.toHaveBeenCalled();
  });

  it("sets a first cover without removing anything", async () => {
    const signed = await upload({ kind: "genre-cover", genreId: GENRE_LOUNGE, ...coverFile }, PNG_BYTES, "image/png");
    await completeOk(signed.uploadToken);
    expect(h.db.row("genres", GENRE_LOUNGE)).toMatchObject({ cover_path: signed.path });
    expect(h.db.events.some((event) => event.includes(":remove:"))).toBe(false);
    expect(h.db.hasObject("genre-covers", OLD_COVER_PATH)).toBe(true);
  });

  it("removes an upload that is not a valid image and answers 415, leaving the genre as it was", async () => {
    const notAnImage = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    const signed = await upload({ kind: "genre-cover", genreId: GENRE_JAZZ, ...coverFile }, notAnImage, "image/png");
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 415, code: "unsupported_media" });
    expect(error.message).toContain("SVG");
    expect(h.db.hasObject("genre-covers", signed.path)).toBe(false);
    expect(h.db.row("genres", GENRE_JAZZ)).toMatchObject({ cover_path: OLD_COVER_PATH });
    expect(h.db.hasObject("genre-covers", OLD_COVER_PATH)).toBe(true);
    expect(h.db.events.some((event) => event.includes("db:user:update:genres"))).toBe(false);
  });

  it("rejects bytes that do not match the signed image type and removes them", async () => {
    const signed = await upload({ kind: "genre-cover", genreId: GENRE_JAZZ, ...coverFile }, JPEG_BYTES, "image/png");
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 415, code: "unsupported_media" });
    expect(error.message).toContain("JPEG");
    expect(h.db.hasObject("genre-covers", signed.path)).toBe(false);
    expect(h.db.row("genres", GENRE_JAZZ)).toMatchObject({ cover_path: OLD_COVER_PATH });
  });

  it("removes an image above the 3 MB cover limit", async () => {
    const huge = new Uint8Array(MAX_GENRE_COVER_BYTES + 1);
    huge.set(PNG_BYTES);
    const signed = await upload({ kind: "genre-cover", genreId: GENRE_JAZZ, ...coverFile }, huge, "image/png");
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 415, code: "unsupported_media" });
    expect(error.message).toContain("3 MB");
    expect(h.db.hasObject("genre-covers", signed.path)).toBe(false);
  });

  it("discards the upload when the genre was deleted meanwhile", async () => {
    const signed = await upload({ kind: "genre-cover", genreId: GENRE_LOUNGE, ...coverFile }, PNG_BYTES, "image/png");
    h.db.tables.genres = h.db.rows("genres").filter((row) => row.id !== GENRE_LOUNGE);
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 404, code: "not_found" });
    expect(h.db.hasObject("genre-covers", signed.path)).toBe(false);
  });

  it("answers 409 on a replayed token and keeps everything", async () => {
    const signed = await upload({ kind: "genre-cover", genreId: GENRE_JAZZ, ...coverFile }, PNG_BYTES, "image/png");
    await completeOk(signed.uploadToken);
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 409, code: "conflict" });
    expect(h.db.hasObject("genre-covers", signed.path)).toBe(true);
    expect(h.db.row("genres", GENRE_JAZZ)).toMatchObject({ cover_path: signed.path });
  });

  it("reports honestly when the cover was saved but could not be signed", async () => {
    const signed = await upload({ kind: "genre-cover", genreId: GENRE_JAZZ, ...coverFile }, PNG_BYTES, "image/png");
    h.db.failNext("storage:createSignedUrl", { message: "gateway timeout", status: 504, statusCode: "504" });
    const error = await errorOf(await complete(signed.uploadToken));
    expect(error).toMatchObject({ status: 500, code: "server_error" });
    expect(error.message).toContain("The cover was saved");
    expect(h.db.row("genres", GENRE_JAZZ)).toMatchObject({ cover_path: signed.path });
  });

  it("refuses a cover token completed by another admin", async () => {
    const signed = await upload({ kind: "genre-cover", genreId: GENRE_JAZZ, ...coverFile }, PNG_BYTES, "image/png");
    h.db.currentUserId = OTHER_ADMIN_ID;
    expect(await errorOf(await complete(signed.uploadToken))).toMatchObject({ status: 403, code: "forbidden" });
    expect(h.db.row("genres", GENRE_JAZZ)).toMatchObject({ cover_path: OLD_COVER_PATH });
  });
});
