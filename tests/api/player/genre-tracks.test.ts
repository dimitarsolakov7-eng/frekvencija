import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/player/genres/[genreId]/tracks/route";
import type { GenreTracksResponse } from "@/lib/api/contracts";
import { TRACK_PAGE_SIZE } from "@/lib/data/player";
import { FakeSupabase, pgError, type FakeSupabaseOptions, type Row } from "./fake-supabase";
import {
  GENRE_HIDDEN,
  GENRE_JAZZ,
  GENRE_LOUNGE,
  genreRow,
  grantAccess,
  readError,
  readOk,
  TRACK_1,
  TRACK_2,
  TRACK_3,
  TRACK_4,
  trackRow,
} from "./helpers";

const { requireBusinessUserApi } = vi.hoisted(() => ({ requireBusinessUserApi: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireBusinessUserApi }));

function setup(options: FakeSupabaseOptions = {}): FakeSupabase {
  const fake = new FakeSupabase({
    ...options,
    tables: { genres: [genreRow(GENRE_JAZZ), genreRow(GENRE_LOUNGE)], tracks: [], ...options.tables },
  });
  requireBusinessUserApi.mockResolvedValue(grantAccess(fake));
  return fake;
}

function get(genreId: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/player/genres/${genreId}/tracks`), { params: Promise.resolve({ genreId }) });
}

beforeEach(() => {
  requireBusinessUserApi.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/player/genres/[genreId]/tracks", () => {
  it("returns the genre's playable tracks in a stable order with numeric durations", async () => {
    const fake = setup({
      tables: {
        tracks: [
          trackRow(TRACK_2, [GENRE_JAZZ], { title: "Second", created_at: "2026-09-02T12:00:00.000Z", duration_seconds: "215.40" }),
          trackRow(TRACK_1, [GENRE_JAZZ, GENRE_LOUNGE], { title: "First", artist: "Ada", created_at: "2026-09-02T11:00:00.000Z" }),
          trackRow(TRACK_3, [GENRE_LOUNGE], { title: "Other genre" }),
        ],
      },
    });

    const body = await readOk<GenreTracksResponse>(await get(GENRE_JAZZ));

    expect(body.genreId).toBe(GENRE_JAZZ);
    expect(body.tracks).toEqual([
      { id: TRACK_1, title: "First", artist: "Ada", durationSeconds: 180 },
      { id: TRACK_2, title: "Second", artist: "Test Artist", durationSeconds: 215.4 },
    ]);
    expect(typeof body.tracks[1].durationSeconds).toBe("number");
    expect(Number.isNaN(Date.parse(body.fetchedAt))).toBe(false);
    // Storage paths and flags never leave the server.
    expect(JSON.stringify(body)).not.toContain("storage_path");
    expect(JSON.stringify(body)).not.toContain("tracks/");

    const [query] = fake.queriesFor("tracks");
    expect(query.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "track_genres.genre_id", value: GENRE_JAZZ },
        { op: "eq", column: "is_active", value: true },
        { op: "is", column: "removed_at", value: null },
      ]),
    );
    expect(query.columns).toContain("track_genres!inner(");
    expect(query.orders.map((order) => order.column)).toEqual(["created_at", "id"]);
  });

  it("excludes disabled, removed and malformed tracks", async () => {
    setup({
      tables: {
        tracks: [
          trackRow(TRACK_1, [GENRE_JAZZ]),
          trackRow(TRACK_2, [GENRE_JAZZ], { is_active: false }),
          trackRow(TRACK_3, [GENRE_JAZZ], { removed_at: "2026-09-10T10:00:00.000Z" }),
          trackRow(TRACK_4, [GENRE_JAZZ], { duration_seconds: "not-a-number" }),
        ],
      },
    });

    const body = await readOk<GenreTracksResponse>(await get(GENRE_JAZZ));

    expect(body.tracks.map((track) => track.id)).toEqual([TRACK_1]);
  });

  it("returns an empty list for a visible genre without playable tracks", async () => {
    setup();
    const body = await readOk<GenreTracksResponse>(await get(GENRE_LOUNGE));
    expect(body).toMatchObject({ genreId: GENRE_LOUNGE, tracks: [] });
  });

  it("answers 404 not_found when RLS hides the genre", async () => {
    setup({ tables: { tracks: [trackRow(TRACK_1, [GENRE_HIDDEN])] } });

    const error = await readError(await get(GENRE_HIDDEN));

    expect(error).toMatchObject({ status: 404, code: "not_found" });
  });

  it("rejects an id that is not a uuid with 400 before querying", async () => {
    const fake = setup();

    const error = await readError(await get("not-a-uuid"));

    expect(error).toMatchObject({ status: 400, code: "invalid_request", fields: { genreId: "Invalid id." } });
    expect(fake.queries).toHaveLength(0);
  });

  it("reads every page when the genre has more tracks than one PostgREST page", async () => {
    const total = TRACK_PAGE_SIZE + 250;
    const tracks: Row[] = Array.from({ length: total }, (_, index) => {
      const suffix = index.toString(16).padStart(12, "0");
      return trackRow(`d0000000-0000-4000-8000-${suffix}`, [GENRE_JAZZ], {
        created_at: new Date(Date.UTC(2026, 8, 1) + index * 1000).toISOString(),
      });
    });
    const fake = setup({ tables: { tracks } });

    const body = await readOk<GenreTracksResponse>(await get(GENRE_JAZZ));

    expect(body.tracks).toHaveLength(total);
    expect(new Set(body.tracks.map((track) => track.id)).size).toBe(total);
    expect(fake.queriesFor("tracks").map((query) => query.range)).toEqual([
      [0, TRACK_PAGE_SIZE - 1],
      [TRACK_PAGE_SIZE, 2 * TRACK_PAGE_SIZE - 1],
    ]);
  });

  it("maps a database failure to a generic 500 without leaking details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setup({ failTables: { tracks: pgError("57014", "canceling statement due to statement timeout on tracks") } });

    const response = await get(GENRE_JAZZ);
    const text = await response.clone().text();
    const error = await readError(response);

    expect(error).toMatchObject({ status: 500, code: "server_error" });
    expect(text).not.toContain("statement timeout");
    expect(consoleError).toHaveBeenCalled();
  });
});
