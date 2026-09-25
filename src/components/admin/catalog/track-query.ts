/**
 * /admin/music list query: URL search params ⇄ a validated query object, plus the PostgREST search
 * pattern. Pure and client-safe (the page parses on the server, the filters build links on the client).
 */

export const TRACK_PAGE_SIZE = 50;
export const MAX_TRACK_SEARCH_LENGTH = 100;
/** Deep links past this page are treated as page 1 (keeps range() offsets sane). */
export const MAX_TRACK_PAGE = 10_000;

/**
 * Status filter (screen 05 "All statuses" select). The default shows every track; "active" means
 * playable (enabled and not removed), "inactive" enabled-switch off but still in the catalogue,
 * "removed" soft-removed from playback.
 */
export const TRACK_STATUS_FILTERS = ["all", "active", "inactive", "removed"] as const;
export type TrackStatusFilter = (typeof TRACK_STATUS_FILTERS)[number];

/** Older links used these values; they still open a sensible view. */
const LEGACY_STATUS_ALIASES: Readonly<Record<string, TrackStatusFilter>> = {
  disabled: "inactive",
  current: "all",
};

export const TRACK_SORTS = ["newest", "oldest", "title", "artist"] as const;
export type TrackSort = (typeof TRACK_SORTS)[number];

/** Pseudo genre id for "tracks without any genre". */
export const NO_GENRE = "none";

export const TRACK_STATUS_LABELS: Record<TrackStatusFilter, string> = {
  all: "All statuses",
  active: "Active",
  inactive: "Inactive",
  removed: "Removed",
};

export const TRACK_STATUS_DESCRIPTIONS: Record<TrackStatusFilter, string> = {
  all: "Every track, including inactive and removed ones",
  active: "Playing at venues",
  inactive: "Kept in the catalogue but not played",
  removed: "Removed from playback",
};

export const TRACK_SORT_LABELS: Record<TrackSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title A–Z",
  artist: "Artist A–Z",
};

export interface TrackListQuery {
  /** Trimmed search text ("" = no search). */
  q: string;
  /** Genre id, NO_GENRE, or null for every genre. */
  genre: string | null;
  status: TrackStatusFilter;
  sort: TrackSort;
  /** 1-based page number. */
  page: number;
}

export const DEFAULT_TRACK_QUERY: Readonly<TrackListQuery> = Object.freeze({
  q: "",
  genre: null,
  status: "all",
  sort: "newest",
  page: 1,
});

type RawSearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstValue(params: RawSearchParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function isOneOf<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (values as readonly string[]).includes(value);
}

/** Collapses whitespace and caps the length (never splits a surrogate pair). */
export function normalizeSearch(value: string | undefined | null): string {
  const collapsed = (value ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_TRACK_SEARCH_LENGTH) return collapsed;
  let out = "";
  for (const char of collapsed) {
    if (out.length + char.length > MAX_TRACK_SEARCH_LENGTH) break;
    out += char;
  }
  return out.trim();
}

/** A status filter value from the URL (current or legacy spelling), or the default. */
export function parseTrackStatus(value: string | undefined | null): TrackStatusFilter {
  const raw = value?.trim().toLowerCase();
  if (isOneOf(TRACK_STATUS_FILTERS, raw)) return raw;
  return (raw && LEGACY_STATUS_ALIASES[raw]) || DEFAULT_TRACK_QUERY.status;
}

/** Parses page `searchParams` leniently: anything invalid falls back to its default. */
export function parseTrackListQuery(params: RawSearchParams): TrackListQuery {
  const genreRaw = firstValue(params, "genre")?.trim();
  const sortRaw = firstValue(params, "sort")?.trim();
  const pageRaw = firstValue(params, "page")?.trim() ?? "";
  const pageNumber = /^\d{1,6}$/.test(pageRaw) ? Number(pageRaw) : 1;

  return {
    q: normalizeSearch(firstValue(params, "q")),
    genre: genreRaw === NO_GENRE ? NO_GENRE : genreRaw && GUID_PATTERN.test(genreRaw) ? genreRaw.toLowerCase() : null,
    status: parseTrackStatus(firstValue(params, "status")),
    sort: isOneOf(TRACK_SORTS, sortRaw) ? sortRaw : DEFAULT_TRACK_QUERY.sort,
    page: pageNumber >= 1 && pageNumber <= MAX_TRACK_PAGE ? pageNumber : 1,
  };
}

/** Search params for a query, leaving out defaults so URLs stay short and shareable. */
export function trackListSearchParams(query: TrackListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.genre) params.set("genre", query.genre);
  if (query.status !== DEFAULT_TRACK_QUERY.status) params.set("status", query.status);
  if (query.sort !== DEFAULT_TRACK_QUERY.sort) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

export const MUSIC_PATH = "/admin/music";

/**
 * Link to the list with some parts of the query changed. Changing anything other than the page
 * starts again at page 1. `basePath` lets a development preview keep its own route.
 */
export function trackListHref(query: TrackListQuery, patch: Partial<TrackListQuery> = {}, basePath: string = MUSIC_PATH): string {
  const changesFilter = (Object.keys(patch) as (keyof TrackListQuery)[]).some((key) => key !== "page" && patch[key] !== query[key]);
  const next: TrackListQuery = { ...query, ...patch, page: patch.page ?? (changesFilter ? 1 : query.page) };
  const search = trackListSearchParams(next).toString();
  return search ? `${basePath}?${search}` : basePath;
}

/** The library filtered to one genre (the genre editor's "Manage tracks"). */
export function genreTracksHref(genreId: string, basePath: string = MUSIC_PATH): string {
  return trackListHref(DEFAULT_TRACK_QUERY, { genre: genreId }, basePath);
}

/** True when search, genre or status narrow the list (sort and page do not). */
export function hasActiveFilters(query: TrackListQuery): boolean {
  return query.q !== "" || query.genre !== null || query.status !== DEFAULT_TRACK_QUERY.status;
}

/**
 * ilike pattern for PostgREST's `or=(title.ilike.…,artist.ilike.…)`. Characters that would break
 * the filter syntax (`,` `(` `)` `"` `\` `:` `.`) and the LIKE wildcards `%` `*` are replaced by `_`
 * (LIKE's single-character wildcard), so "Hello, World" still matches and nothing can inject another
 * filter. Returns null when there is nothing to search for.
 */
export function toIlikePattern(search: string): string | null {
  const text = normalizeSearch(search);
  if (!text) return null;
  return `*${text.replace(/[,()"\\:.%*]/g, "_")}*`;
}

/** PostgREST `or` filter searching title and artist. */
export function trackSearchFilter(search: string): string | null {
  const pattern = toIlikePattern(search);
  return pattern ? `title.ilike.${pattern},artist.ilike.${pattern}` : null;
}

/** Inclusive row range for Supabase `.range(from, to)`. */
export function pageRange(page: number, pageSize: number = TRACK_PAGE_SIZE): { from: number; to: number } {
  const safePage = Number.isSafeInteger(page) && page >= 1 ? page : 1;
  const from = (safePage - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function pageCount(total: number, pageSize: number = TRACK_PAGE_SIZE): number {
  return total <= 0 ? 0 : Math.ceil(total / pageSize);
}

/** Number of tracks in a status filter, from the per-status counts. */
export function countForStatus(status: TrackStatusFilter, counts: { active: number; inactive: number; removed: number }): number {
  switch (status) {
    case "active":
      return counts.active;
    case "inactive":
      return counts.inactive;
    case "removed":
      return counts.removed;
    case "all":
      return counts.active + counts.inactive + counts.removed;
  }
}

const COUNT_FORMAT = new Intl.NumberFormat("en");

/** Thousands-separated count ("1,234"), identical on server and client. */
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

/** "1 track", "1,234 tracks". */
export function formatTrackCount(value: number): string {
  return `${formatCount(value)} ${value === 1 ? "track" : "tracks"}`;
}

export type TrackState = "active" | "inactive" | "removed";

/** Removal wins over the enable switch: a removed track never plays, whatever `isActive` says. */
export function trackState(track: { isActive: boolean; removedAt: string | null }): TrackState {
  if (track.removedAt !== null) return "removed";
  return track.isActive ? "active" : "inactive";
}

export const TRACK_STATE_LABELS: Record<TrackState, string> = {
  active: "Active",
  inactive: "Inactive",
  removed: "Removed",
};

/** StatusPill tone for a track state. */
export function trackStateTone(state: TrackState): "success" | "neutral" | "danger" {
  switch (state) {
    case "active":
      return "success";
    case "inactive":
      return "neutral";
    case "removed":
      return "danger";
  }
}

/** "Showing 51–100 of 312", or null when the page is empty. */
export function describePageWindow(page: number, pageSize: number, shown: number, total: number): string | null {
  if (shown <= 0) return null;
  const { from } = pageRange(page, pageSize);
  const format = (value: number) => COUNT_FORMAT.format(value);
  const first = format(from + 1);
  const last = format(from + shown);
  return first === last ? `Showing ${first} of ${format(total)}` : `Showing ${first}–${last} of ${format(total)}`;
}
