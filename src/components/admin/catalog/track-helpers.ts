/**
 * Pure helpers for /admin/music (client-safe; unit-tested in tests/admin/catalog): a track's genres
 * in display order, the "Selected track" editor's form state, bulk selection, and how upload queue
 * rows describe themselves.
 */
import type { AdminTrack } from "@/lib/api/contracts";
import type { UploadItemPhase } from "@/lib/uploads/queue";
import { formatBytes } from "@/lib/utils/format";
import { UNKNOWN_ARTIST } from "@/lib/validation/tracks";
import type { GenreOption } from "./types";

export const TRACK_TEXT_MAX = 200;

// ---------------------------------------------------------------------------
// Genres of a track
// ---------------------------------------------------------------------------

/**
 * The track's genres in the catalogue's display order (the database returns links unordered), so
 * "the first genre" — whose artwork is the track's thumbnail — is stable. Unknown ids are dropped.
 */
export function trackGenres(track: Pick<AdminTrack, "genreIds">, genres: readonly GenreOption[]): GenreOption[] {
  const wanted = new Set(track.genreIds);
  return genres.filter((genre) => wanted.has(genre.id));
}

// ---------------------------------------------------------------------------
// "Selected track" editor
// ---------------------------------------------------------------------------

export interface TrackDraft {
  title: string;
  /** "" is saved as "Unknown Artist". */
  artist: string;
  /** In the catalogue's display order. */
  genreIds: string[];
}

export function trackDraftFromTrack(track: Pick<AdminTrack, "title" | "artist" | "genreIds">, genres: readonly GenreOption[]): TrackDraft {
  return {
    title: track.title,
    artist: track.artist === UNKNOWN_ARTIST ? "" : track.artist,
    genreIds: trackGenres(track, genres).map((genre) => genre.id),
  };
}

/** Genre ids in display order after ticking or unticking one. */
export function toggleGenre(genreIds: readonly string[], genreId: string, checked: boolean, genres: readonly GenreOption[]): string[] {
  const next = new Set(genreIds);
  if (checked) next.add(genreId);
  else next.delete(genreId);
  return genres.filter((genre) => next.has(genre.id)).map((genre) => genre.id);
}

function normalizedArtist(value: string): string {
  const trimmed = value.trim();
  return trimmed === UNKNOWN_ARTIST ? "" : trimmed;
}

/** True when saving would change the title, artist or genres (text compared trimmed). */
export function isTrackDraftDirty(draft: TrackDraft, baseline: TrackDraft): boolean {
  if (draft.title.trim() !== baseline.title.trim()) return true;
  if (normalizedArtist(draft.artist) !== normalizedArtist(baseline.artist)) return true;
  if (draft.genreIds.length !== baseline.genreIds.length) return true;
  const base = new Set(baseline.genreIds);
  return draft.genreIds.some((id) => !base.has(id));
}

/** FormData for updateTrackAction: title, artist, repeated genreIds. */
export function trackDraftFormData(draft: TrackDraft): FormData {
  const data = new FormData();
  data.set("title", draft.title);
  data.set("artist", draft.artist);
  for (const id of draft.genreIds) data.append("genreIds", id);
  return data;
}

/** Problems the browser can report before submitting (the server validates again). */
export function trackDraftProblems(draft: TrackDraft): { title?: string; artist?: string } {
  const problems: { title?: string; artist?: string } = {};
  const title = draft.title.trim();
  if (!title) problems.title = "Enter a title.";
  else if (title.length > TRACK_TEXT_MAX) problems.title = `Use at most ${TRACK_TEXT_MAX} characters.`;
  if (draft.artist.trim().length > TRACK_TEXT_MAX) problems.artist = `Use at most ${TRACK_TEXT_MAX} characters.`;
  return problems;
}

// ---------------------------------------------------------------------------
// Bulk selection
// ---------------------------------------------------------------------------

/** The selection after ticking or unticking one row (order of first selection kept). */
export function toggleSelection(selected: readonly string[], id: string, checked: boolean): string[] {
  if (checked) return selected.includes(id) ? [...selected] : [...selected, id];
  return selected.filter((candidate) => candidate !== id);
}

/** Drops selected ids that are no longer listed (another page, filter or a refresh). */
export function pruneSelection(selected: readonly string[], visibleIds: readonly string[]): string[] {
  const visible = new Set(visibleIds);
  return selected.filter((id) => visible.has(id));
}

/** State of the "select all" checkbox for the visible rows. */
export function selectionState(selected: readonly string[], visibleIds: readonly string[]): "none" | "some" | "all" {
  if (visibleIds.length === 0) return "none";
  const chosen = new Set(selected);
  const count = visibleIds.filter((id) => chosen.has(id)).length;
  if (count === 0) return "none";
  return count === visibleIds.length ? "all" : "some";
}

// ---------------------------------------------------------------------------
// Upload queue rows
// ---------------------------------------------------------------------------

/** "MP3 • 8.4 MB" (the extension in capitals, or "File" without one). */
export function uploadFileMeta(file: { name: string; size: number }): string {
  const base = file.name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toUpperCase() : "File";
  return `${extension} • ${formatBytes(file.size)}`;
}

/** Whole percent for the progress bar, or null while there is no measurable progress. */
export function uploadPercent(item: { phase: UploadItemPhase; progress: number }): number | null {
  if (item.phase === "done") return 100;
  if (item.phase === "uploading") return Math.max(0, Math.min(100, Math.round(item.progress * 100)));
  return null;
}

/**
 * Why leaving /admin/music needs confirming while the queue runs (shown by the unsaved-changes
 * guard). Leaving stops the queue: waiting and transferring files are cancelled, while files the
 * server is already checking still finish.
 */
export function uploadsInProgressMessage(count: number): string {
  const running = count === 1 ? "1 upload is" : `${count} uploads are`;
  return `${running} still in progress. If you leave this page, files that haven’t finished uploading are cancelled.`;
}

/** Short status text of a queue row ("Uploading…", "Checking the file…", "Added to the library"). */
export function describeUploadPhase(phase: UploadItemPhase): string {
  switch (phase) {
    case "queued":
      return "Waiting…";
    case "signing":
      return "Preparing…";
    case "uploading":
      return "Uploading…";
    case "validating":
      return "Checking the file…";
    case "done":
      return "Added to the library";
    case "error":
      return "Not uploaded";
    case "cancelled":
      return "Cancelled";
  }
}
