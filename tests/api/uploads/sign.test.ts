import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignUploadResponse } from "@/lib/api/contracts";
import { openUploadEnvelope } from "@/lib/data/admin/uploads";
import { verifyUploadToken } from "@/lib/uploads/token";
import { MAX_ANNOUNCEMENT_BYTES, MAX_GENRE_COVER_BYTES, MAX_LOGO_BYTES, MAX_TRACK_BYTES } from "@/lib/validation/limits";
import { FakeSupabase } from "./fake-supabase";
import {
  ACTIVE_ANNOUNCEMENT_ID,
  ADMIN_ID,
  BUSINESS_ID,
  DRAFT_ANNOUNCEMENT_ID,
  errorOf,
  GENERATING_ANNOUNCEMENT_ID,
  GENRE_JAZZ,
  jsonRequest,
  seedWorld,
  TRACK_ID,
  UNKNOWN_ID,
  VENUE_USER_ID,
} from "./fixtures";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeSupabase,
  consumeRateLimit: vi.fn(),
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

const { POST } = await import("@/app/api/admin/uploads/sign/route");

const TRACK_PATH_PATTERN = /^tracks\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{32}\.mp3$/;

function sign(body: unknown) {
  return POST(jsonRequest("/api/admin/uploads/sign", body));
}

function mp3(overrides: Record<string, unknown> = {}) {
  return { fileName: "01 - Blue_Moon.mp3", fileSize: 4_000_000, contentType: "audio/mpeg", ...overrides };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "fake_secret_test_key_for_upload_route_tests");
  vi.stubEnv("UPLOAD_TOKEN_SECRET", "");
  h.db = new FakeSupabase();
  seedWorld(h.db);
  h.db.currentUserId = ADMIN_ID;
  h.consumeRateLimit.mockReset();
  h.consumeRateLimit.mockResolvedValue({ allowed: true, degraded: false });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/admin/uploads/sign — access", () => {
  it("answers 401 when signed out", async () => {
    h.db.currentUserId = null;
    const error = await errorOf(await sign({ kind: "track", ...mp3() }));
    expect(error).toMatchObject({ status: 401, code: "unauthenticated" });
    expect(h.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("answers 403 for a venue user", async () => {
    h.db.currentUserId = VENUE_USER_ID;
    const error = await errorOf(await sign({ kind: "track", ...mp3() }));
    expect(error).toMatchObject({ status: 403, code: "forbidden" });
    expect(h.db.events.some((event) => event.includes("createSignedUploadUrl"))).toBe(false);
  });

  it("rate-limits per admin (upload-sign:{userId}, 120 per 10 minutes, fail open)", async () => {
    await sign({ kind: "track", ...mp3() });
    expect(h.consumeRateLimit).toHaveBeenCalledWith({ key: `upload-sign:${ADMIN_ID}`, max: 120, windowSeconds: 600, failClosed: false });

    h.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "limited" });
    const error = await errorOf(await sign({ kind: "track", ...mp3() }));
    expect(error).toMatchObject({ status: 429, code: "rate_limited" });
  });
});

describe("POST /api/admin/uploads/sign — request checks", () => {
  it("rejects a malformed body with 400 and field errors", async () => {
    const error = await errorOf(await sign({ kind: "track-replace", fileName: "a.mp3", fileSize: 10, contentType: "audio/mpeg" }));
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_request");
    expect(error.fields).toHaveProperty("trackId");
  });

  it("answers 413 for an oversize track with checkUploadFile's message", async () => {
    const error = await errorOf(await sign({ kind: "track", ...mp3({ fileSize: MAX_TRACK_BYTES + 1 }) }));
    expect(error).toMatchObject({ status: 413, code: "payload_too_large" });
    expect(error.message).toContain("50 MB");
  });

  it("answers 413 for an announcement above 10 MB", async () => {
    const error = await errorOf(
      await sign({ kind: "announcement", announcementId: DRAFT_ANNOUNCEMENT_ID, ...mp3({ fileSize: MAX_ANNOUNCEMENT_BYTES + 1 }) }),
    );
    expect(error).toMatchObject({ status: 413, code: "payload_too_large" });
  });

  it("answers 415 for a non-MP3 audio file", async () => {
    const error = await errorOf(await sign({ kind: "track", ...mp3({ fileName: "song.wav", contentType: "audio/wav" }) }));
    expect(error).toMatchObject({ status: 415, code: "unsupported_media" });
    expect(error.message).toContain("Only .mp3 files are accepted");
  });

  it("answers 415 for an SVG logo", async () => {
    const error = await errorOf(
      await sign({ kind: "logo", businessId: BUSINESS_ID, fileName: "logo.svg", fileSize: 2000, contentType: "image/svg+xml" }),
    );
    expect(error).toMatchObject({ status: 415, code: "unsupported_media" });
  });
});

describe("POST /api/admin/uploads/sign — targets", () => {
  async function signOk(body: unknown): Promise<SignUploadResponse> {
    const response = await sign(body);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    return (await response.json()) as SignUploadResponse;
  }

  function tokenPayload(uploadToken: string) {
    const envelope = openUploadEnvelope(uploadToken);
    if (!envelope.ok) throw new Error(`envelope rejected: ${envelope.reason}`);
    const verified = verifyUploadToken(envelope.uploadToken, { expectedUserId: ADMIN_ID });
    if (!verified.ok) throw new Error(`token rejected: ${verified.reason}`);
    return { payload: verified.payload, originalFileName: envelope.originalFileName };
  }

  it("signs a new track under a freshly generated track id with the admin's own client", async () => {
    const body = await signOk({ kind: "track", ...mp3() });
    expect(body.bucket).toBe("music");
    expect(body.maxBytes).toBe(MAX_TRACK_BYTES);
    expect(body.path).toMatch(TRACK_PATH_PATTERN);
    expect(body.signedUrl).toBe(`https://storage.test/storage/v1/object/upload/sign/music/${body.path}?token=upload-jwt`);
    expect(body.token).toBe("upload-jwt");
    expect(h.db.events).toContain(`storage:user:createSignedUploadUrl:music/${body.path}`);

    const { payload, originalFileName } = tokenPayload(body.uploadToken);
    expect(payload).toMatchObject({ kind: "track", bucket: "music", path: body.path, targetId: null, userId: ADMIN_ID });
    expect(originalFileName).toBe("01 - Blue_Moon.mp3");
  });

  it("gives every signature a new object path", async () => {
    const first = await signOk({ kind: "track", ...mp3() });
    const second = await signOk({ kind: "track", ...mp3() });
    expect(first.path).not.toBe(second.path);
  });

  it("signs a replacement under the existing track id", async () => {
    const body = await signOk({ kind: "track-replace", trackId: TRACK_ID, ...mp3() });
    expect(body.path).toMatch(new RegExp(`^tracks/${TRACK_ID}/[0-9a-f]{32}\\.mp3$`));
    expect(tokenPayload(body.uploadToken).payload).toMatchObject({ kind: "track-replace", targetId: TRACK_ID });
  });

  it("answers 404 when the track to replace does not exist", async () => {
    const error = await errorOf(await sign({ kind: "track-replace", trackId: UNKNOWN_ID, ...mp3() }));
    expect(error).toMatchObject({ status: 404, code: "not_found" });
  });

  it("signs an announcement under {business_id}/{announcement_id}/", async () => {
    const body = await signOk({ kind: "announcement", announcementId: ACTIVE_ANNOUNCEMENT_ID, ...mp3() });
    expect(body.bucket).toBe("announcements");
    expect(body.maxBytes).toBe(MAX_ANNOUNCEMENT_BYTES);
    expect(body.path).toMatch(new RegExp(`^${BUSINESS_ID}/${ACTIVE_ANNOUNCEMENT_ID}/[0-9a-f]{32}\\.mp3$`));
    expect(tokenPayload(body.uploadToken).payload).toMatchObject({ kind: "announcement", targetId: ACTIVE_ANNOUNCEMENT_ID });
  });

  it("answers 404 for an unknown announcement", async () => {
    const error = await errorOf(await sign({ kind: "announcement", announcementId: UNKNOWN_ID, ...mp3() }));
    expect(error).toMatchObject({ status: 404, code: "not_found" });
  });

  it("answers 409 while audio is being generated for the announcement", async () => {
    const error = await errorOf(await sign({ kind: "announcement", announcementId: GENERATING_ANNOUNCEMENT_ID, ...mp3() }));
    expect(error).toMatchObject({ status: 409, code: "conflict" });
    expect(error.message).toContain("being generated");
    expect(h.db.events.some((event) => event.includes("createSignedUploadUrl"))).toBe(false);
  });

  it("allows an upload over a stale (> 3 min) generating lock", async () => {
    h.db.patchRow("announcements", GENERATING_ANNOUNCEMENT_ID, { generation_started_at: new Date(Date.now() - 4 * 60_000).toISOString() });
    await signOk({ kind: "announcement", announcementId: GENERATING_ANNOUNCEMENT_ID, ...mp3() });
  });

  it("signs a logo with the canonical extension of the checked type", async () => {
    const body = await signOk({ kind: "logo", businessId: BUSINESS_ID, fileName: "Logo.JPEG", fileSize: 20_000, contentType: "image/jpeg" });
    expect(body.bucket).toBe("logos");
    expect(body.maxBytes).toBe(MAX_LOGO_BYTES);
    expect(body.path).toMatch(new RegExp(`^${BUSINESS_ID}/[0-9a-f]{32}\\.jpg$`));
    expect(tokenPayload(body.uploadToken).payload).toMatchObject({ kind: "logo", bucket: "logos", targetId: BUSINESS_ID });
  });

  it("answers 404 for a logo of an unknown venue", async () => {
    const error = await errorOf(await sign({ kind: "logo", businessId: UNKNOWN_ID, fileName: "logo.png", fileSize: 1000, contentType: "image/png" }));
    expect(error).toMatchObject({ status: 404, code: "not_found" });
  });

  it("signs a genre cover under {genre_id}/{random}.{ext} in the genre-covers bucket", async () => {
    const body = await signOk({ kind: "genre-cover", genreId: GENRE_JAZZ, fileName: "Jazz Cover.JPEG", fileSize: 200_000, contentType: "image/jpeg" });
    expect(body.bucket).toBe("genre-covers");
    expect(body.maxBytes).toBe(MAX_GENRE_COVER_BYTES);
    expect(body.path).toMatch(new RegExp(`^${GENRE_JAZZ}/[0-9a-f]{32}\\.jpg$`));
    expect(h.db.events).toContain(`storage:user:createSignedUploadUrl:genre-covers/${body.path}`);
    expect(tokenPayload(body.uploadToken).payload).toMatchObject({
      kind: "genre-cover",
      bucket: "genre-covers",
      path: body.path,
      targetId: GENRE_JAZZ,
      userId: ADMIN_ID,
    });
  });

  it("answers 404 for a cover of an unknown genre, before creating any upload link", async () => {
    const error = await errorOf(
      await sign({ kind: "genre-cover", genreId: UNKNOWN_ID, fileName: "cover.png", fileSize: 1000, contentType: "image/png" }),
    );
    expect(error).toMatchObject({ status: 404, code: "not_found", message: "This genre no longer exists. Refresh the page." });
    expect(h.db.events.some((event) => event.includes("createSignedUploadUrl"))).toBe(false);
  });

  it("applies the 3 MB image rules to genre covers", async () => {
    const tooLarge = await errorOf(
      await sign({ kind: "genre-cover", genreId: GENRE_JAZZ, fileName: "cover.png", fileSize: MAX_GENRE_COVER_BYTES + 1, contentType: "image/png" }),
    );
    expect(tooLarge).toMatchObject({ status: 413, code: "payload_too_large" });
    expect(tooLarge.message).toContain("genre cover limit is 3 MB");

    const gif = await errorOf(
      await sign({ kind: "genre-cover", genreId: GENRE_JAZZ, fileName: "cover.gif", fileSize: 1000, contentType: "image/gif" }),
    );
    expect(gif).toMatchObject({ status: 415, code: "unsupported_media" });

    const missingGenre = await errorOf(await sign({ kind: "genre-cover", fileName: "cover.png", fileSize: 1000, contentType: "image/png" }));
    expect(missingGenre.status).toBe(400);
    expect(missingGenre.fields).toHaveProperty("genreId");
  });
});

describe("POST /api/admin/uploads/sign — storage failures", () => {
  it("maps a storage policy refusal to 403", async () => {
    h.db.failNext("storage:createSignedUploadUrl", { message: "new row violates row-level security policy", status: 400, statusCode: "403" });
    const error = await errorOf(await sign({ kind: "track", ...mp3() }));
    expect(error).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("maps a missing bucket to 503 with the bucket name", async () => {
    h.db.failNext("storage:createSignedUploadUrl", { message: "Bucket not found", status: 400, statusCode: "404" });
    const error = await errorOf(await sign({ kind: "track", ...mp3() }));
    expect(error).toMatchObject({ status: 503, code: "unavailable" });
    expect(error.message).toContain('"music"');
  });

  it("maps a storage outage to 503", async () => {
    h.db.failNext("storage:createSignedUploadUrl", { name: "StorageUnknownError", message: "fetch failed" });
    const error = await errorOf(await sign({ kind: "track", ...mp3() }));
    expect(error).toMatchObject({ status: 503, code: "unavailable" });
  });

  it("maps an unexpected storage error to a generic 500", async () => {
    h.db.failNext("storage:createSignedUploadUrl", { message: "weird", status: 400, statusCode: "400" });
    const error = await errorOf(await sign({ kind: "track", ...mp3() }));
    expect(error).toMatchObject({ status: 500, code: "server_error" });
  });

  it("answers 503 when no token secret is configured", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const error = await errorOf(await sign({ kind: "track", ...mp3() }));
    expect(error).toMatchObject({ status: 503, code: "unavailable" });
    expect(h.db.events.some((event) => event.includes("createSignedUploadUrl"))).toBe(false);
  });
});
