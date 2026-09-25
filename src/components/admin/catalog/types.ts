/**
 * Read models for the admin genre and music catalogue pages. Loaded server-side by
 * src/lib/data/admin/catalog.ts and passed to the client components in this folder (and, with
 * fixture data, by the /dev/preview/music and /dev/preview/genres routes).
 */
import type { AdminTrack } from "@/lib/api/contracts";

/** A genre as shown on /admin/genres. */
export interface AdminGenreItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isEnabled: boolean;
  /** true ⇒ every active business; false ⇒ only businesses in `accessBusinessIds`. */
  availableToAll: boolean;
  /** Linked tracks that are active and not removed. */
  playableCount: number;
  /** All linked tracks, including inactive and removed ones. */
  totalCount: number;
  /** Businesses with an explicit access row (only used while `availableToAll` is false). */
  accessBusinessIds: string[];
  /** Object path of the uploaded cover in bucket `genre-covers`, or null (default artwork). */
  coverPath: string | null;
  /**
   * Short-lived signed URL of the cover (signed with the admin's own client), or null when there is
   * no cover or it could not be signed. The UI falls back to defaultGenreArtwork(slug).
   */
  coverUrl: string | null;
}

/** A business in the genre access picker. */
export interface BusinessOption {
  id: string;
  name: string;
  isActive: boolean;
}

/** A genre in filters, chips, pickers and track thumbnails on /admin/music. */
export interface GenreOption {
  id: string;
  name: string;
  slug: string;
  isEnabled: boolean;
  /** Signed cover URL, or null (default artwork from the slug). */
  coverUrl: string | null;
}

export interface GenreCatalog {
  genres: AdminGenreItem[];
  businesses: BusinessOption[];
}

/** Track counts per status for the current search and genre filter. */
export interface TrackStatusCounts {
  active: number;
  inactive: number;
  removed: number;
}

/** One page of /admin/music. */
export interface TrackPage {
  tracks: AdminTrack[];
  /** Tracks matching every filter (search, genre and status). */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  statusCounts: TrackStatusCounts;
}
