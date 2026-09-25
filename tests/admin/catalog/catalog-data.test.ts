import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TRACK_QUERY, NO_GENRE, type TrackListQuery } from "@/components/admin/catalog/track-query";
import {
  CatalogLoadError,
  loadGenreAccessBusinessIds,
  loadGenreCatalog,
  loadGenreOptions,
  loadTrackPage,
  nextGenreSortOrder,
  removeTrackObjects,
} from "@/lib/data/admin/catalog";
import type { Tables } from "@/types/database";
import { callsTo, createFakeSupabase, isCountQuery, type RecordedQuery } from "./fake-supabase";

const GENRE_A = "11111111-1111-4111-8111-111111111111";
const GENRE_B = "22222222-2222-4222-8222-222222222222";

type TrackListRow = Tables<"tracks"> & { track_genres: { genre_id: string }[] };

function trackRow(id: string, overrides: Partial<TrackListRow> = {}): TrackListRow {
  return {
    id,
    title: `Track ${id}`,
    artist: "Artist",
    duration_seconds: 180.5,
    storage_path: `tracks/${id}/abc.mp3`,
    file_size_bytes: 4_000_000,
    mime_type: "audio/mpeg",
    bitrate_kbps: 192,
    sample_rate_hz: 44100,
    original_filename: `${id}.mp3`,
    is_active: true,
    removed_at: null,
    created_by: null,
    created_at: "2026-09-25T10:00:00Z",
    updated_at: "2026-09-25T10:00:00Z",
    track_genres: [],
    ...overrides,
  };
}

/** Status of a tracks count query, derived from its filters. */
function countStatus(query: RecordedQuery): "active" | "inactive" | "removed" | "other" {
  if (callsTo(query, "not").some(([column]) => column === "removed_at")) return "removed";
  const active = callsTo(query, "eq").find(([column]) => column === "is_active");
  if (active) return active[1] === true ? "active" : "inactive";
  return "other";
}

function trackResponder(rows: ReturnType<typeof trackRow>[], counts = { active: 7, inactive: 2, removed: 1 }) {
  return (query: RecordedQuery) => {
    if (query.table === "tracks" && isCountQuery(query)) {
      const status = countStatus(query);
      return { count: status === "other" ? 0 : counts[status] };
    }
    if (query.table === "tracks") return { data: rows };
    return { data: [] };
  };
}

describe("loadTrackPage", () => {
  it("loads one page with the default filters and per-status counts", async () => {
    const fake = createFakeSupabase({
      respond: trackResponder([trackRow("t1", { track_genres: [{ genre_id: GENRE_A }, { genre_id: GENRE_B }] }), trackRow("t2")]),
    });
    const page = await loadTrackPage(fake.client, DEFAULT_TRACK_QUERY);

    const rowsQuery = fake.queries.find((query) => query.table === "tracks" && !isCountQuery(query));
    expect(rowsQuery).toBeDefined();
    expect(callsTo(rowsQuery!, "select")[0][0]).toBe("*, track_genres(genre_id)");
    // The default "All statuses" does not filter on status at all.
    expect(callsTo(rowsQuery!, "is")).toEqual([]);
    expect(callsTo(rowsQuery!, "not")).toEqual([]);
    expect(callsTo(rowsQuery!, "eq")).toEqual([]);
    expect(callsTo(rowsQuery!, "order")).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(callsTo(rowsQuery!, "range")).toEqual([[0, 49]]);
    expect(callsTo(rowsQuery!, "or")).toEqual([]);

    expect(fake.queries.filter(isCountQuery)).toHaveLength(3);
    expect(page.statusCounts).toEqual({ active: 7, inactive: 2, removed: 1 });
    // "All statuses" = active + inactive + removed.
    expect(page.total).toBe(10);
    expect(page.pageCount).toBe(1);
    expect(page.tracks.map((track) => [track.id, track.genreIds])).toEqual([
      ["t1", [GENRE_A, GENRE_B]],
      ["t2", []],
    ]);
    expect(page.tracks[0]).toMatchObject({ durationSeconds: 180.5, fileSizeBytes: 4_000_000, bitrateKbps: 192, isActive: true });
    // Genre lists came from the embedded links: no extra request.
    expect(fake.queries.some((query) => query.table === "track_genres")).toBe(false);
  });

  it("applies search, status and sort to the page and the same search to the counts", async () => {
    const fake = createFakeSupabase({ respond: trackResponder([]) });
    const query: TrackListQuery = { q: "blue, moon", genre: null, status: "inactive", sort: "artist", page: 3 };
    const page = await loadTrackPage(fake.client, query);

    const rowsQuery = fake.queries.find((recorded) => recorded.table === "tracks" && !isCountQuery(recorded))!;
    expect(callsTo(rowsQuery, "or")).toEqual([["title.ilike.*blue_ moon*,artist.ilike.*blue_ moon*"]]);
    expect(callsTo(rowsQuery, "eq")).toContainEqual(["is_active", false]);
    expect(callsTo(rowsQuery, "is")).toContainEqual(["removed_at", null]);
    expect(callsTo(rowsQuery, "range")).toEqual([[100, 149]]);
    expect(callsTo(rowsQuery, "order")[0]).toEqual(["artist", { ascending: true }]);
    for (const countQuery of fake.queries.filter(isCountQuery)) {
      expect(callsTo(countQuery, "or")).toEqual([["title.ilike.*blue_ moon*,artist.ilike.*blue_ moon*"]]);
    }
    expect(page.total).toBe(2);
  });

  it("filters by genre with an inner-join filter and reads complete genre lists separately", async () => {
    const rows = [trackRow("t1", { track_genres: [{ genre_id: GENRE_A }] }), trackRow("t2", { track_genres: [{ genre_id: GENRE_A }] })];
    const fake = createFakeSupabase({
      respond: (query) => {
        if (query.table === "track_genres") {
          return {
            data: [
              { track_id: "t1", genre_id: GENRE_A },
              { track_id: "t1", genre_id: GENRE_B },
              { track_id: "t2", genre_id: GENRE_A },
            ],
          };
        }
        return trackResponder(rows)(query);
      },
    });
    const page = await loadTrackPage(fake.client, { ...DEFAULT_TRACK_QUERY, genre: GENRE_A, status: "all" });

    for (const query of fake.queries.filter((recorded) => recorded.table === "tracks")) {
      expect(callsTo(query, "eq")).toContainEqual(["track_genres.genre_id", GENRE_A]);
      expect(callsTo(query, "not")).toContainEqual(["track_genres", "is", null]);
    }
    const linksQuery = fake.queries.find((query) => query.table === "track_genres")!;
    expect(callsTo(linksQuery, "in")).toEqual([["track_id", ["t1", "t2"]]]);
    expect(page.tracks.map((track) => track.genreIds)).toEqual([[GENRE_A, GENRE_B], [GENRE_A]]);
    expect(page.total).toBe(10);
  });

  it("finds tracks without a genre with an anti-join filter", async () => {
    const fake = createFakeSupabase({ respond: trackResponder([trackRow("t1")]) });
    await loadTrackPage(fake.client, { ...DEFAULT_TRACK_QUERY, genre: NO_GENRE });
    for (const query of fake.queries.filter((recorded) => recorded.table === "tracks")) {
      expect(callsTo(query, "is")).toContainEqual(["track_genres", null]);
      expect(callsTo(query, "eq").some(([column]) => column === "track_genres.genre_id")).toBe(false);
    }
  });

  it("treats a page past the end (PGRST103) as empty instead of failing", async () => {
    const fake = createFakeSupabase({
      respond: (query) =>
        query.table === "tracks" && !isCountQuery(query)
          ? { error: { code: "PGRST103", message: "Requested range not satisfiable" } }
          : trackResponder([])(query),
    });
    const page = await loadTrackPage(fake.client, { ...DEFAULT_TRACK_QUERY, page: 40 });
    expect(page.tracks).toEqual([]);
    expect(page.total).toBe(10);
    expect(page.pageCount).toBe(1);
  });

  it("throws CatalogLoadError on other database errors", async () => {
    const failingRows = createFakeSupabase({
      respond: (query) => (isCountQuery(query) ? { count: 0 } : { error: { code: "42501", message: "denied" } }),
    });
    await expect(loadTrackPage(failingRows.client, DEFAULT_TRACK_QUERY)).rejects.toBeInstanceOf(CatalogLoadError);

    const failingCounts = createFakeSupabase({
      respond: (query) => (isCountQuery(query) ? { error: { code: "57014", message: "timeout" } } : { data: [] }),
    });
    await expect(loadTrackPage(failingCounts.client, DEFAULT_TRACK_QUERY)).rejects.toBeInstanceOf(CatalogLoadError);
  });
});

const COVER_A = `${GENRE_A}/${"a".repeat(32)}.png`;

describe("loadGenreCatalog", () => {
  it("merges genres, track counts, business access and signed covers in display order", async () => {
    const fake = createFakeSupabase({
      respond: (query) => {
        switch (query.table) {
          case "genres":
            return {
              data: [
                { id: GENRE_A, name: "Jazz", slug: "jazz", description: null, sort_order: 1, is_enabled: true, available_to_all: false, cover_path: COVER_A },
                { id: GENRE_B, name: "Pop", slug: "pop", description: "Hits", sort_order: 2, is_enabled: false, available_to_all: true, cover_path: null },
              ],
            };
          case "business_genre_access":
            return { data: [{ business_id: "b1", genre_id: GENRE_A }, { business_id: "b2", genre_id: GENRE_A }] };
          case "businesses":
            return { data: [{ id: "b1", name: "EmeraldBar", is_active: true }, { id: "b2", name: "Hotel Aurora", is_active: false }] };
          default:
            return { data: [] };
        }
      },
      rpc: (name) =>
        name === "genre_track_counts" ? { data: [{ genre_id: GENRE_A, playable_count: 3, total_count: 5 }] } : { data: null },
    });

    const catalog = await loadGenreCatalog(fake.client);
    expect(catalog.genres).toEqual([
      {
        id: GENRE_A,
        name: "Jazz",
        slug: "jazz",
        description: null,
        sortOrder: 1,
        isEnabled: true,
        availableToAll: false,
        playableCount: 3,
        totalCount: 5,
        accessBusinessIds: ["b1", "b2"],
        coverPath: COVER_A,
        coverUrl: expect.stringContaining(`https://storage.test/sign/genre-covers/${COVER_A}?ttl=`),
      },
      {
        id: GENRE_B,
        name: "Pop",
        slug: "pop",
        description: "Hits",
        sortOrder: 2,
        isEnabled: false,
        availableToAll: true,
        playableCount: 0,
        totalCount: 0,
        accessBusinessIds: [],
        coverPath: null,
        coverUrl: null,
      },
    ]);
    expect(catalog.businesses).toEqual([
      { id: "b1", name: "EmeraldBar", isActive: true },
      { id: "b2", name: "Hotel Aurora", isActive: false },
    ]);
    const genresQuery = fake.queries.find((query) => query.table === "genres")!;
    expect(callsTo(genresQuery, "select")[0][0]).toContain("cover_path");
    expect(callsTo(genresQuery, "order")[0]).toEqual(["sort_order", { ascending: true }]);
    // One batch request for every cover, on the admin's own client.
    expect(fake.storageCalls.filter((call) => call.method === "createSignedUrls")).toEqual([
      { bucket: "genre-covers", method: "createSignedUrls", args: [[COVER_A], expect.any(Number)] },
    ]);
  });

  it("falls back to default artwork (null) when covers cannot be signed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = createFakeSupabase({
      respond: (query) =>
        query.table === "genres"
          ? { data: [{ id: GENRE_A, name: "Jazz", slug: "jazz", description: null, sort_order: 1, is_enabled: true, available_to_all: true, cover_path: COVER_A }] }
          : { data: [] },
      rpc: () => ({ data: [] }),
      storage: { createSignedUrls: () => ({ error: { message: "storage down" } }) },
    });
    const catalog = await loadGenreCatalog(fake.client);
    expect(catalog.genres[0]).toMatchObject({ coverPath: COVER_A, coverUrl: null });
    warn.mockRestore();
  });

  it("does not call Storage when no genre has a cover", async () => {
    const fake = createFakeSupabase({
      respond: (query) =>
        query.table === "genres"
          ? { data: [{ id: GENRE_A, name: "Jazz", slug: "jazz", description: null, sort_order: 1, is_enabled: true, available_to_all: true, cover_path: null }] }
          : { data: [] },
      rpc: () => ({ data: [] }),
    });
    await loadGenreCatalog(fake.client);
    expect(fake.storageCalls).toEqual([]);
  });

  it("reads past PostgREST's 1000-row limit page by page", async () => {
    const accessRows = Array.from({ length: 1000 }, (_, index) => ({ business_id: `b${index}`, genre_id: GENRE_A }));
    let accessPages = 0;
    const fake = createFakeSupabase({
      respond: (query) => {
        if (query.table !== "business_genre_access") return { data: [] };
        accessPages += 1;
        const [[from]] = callsTo(query, "range") as [number, number][];
        return { data: from === 0 ? accessRows : [{ business_id: "last", genre_id: GENRE_A }] };
      },
      rpc: () => ({ data: [] }),
    });
    await loadGenreCatalog(fake.client);
    expect(accessPages).toBe(2);
    const ranges = fake.queries.filter((query) => query.table === "business_genre_access").map((query) => callsTo(query, "range")[0]);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("throws CatalogLoadError when a query fails", async () => {
    const fake = createFakeSupabase({ respond: () => ({ data: [] }), rpc: () => ({ error: { code: "42501", message: "denied" } }) });
    await expect(loadGenreCatalog(fake.client)).rejects.toBeInstanceOf(CatalogLoadError);
  });
});

describe("loadGenreOptions", () => {
  it("returns id, name, slug, state and a signed cover per genre, in display order", async () => {
    const fake = createFakeSupabase({
      respond: () => ({
        data: [
          { id: GENRE_A, name: "Jazz", slug: "jazz", is_enabled: true, cover_path: COVER_A },
          { id: GENRE_B, name: "Pop", slug: "pop", is_enabled: false, cover_path: null },
        ],
      }),
    });
    const options = await loadGenreOptions(fake.client);
    expect(options).toEqual([
      { id: GENRE_A, name: "Jazz", slug: "jazz", isEnabled: true, coverUrl: expect.stringContaining(`/sign/genre-covers/${COVER_A}`) },
      { id: GENRE_B, name: "Pop", slug: "pop", isEnabled: false, coverUrl: null },
    ]);
    expect(callsTo(fake.queries[0], "order")[0]).toEqual(["sort_order", { ascending: true }]);
  });
});

describe("write helpers", () => {
  it("appends new genres after the last sort_order", async () => {
    const withGenres = createFakeSupabase({ respond: () => ({ data: { sort_order: 7 } }) });
    await expect(nextGenreSortOrder(withGenres.client)).resolves.toBe(8);
    const empty = createFakeSupabase({ respond: () => ({ data: null }) });
    await expect(nextGenreSortOrder(empty.client)).resolves.toBe(1);
  });

  it("reads a genre's access rows", async () => {
    const fake = createFakeSupabase({ respond: () => ({ data: [{ business_id: "b1" }, { business_id: "b2" }] }) });
    await expect(loadGenreAccessBusinessIds(fake.client, GENRE_A)).resolves.toEqual(["b1", "b2"]);
    expect(callsTo(fake.queries[0], "eq")).toEqual([["genre_id", GENRE_A]]);
  });
});

describe("removeTrackObjects", () => {
  it("removes the track's object and any other file in its folder", async () => {
    const fake = createFakeSupabase({
      storage: {
        list: () => ({
          data: [
            { name: "abc.mp3", id: "o1" },
            { name: "orphan.mp3", id: "o2" },
            { name: "nested", id: null },
          ],
        }),
      },
    });
    await expect(removeTrackObjects(fake.client, "t1", "tracks/t1/abc.mp3")).resolves.toEqual({ ok: true, removed: 2 });
    expect(fake.storageCalls).toEqual([
      { bucket: "music", method: "list", args: ["tracks/t1", { limit: 100 }] },
      { bucket: "music", method: "remove", args: [["tracks/t1/abc.mp3", "tracks/t1/orphan.mp3"]] },
    ]);
  });

  it("still removes the row's own object when listing fails", async () => {
    const fake = createFakeSupabase({ storage: { list: () => ({ error: { message: "boom" } }) } });
    const originalError = console.error;
    console.error = () => undefined;
    try {
      await expect(removeTrackObjects(fake.client, "t1", "tracks/t1/abc.mp3")).resolves.toMatchObject({ ok: true });
    } finally {
      console.error = originalError;
    }
    expect(fake.storageCalls.at(-1)).toEqual({ bucket: "music", method: "remove", args: [["tracks/t1/abc.mp3"]] });
  });

  it("reports a failed removal", async () => {
    const fake = createFakeSupabase({ storage: { remove: () => ({ error: { message: "storage down" } }) } });
    const outcome = await removeTrackObjects(fake.client, "t1", "tracks/t1/abc.mp3");
    expect(outcome.ok).toBe(false);
  });
});
