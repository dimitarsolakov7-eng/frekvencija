/**
 * Fixture tracks for /dev/preview/music (screen 05) and an in-memory version of the library query
 * (search, genre, status, sort, paging with the same rules as loadTrackPage), so the filters can be
 * tried without Supabase. Never used outside /dev.
 */
import {
  countForStatus,
  NO_GENRE,
  normalizeSearch,
  pageCount,
  pageRange,
  TRACK_PAGE_SIZE,
  trackState,
  type TrackListQuery,
  type TrackStatusFilter,
} from "@/components/admin/catalog/track-query";
import type { GenreOption, TrackPage, TrackStatusCounts } from "@/components/admin/catalog/types";
import type { AdminTrack } from "@/lib/api/contracts";
import { PREVIEW_GENRE_IDS, PREVIEW_GENRES, toGenreOptions } from "../genres/fixtures";

const ARTIST = "Frekvencija Sessions";

function track(
  index: number,
  title: string,
  durationSeconds: number,
  genreIds: string[],
  extra: Partial<AdminTrack> = {},
): AdminTrack {
  // Newest first: the first fixture was "uploaded" most recently.
  const created = new Date(Date.UTC(2026, 8, 24, 18, 0, 0) - index * 3_600_000).toISOString();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: `7d3e1c52-4b6a-4f8e-9a1d-${String(index + 1).padStart(12, "0")}`,
    title,
    artist: ARTIST,
    durationSeconds,
    fileSizeBytes: Math.round(durationSeconds * 24_000),
    bitrateKbps: 192,
    originalFilename: `${slug}.mp3`,
    isActive: true,
    removedAt: null,
    genreIds,
    createdAt: created,
    updatedAt: created,
    ...extra,
  };
}

export const PREVIEW_TRACKS: readonly AdminTrack[] = [
  track(0, "Afterglow", 248, [PREVIEW_GENRE_IDS.house]),
  track(1, "Slow Motion", 312, [PREVIEW_GENRE_IDS.deepHouse]),
  track(2, "Amber Lights", 276, [PREVIEW_GENRE_IDS.lounge]),
  track(3, "Midnight Notes", 222, [PREVIEW_GENRE_IDS.jazz]),
  track(4, "City Rhythm", 234, [PREVIEW_GENRE_IDS.balkanHits]),
  track(5, "Blue Horizon", 328, [PREVIEW_GENRE_IDS.chillout], { isActive: false }),
  track(6, "Night Shift", 301, [PREVIEW_GENRE_IDS.house, PREVIEW_GENRE_IDS.deepHouse]),
  track(7, "Velvet Hour", 265, [PREVIEW_GENRE_IDS.lounge], { removedAt: "2026-09-20T10:00:00.000Z" }),
];

function matchesStatus(item: AdminTrack, status: TrackStatusFilter): boolean {
  return status === "all" || trackState(item) === status;
}

function matchesQuery(item: AdminTrack, query: TrackListQuery): boolean {
  const needle = normalizeSearch(query.q).toLowerCase();
  if (needle && !item.title.toLowerCase().includes(needle) && !item.artist.toLowerCase().includes(needle)) return false;
  if (query.genre === NO_GENRE) return item.genreIds.length === 0;
  if (query.genre) return item.genreIds.includes(query.genre);
  return true;
}

function compare(query: TrackListQuery) {
  return (a: AdminTrack, b: AdminTrack): number => {
    switch (query.sort) {
      case "newest":
        return b.createdAt.localeCompare(a.createdAt);
      case "oldest":
        return a.createdAt.localeCompare(b.createdAt);
      case "title":
        return a.title.localeCompare(b.title, "en");
      case "artist":
        return a.artist.localeCompare(b.artist, "en") || a.title.localeCompare(b.title, "en");
    }
  };
}

export interface MusicFixture {
  query: TrackListQuery;
  genres: GenreOption[];
  page: TrackPage;
  unknownGenre: boolean;
}

/** The same shapes /admin/music loads, computed from the fixtures. `empty` = a catalogue with no tracks. */
export function buildMusicFixture(requested: TrackListQuery, options: { empty?: boolean } = {}): MusicFixture {
  const genres = toGenreOptions(PREVIEW_GENRES);
  let query = requested;
  let unknownGenre = false;
  if (query.genre && query.genre !== NO_GENRE && !genres.some((genre) => genre.id === query.genre)) {
    query = { ...query, genre: null, page: 1 };
    unknownGenre = true;
  }
  const source = options.empty ? [] : PREVIEW_TRACKS;
  const matching = source.filter((item) => matchesQuery(item, query));
  const statusCounts: TrackStatusCounts = {
    active: matching.filter((item) => trackState(item) === "active").length,
    inactive: matching.filter((item) => trackState(item) === "inactive").length,
    removed: matching.filter((item) => trackState(item) === "removed").length,
  };
  const filtered = matching.filter((item) => matchesStatus(item, query.status)).sort(compare(query));
  const { from, to } = pageRange(query.page, TRACK_PAGE_SIZE);
  const total = countForStatus(query.status, statusCounts);
  return {
    query,
    genres,
    unknownGenre,
    page: {
      tracks: filtered.slice(from, to + 1).map((item) => ({ ...item, genreIds: [...item.genreIds] })),
      total,
      page: query.page,
      pageSize: TRACK_PAGE_SIZE,
      pageCount: pageCount(total, TRACK_PAGE_SIZE),
      statusCounts,
    },
  };
}
