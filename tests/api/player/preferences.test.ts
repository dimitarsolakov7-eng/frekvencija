import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/player/preferences/route";
import type { UpdatePreferencesResponse } from "@/lib/api/contracts";
import { FakeSupabase, pgError, type FakeSupabaseOptions, type Row } from "./fake-supabase";
import {
  BUSINESS_ID,
  GENRE_HIDDEN,
  GENRE_JAZZ,
  GENRE_LOUNGE,
  genreRow,
  grantAccess,
  jsonRequest,
  OTHER_BUSINESS_ID,
  preferencesRow,
  readError,
  readOk,
  USER_ID,
} from "./helpers";

const { requireBusinessUserApi } = vi.hoisted(() => ({ requireBusinessUserApi: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireBusinessUserApi }));

const OTHER_USER_ID = "44444444-4444-4444-8444-444444444444";

/** Mirrors the RLS with-check: own row, own venue, and a genre that is null or visible. */
function withCheck(visibleGenres: readonly string[]) {
  return (_table: string, row: Row) =>
    row.user_id === USER_ID &&
    row.business_id === BUSINESS_ID &&
    (row.genre_id === null || visibleGenres.includes(row.genre_id as string))
      ? null
      : pgError("42501", 'new row violates row-level security policy for table "playback_preferences"');
}

function setup(options: FakeSupabaseOptions = {}): FakeSupabase {
  const fake = new FakeSupabase({
    upsertCheck: withCheck([GENRE_JAZZ, GENRE_LOUNGE]),
    ...options,
    tables: { genres: [genreRow(GENRE_JAZZ), genreRow(GENRE_LOUNGE)], playback_preferences: [], ...options.tables },
  });
  requireBusinessUserApi.mockResolvedValue(grantAccess(fake));
  return fake;
}

function put(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return PUT(jsonRequest("/api/player/preferences", "PUT", body, headers));
}

beforeEach(() => {
  requireBusinessUserApi.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PUT /api/player/preferences", () => {
  it("creates the row on first save with column defaults for omitted fields", async () => {
    const fake = setup();

    const body = await readOk<UpdatePreferencesResponse>(await put({ volume: 0.35 }));

    expect(body).toEqual({ preferences: { genreId: null, volume: 0.35, muted: false } });
    const [upsert] = fake.queriesFor("playback_preferences", "upsert");
    expect(upsert.payload).toEqual({ user_id: USER_ID, business_id: BUSINESS_ID, volume: 0.35 });
    expect(upsert.onConflict).toBe("user_id,business_id");
  });

  it("keeps stored values for omitted fields", async () => {
    setup({ tables: { playback_preferences: [preferencesRow({ genre_id: GENRE_LOUNGE, volume: 0.6, muted: false })] } });

    const body = await readOk<UpdatePreferencesResponse>(await put({ muted: true }));

    expect(body.preferences).toEqual({ genreId: GENRE_LOUNGE, volume: 0.6, muted: true });
  });

  it("saves a visible genre", async () => {
    const fake = setup({ tables: { playback_preferences: [preferencesRow()] } });

    const body = await readOk<UpdatePreferencesResponse>(await put({ genreId: GENRE_JAZZ }));

    expect(body.preferences.genreId).toBe(GENRE_JAZZ);
    expect(fake.queriesFor("genres")[0].filters).toEqual([{ op: "eq", column: "id", value: GENRE_JAZZ }]);
  });

  it("clears the genre when genreId is null", async () => {
    setup({ tables: { playback_preferences: [preferencesRow({ genre_id: GENRE_JAZZ })] } });
    const body = await readOk<UpdatePreferencesResponse>(await put({ genreId: null }));
    expect(body.preferences.genreId).toBeNull();
  });

  it("refuses a genre the venue cannot see with 403 forbidden and writes nothing", async () => {
    const fake = setup({ tables: { playback_preferences: [preferencesRow({ genre_id: GENRE_JAZZ })] } });

    const error = await readError(await put({ genreId: GENRE_HIDDEN, volume: 0.2 }));

    expect(error).toMatchObject({ status: 403, code: "forbidden" });
    expect(error.message).toMatch(/not available/i);
    expect(fake.queriesFor("playback_preferences", "upsert")).toHaveLength(0);
    expect(fake.tables.playback_preferences[0]).toMatchObject({ genre_id: GENRE_JAZZ, volume: 0.8 });
  });

  it("maps the RLS with-check backstop (genre revoked after the check) to 403 forbidden", async () => {
    // The genre is still visible to the pre-check, but the database refuses the row.
    setup({ upsertCheck: withCheck([]) });

    const error = await readError(await put({ genreId: GENRE_JAZZ }));

    expect(error).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("clears a stored genre that is no longer available so volume changes still save", async () => {
    const fake = setup({ tables: { playback_preferences: [preferencesRow({ genre_id: GENRE_HIDDEN, volume: 0.5 })] } });

    const body = await readOk<UpdatePreferencesResponse>(await put({ volume: 0.9 }));

    expect(body.preferences).toEqual({ genreId: null, volume: 0.9, muted: false });
    expect(fake.queriesFor("playback_preferences", "upsert")[0].payload).toMatchObject({ genre_id: null, volume: 0.9 });
  });

  it("leaves a still-visible stored genre untouched on a volume change", async () => {
    const fake = setup({ tables: { playback_preferences: [preferencesRow({ genre_id: GENRE_JAZZ })] } });

    const body = await readOk<UpdatePreferencesResponse>(await put({ volume: 0.1 }));

    expect(body.preferences.genreId).toBe(GENRE_JAZZ);
    expect(fake.queriesFor("playback_preferences", "upsert")[0].payload).not.toHaveProperty("genre_id");
  });

  it("ignores user or business ids in the body and always writes the session's own row", async () => {
    const fake = setup();

    const body = await readOk<UpdatePreferencesResponse>(
      await put({ volume: 0.4, businessId: OTHER_BUSINESS_ID, business_id: OTHER_BUSINESS_ID, userId: OTHER_USER_ID, user_id: OTHER_USER_ID }),
    );

    expect(body.preferences.volume).toBe(0.4);
    const [upsert] = fake.queriesFor("playback_preferences", "upsert");
    expect(upsert.payload).toEqual({ user_id: USER_ID, business_id: BUSINESS_ID, volume: 0.4 });
    expect(fake.tables.playback_preferences).toHaveLength(1);
    expect(fake.tables.playback_preferences[0]).toMatchObject({ user_id: USER_ID, business_id: BUSINESS_ID });
  });

  it.each([
    ["an empty object", {}],
    ["a volume above 1", { volume: 1.5 }],
    ["a negative volume", { volume: -0.1 }],
    ["a non-boolean muted", { muted: "yes" }],
    ["a malformed genre id", { genreId: "jazz" }],
  ])("rejects %s with 400 invalid_request", async (_label, payload) => {
    const fake = setup();
    const error = await readError(await put(payload));
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
    expect(fake.queries).toHaveLength(0);
  });

  it("rejects invalid JSON with 400", async () => {
    setup();
    expect(await readError(await put("{volume: 0.5"))).toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("rejects a non-JSON content type with 415", async () => {
    setup();
    const error = await readError(await put(JSON.stringify({ volume: 0.5 }), { "content-type": "text/plain" }));
    expect(error).toMatchObject({ status: 415, code: "invalid_request" });
  });

  it("maps an unexpected database error to a generic 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setup({ failUpserts: { playback_preferences: pgError("53300", "too many connections for role authenticator") } });

    const response = await put({ muted: true });
    const text = await response.clone().text();

    expect(await readError(response)).toMatchObject({ status: 500, code: "server_error" });
    expect(text).not.toContain("authenticator");
    expect(consoleError).toHaveBeenCalled();
  });
});
