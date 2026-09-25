import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  countForStatus,
  NO_GENRE,
  pageCount,
  pageRange,
  TRACK_PAGE_SIZE,
  trackSearchFilter,
  type TrackListQuery,
  type TrackStatusFilter,
} from "@/components/admin/catalog/track-query";
import type {
  AdminGenreItem,
  BusinessOption,
  GenreCatalog,
  GenreOption,
  TrackPage,
  TrackStatusCounts,
} from "@/components/admin/catalog/types";
import { toAdminTrack } from "@/lib/data/mappers";
import { signGenreCoverUrls } from "@/lib/media/signing";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

/**
 * Server-side reads (and a few write helpers) for the admin genre and music catalogue
 * (/admin/genres, /admin/music). Every query uses the admin's OWN client, so the RLS admin policies
 * are what grant access — including the Storage policy "genre-covers: admin select" used to sign
 * cover images for display. The secret-key client is only used by removeTrackObjects() for Storage.
 */

export class CatalogLoadError extends Error {
  constructor(what: string, options?: { cause?: unknown }) {
    super(`Could not load ${what}.`, options);
    this.name = "CatalogLoadError";
  }
}

/** PostgREST's default `max-rows` on Supabase; larger reads are fetched page by page. */
const READ_PAGE_SIZE = 1000;

type RowsResult<T> = { data: T[] | null; error: PostgrestError | null };

/** Reads every row of an ordered query in pages of READ_PAGE_SIZE (never silently truncated). */
async function fetchAllRows<T>(what: string, fetchPage: (from: number, to: number) => PromiseLike<RowsResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += READ_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + READ_PAGE_SIZE - 1);
    if (error) throw new CatalogLoadError(what, { cause: error });
    const page = data ?? [];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
}

// ---------------------------------------------------------------------------
// Genres
// ---------------------------------------------------------------------------

/**
 * Genres in display order with track counts, business access and signed cover URLs (one batch
 * signing request; a cover that cannot be signed shows the default artwork), plus every business.
 */
export async function loadGenreCatalog(supabase: TypedSupabaseClient): Promise<GenreCatalog> {
  const [genres, countsResult, accessRows, businesses] = await Promise.all([
    fetchAllRows("genres", (from, to) =>
      supabase
        .from("genres")
        .select("id, name, slug, description, sort_order, is_enabled, available_to_all, cover_path")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.rpc("genre_track_counts"),
    fetchAllRows("genre access", (from, to) =>
      supabase
        .from("business_genre_access")
        .select("business_id, genre_id")
        .order("genre_id", { ascending: true })
        .order("business_id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows("businesses", (from, to) =>
      supabase.from("businesses").select("id, name, is_active").order("name", { ascending: true }).order("id", { ascending: true }).range(from, to),
    ),
  ]);
  if (countsResult.error) throw new CatalogLoadError("genre track counts", { cause: countsResult.error });
  const coverUrls = await signGenreCoverUrls(
    supabase,
    genres.map((row) => row.cover_path),
  );

  const counts = new Map((countsResult.data ?? []).map((row) => [row.genre_id, row]));
  const accessByGenre = new Map<string, string[]>();
  for (const row of accessRows) {
    const list = accessByGenre.get(row.genre_id);
    if (list) list.push(row.business_id);
    else accessByGenre.set(row.genre_id, [row.business_id]);
  }

  const items: AdminGenreItem[] = genres.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sort_order,
    isEnabled: row.is_enabled,
    availableToAll: row.available_to_all,
    playableCount: counts.get(row.id)?.playable_count ?? 0,
    totalCount: counts.get(row.id)?.total_count ?? 0,
    accessBusinessIds: accessByGenre.get(row.id) ?? [],
    coverPath: row.cover_path,
    coverUrl: row.cover_path ? (coverUrls.get(row.cover_path) ?? null) : null,
  }));
  const businessOptions: BusinessOption[] = businesses.map((row) => ({ id: row.id, name: row.name, isActive: row.is_active }));
  return { genres: items, businesses: businessOptions };
}

/** Genres for filters, chips, pickers and track thumbnails, in display order, with signed covers. */
export async function loadGenreOptions(supabase: TypedSupabaseClient): Promise<GenreOption[]> {
  const rows = await fetchAllRows("genres", (from, to) =>
    supabase
      .from("genres")
      .select("id, name, slug, is_enabled, cover_path")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const coverUrls = await signGenreCoverUrls(
    supabase,
    rows.map((row) => row.cover_path),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    isEnabled: row.is_enabled,
    coverUrl: row.cover_path ? (coverUrls.get(row.cover_path) ?? null) : null,
  }));
}

/** Business ids that currently have an access row for the genre. */
export async function loadGenreAccessBusinessIds(supabase: TypedSupabaseClient, genreId: string): Promise<string[]> {
  const rows = await fetchAllRows("genre access", (from, to) =>
    supabase
      .from("business_genre_access")
      .select("business_id")
      .eq("genre_id", genreId)
      .order("business_id", { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => row.business_id);
}

/** sort_order for a new genre: after the current last one. */
export async function nextGenreSortOrder(supabase: TypedSupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("genres")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new CatalogLoadError("the genre order", { cause: error });
  return (data?.sort_order ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/** One select shape for the page query and the count queries, so they share the filter helper. */
const TRACK_LIST_SELECT = "*, track_genres(genre_id)";

function trackListBuilder(supabase: TypedSupabaseClient, mode: "rows" | "count") {
  return supabase
    .from("tracks")
    .select(TRACK_LIST_SELECT, mode === "count" ? { count: "exact", head: true } : undefined);
}

type TrackListBuilder = ReturnType<typeof trackListBuilder>;

/**
 * Search (title/artist), genre and status filters.
 * - A genre: the embedded filter keeps only that genre's link rows and `track_genres=not.is.null`
 *   keeps only tracks that have one (PostgREST's inner-join form), so the embedded list is partial
 *   and full genre lists are fetched separately.
 * - NO_GENRE: `track_genres=is.null` keeps tracks without any link (anti-join).
 */
function applyTrackFilters(builder: TrackListBuilder, query: TrackListQuery, status: TrackStatusFilter): TrackListBuilder {
  let filtered = builder;
  const search = trackSearchFilter(query.q);
  if (search) filtered = filtered.or(search);

  if (query.genre === NO_GENRE) {
    filtered = filtered.is("track_genres", null);
  } else if (query.genre) {
    filtered = filtered.eq("track_genres.genre_id", query.genre).not("track_genres", "is", null);
  }

  switch (status) {
    case "active":
      return filtered.is("removed_at", null).eq("is_active", true);
    case "inactive":
      return filtered.is("removed_at", null).eq("is_active", false);
    case "removed":
      return filtered.not("removed_at", "is", null);
    case "all":
      return filtered;
  }
}

function applyTrackSort(builder: TrackListBuilder, sort: TrackListQuery["sort"]): TrackListBuilder {
  switch (sort) {
    case "newest":
      return builder.order("created_at", { ascending: false }).order("id", { ascending: false });
    case "oldest":
      return builder.order("created_at", { ascending: true }).order("id", { ascending: true });
    case "title":
      return builder.order("title", { ascending: true }).order("artist", { ascending: true }).order("id", { ascending: true });
    case "artist":
      return builder.order("artist", { ascending: true }).order("title", { ascending: true }).order("id", { ascending: true });
  }
}

async function countTracks(supabase: TypedSupabaseClient, query: TrackListQuery, status: TrackStatusFilter): Promise<number> {
  const { count, error } = await applyTrackFilters(trackListBuilder(supabase, "count"), query, status);
  if (error) throw new CatalogLoadError("track counts", { cause: error });
  return count ?? 0;
}

/**
 * One page of the track list plus per-status counts for the same search and genre filter
 * (4 parallel requests, a 5th for complete genre lists when filtering by genre).
 */
export async function loadTrackPage(supabase: TypedSupabaseClient, query: TrackListQuery): Promise<TrackPage> {
  const { from, to } = pageRange(query.page, TRACK_PAGE_SIZE);
  const rowsQuery = applyTrackSort(applyTrackFilters(trackListBuilder(supabase, "rows"), query, query.status), query.sort).range(from, to);

  const [rowsResult, active, inactive, removed] = await Promise.all([
    rowsQuery,
    countTracks(supabase, query, "active"),
    countTracks(supabase, query, "inactive"),
    countTracks(supabase, query, "removed"),
  ]);

  let rows = rowsResult.data ?? [];
  if (rowsResult.error) {
    // PGRST103: the requested range starts after the last row (a stale or hand-edited page number).
    if (rowsResult.error.code !== "PGRST103") throw new CatalogLoadError("tracks", { cause: rowsResult.error });
    rows = [];
  }

  let genreIdsByTrack = new Map<string, string[]>(rows.map((row) => [row.id, (row.track_genres ?? []).map((link) => link.genre_id)]));
  if (query.genre && query.genre !== NO_GENRE && rows.length > 0) {
    // The embedded list only holds the filtered genre; read the complete lists for this page.
    const { data, error } = await supabase
      .from("track_genres")
      .select("track_id, genre_id")
      .in(
        "track_id",
        rows.map((row) => row.id),
      );
    if (error) throw new CatalogLoadError("track genres", { cause: error });
    genreIdsByTrack = new Map(rows.map((row) => [row.id, [] as string[]]));
    for (const link of data ?? []) genreIdsByTrack.get(link.track_id)?.push(link.genre_id);
  }

  const statusCounts: TrackStatusCounts = { active, inactive, removed };
  const total = countForStatus(query.status, statusCounts);
  return {
    // toAdminTrack reads only the track columns; the embedded link list is ignored.
    tracks: rows.map((row) => toAdminTrack(row, genreIdsByTrack.get(row.id) ?? [])),
    total,
    page: query.page,
    pageSize: TRACK_PAGE_SIZE,
    pageCount: pageCount(total, TRACK_PAGE_SIZE),
    statusCounts,
  };
}

// ---------------------------------------------------------------------------
// Storage clean-up for permanent deletion
// ---------------------------------------------------------------------------

export type RemoveObjectsOutcome = { ok: true; removed: number } | { ok: false; cause: unknown };

/**
 * Removes a track's audio from the `music` bucket with the SECRET-KEY client: the row's
 * `storage_path` plus any other object in its `tracks/{trackId}/` folder (e.g. left behind by an
 * interrupted replacement). Removing an object that is already gone is not an error, so a failed
 * deletion can simply be retried.
 */
export async function removeTrackObjects(admin: TypedSupabaseClient, trackId: string, storagePath: string): Promise<RemoveObjectsOutcome> {
  const bucket = admin.storage.from("music");
  const folder = `tracks/${trackId}`;
  const paths = new Set<string>([storagePath]);
  try {
    const listed = await bucket.list(folder, { limit: 100 });
    if (listed.error) {
      // Listing is only a clean-up bonus; the row's own object is still removed below.
      console.error(`[catalog] could not list music/${folder}`, listed.error);
    } else {
      for (const entry of listed.data) {
        if (entry.id !== null && entry.name) paths.add(`${folder}/${entry.name}`);
      }
    }
    const { data, error } = await bucket.remove([...paths]);
    if (error) return { ok: false, cause: error };
    return { ok: true, removed: data?.length ?? 0 };
  } catch (cause) {
    return { ok: false, cause };
  }
}
