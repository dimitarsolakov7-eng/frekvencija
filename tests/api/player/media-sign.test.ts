import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/media/sign/route";
import type { SignedMedia } from "@/lib/api/contracts";
import { FakeSupabase, pgError, type FakeSupabaseOptions } from "./fake-supabase";
import {
  ANN_OTHER_BUSINESS,
  ANN_ROTATION,
  ANN_STALE,
  announcementRow,
  BRANDING_VERSION,
  BUSINESS_ID,
  businessRow,
  GENRE_JAZZ,
  GENRE_LOUNGE,
  grantAccess,
  jsonRequest,
  OTHER_BUSINESS_ID,
  readError,
  readOk,
  TRACK_1,
  TRACK_2,
  trackRow,
  USER_ID,
} from "./helpers";

const { requireBusinessUserApi, consumeRateLimit } = vi.hoisted(() => ({
  requireBusinessUserApi: vi.fn(),
  consumeRateLimit: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireBusinessUserApi }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  consumeRateLimit,
}));

function setup(options: FakeSupabaseOptions = {}): FakeSupabase {
  const fake = new FakeSupabase({
    ...options,
    tables: {
      businesses: [businessRow()],
      tracks: [
        trackRow(TRACK_1, [GENRE_JAZZ], { title: "Blue in Green", artist: "Ada", duration_seconds: "301.25" }),
        trackRow(TRACK_2, [GENRE_LOUNGE]),
      ],
      announcements: [announcementRow(ANN_ROTATION, { audio_duration_seconds: "7.40" })],
      ...options.tables,
    },
  });
  requireBusinessUserApi.mockResolvedValue(grantAccess(fake));
  return fake;
}

function sign(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return POST(jsonRequest("/api/media/sign", "POST", body, headers));
}

const signTrack = (id: string, genreId: string) => sign({ kind: "track", id, genreId });
const signAnnouncement = (id: string, extra: Record<string, unknown> = {}) => sign({ kind: "announcement", id, ...extra });

beforeEach(() => {
  requireBusinessUserApi.mockReset();
  consumeRateLimit.mockReset();
  consumeRateLimit.mockResolvedValue({ allowed: true, degraded: false });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/media/sign — tracks", () => {
  it("signs a playable track of the genre with the user's client and returns its metadata", async () => {
    const fake = setup();
    const before = Date.now();

    const body = await readOk<SignedMedia>(await signTrack(TRACK_1, GENRE_JAZZ));

    expect(body).toMatchObject({ kind: "track", id: TRACK_1, durationSeconds: 301.25, title: "Blue in Green", artist: "Ada" });
    expect(fake.signCalls).toHaveLength(1);
    const [call] = fake.signCalls;
    expect(call.bucket).toBe("music");
    expect(call.path).toBe(`tracks/${TRACK_1}/0123456789abcdef.mp3`);
    // The lifetime covers the whole track plus buffering.
    expect(call.expiresIn).toBeGreaterThanOrEqual(Math.ceil(301.25 * 1.5) + 900);
    expect(body.url).toContain(`music/tracks/${TRACK_1}`);
    const expiresAt = Date.parse(body.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + call.expiresIn * 1000 - 5_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + call.expiresIn * 1000);
  });

  it("answers 404 unavailable for a track that is not linked to the requested genre", async () => {
    const fake = setup();

    const error = await readError(await signTrack(TRACK_2, GENRE_JAZZ));

    expect(error).toMatchObject({ status: 404, code: "unavailable" });
    expect(fake.signCalls).toHaveLength(0);
    const [query] = fake.queriesFor("tracks");
    expect(query.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "id", value: TRACK_2 },
        { op: "eq", column: "track_genres.genre_id", value: GENRE_JAZZ },
      ]),
    );
  });

  it.each([
    ["disabled", { is_active: false }],
    ["removed", { removed_at: "2026-09-20T10:00:00.000Z" }],
  ])("answers 404 unavailable for a %s track", async (_label, overrides) => {
    const fake = setup({ tables: { tracks: [trackRow(TRACK_1, [GENRE_JAZZ], overrides)] } });
    expect(await readError(await signTrack(TRACK_1, GENRE_JAZZ))).toMatchObject({ status: 404, code: "unavailable" });
    expect(fake.signCalls).toHaveLength(0);
  });

  it("answers 404 unavailable when RLS hides the track (e.g. genre no longer assigned)", async () => {
    const fake = setup({ tables: { tracks: [] } });
    expect(await readError(await signTrack(TRACK_1, GENRE_JAZZ))).toMatchObject({ status: 404, code: "unavailable" });
    expect(fake.signCalls).toHaveLength(0);
  });

  it("maps a Storage not-found (object missing or refused by Storage RLS) to 404 unavailable", async () => {
    setup({ sign: () => ({ data: null, error: { message: "Object not found", statusCode: "404" } }) });
    expect(await readError(await signTrack(TRACK_1, GENRE_JAZZ))).toMatchObject({ status: 404, code: "unavailable" });
  });

  it("maps any other Storage failure to a generic 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setup({ sign: () => ({ data: null, error: { message: "Internal storage error at db-7", statusCode: "500" } }) });

    const response = await signTrack(TRACK_1, GENRE_JAZZ);
    const text = await response.clone().text();

    expect(await readError(response)).toMatchObject({ status: 500, code: "server_error" });
    expect(text).not.toContain("db-7");
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("POST /api/media/sign — announcements", () => {
  it("signs the venue's playable announcement from the announcements bucket", async () => {
    const fake = setup();

    const body = await readOk<SignedMedia>(await signAnnouncement(ANN_ROTATION));

    expect(body).toMatchObject({ kind: "announcement", id: ANN_ROTATION, durationSeconds: 7.4 });
    expect(body).not.toHaveProperty("title");
    expect(body).not.toHaveProperty("artist");
    expect(fake.signCalls).toEqual([
      expect.objectContaining({ bucket: "announcements", path: `${BUSINESS_ID}/${ANN_ROTATION}/fedcba9876543210.mp3` }),
    ]);
  });

  it("answers 404 unavailable for another venue's announcement hidden by RLS", async () => {
    const fake = setup();
    expect(await readError(await signAnnouncement(ANN_OTHER_BUSINESS))).toMatchObject({ status: 404, code: "unavailable" });
    expect(fake.signCalls).toHaveLength(0);
  });

  it("scopes the lookup to the session's venue even if a row of another venue were visible", async () => {
    const fake = setup({
      tables: { announcements: [announcementRow(ANN_OTHER_BUSINESS, { business_id: OTHER_BUSINESS_ID })] },
    });

    const error = await readError(await signAnnouncement(ANN_OTHER_BUSINESS, { businessId: OTHER_BUSINESS_ID }));

    expect(error).toMatchObject({ status: 404, code: "unavailable" });
    expect(fake.signCalls).toHaveLength(0);
    expect(fake.queriesFor("announcements")[0].filters).toContainEqual({ op: "eq", column: "business_id", value: BUSINESS_ID });
    expect(fake.queriesFor("businesses")[0].filters).toEqual([{ op: "eq", column: "id", value: BUSINESS_ID }]);
  });

  it("answers 404 unavailable for an announcement approved at an older branding version", async () => {
    const fake = setup({
      tables: { announcements: [announcementRow(ANN_STALE, { branding_version: BRANDING_VERSION - 1 })] },
    });
    expect(await readError(await signAnnouncement(ANN_STALE))).toMatchObject({ status: 404, code: "unavailable" });
    expect(fake.signCalls).toHaveLength(0);
  });

  it.each([
    ["under review", { needs_review: true }],
    ["not active", { status: "ready" }],
    ["without audio", { audio_path: null }],
  ])("answers 404 unavailable for an announcement %s", async (_label, overrides) => {
    const fake = setup({ tables: { announcements: [announcementRow(ANN_ROTATION, overrides)] } });
    expect(await readError(await signAnnouncement(ANN_ROTATION))).toMatchObject({ status: 404, code: "unavailable" });
    expect(fake.signCalls).toHaveLength(0);
  });
});

describe("POST /api/media/sign — rate limiting and validation", () => {
  it("consumes the per-user media-sign bucket (fail open) before any lookup", async () => {
    setup();
    await readOk<SignedMedia>(await signTrack(TRACK_1, GENRE_JAZZ));
    expect(consumeRateLimit).toHaveBeenCalledWith({ key: `media-sign:${USER_ID}`, max: 900, windowSeconds: 600, failClosed: false });
  });

  it("answers 429 rate_limited when the bucket is exhausted, without touching the database", async () => {
    const fake = setup();
    consumeRateLimit.mockResolvedValue({ allowed: false, reason: "limited" });

    const error = await readError(await signTrack(TRACK_1, GENRE_JAZZ));

    expect(error).toMatchObject({ status: 429, code: "rate_limited" });
    expect(fake.queries).toHaveLength(0);
    expect(fake.signCalls).toHaveLength(0);
  });

  it("still signs when the limiter is degraded (fail open)", async () => {
    setup();
    consumeRateLimit.mockResolvedValue({ allowed: true, degraded: true });
    await readOk<SignedMedia>(await signTrack(TRACK_1, GENRE_JAZZ));
  });

  it.each([
    ["an unknown kind", { kind: "logo", id: TRACK_1 }],
    ["a track without genreId", { kind: "track", id: TRACK_1 }],
    ["a malformed id", { kind: "announcement", id: "../../etc/passwd" }],
    ["an array body", [{ kind: "track", id: TRACK_1, genreId: GENRE_JAZZ }]],
  ])("rejects %s with 400 invalid_request", async (_label, payload) => {
    const fake = setup();
    expect(await readError(await sign(payload))).toMatchObject({ status: 400, code: "invalid_request" });
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(fake.queries).toHaveLength(0);
  });

  it("rejects invalid JSON with 400", async () => {
    setup();
    expect(await readError(await sign('{"kind":"track",'))).toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("rejects a form-encoded body with 415", async () => {
    setup();
    const error = await readError(
      await sign(`kind=track&id=${TRACK_1}&genreId=${GENRE_JAZZ}`, { "content-type": "application/x-www-form-urlencoded" }),
    );
    expect(error).toMatchObject({ status: 415, code: "invalid_request" });
  });

  it("maps a database failure during the lookup to a generic 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setup({ failTables: { tracks: pgError("XX000", "internal error in node pg-3") } });

    const response = await signTrack(TRACK_1, GENRE_JAZZ);
    const text = await response.clone().text();

    expect(await readError(response)).toMatchObject({ status: 500, code: "server_error" });
    expect(text).not.toContain("pg-3");
    expect(consoleError).toHaveBeenCalled();
  });
});
