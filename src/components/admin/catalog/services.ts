/**
 * What the catalogue screens need from the outside world, passed in as props so the same components
 * run against the real server (/admin/music, /admin/genres) and against fixtures in the development
 * previews (/dev/preview/music, /dev/preview/genres).
 *
 * - Actions: the Server Actions of src/app/admin/{music,genres}/actions.ts (the pages pass them;
 *   previews pass no-op async functions that answer with a success ActionState).
 * - Services: browser calls to the upload and preview route handlers (defaults below).
 */
import type { ActionState } from "@/lib/actions/state";
import type { AdminPreviewResponse, CompleteUploadResponse } from "@/lib/api/contracts";
import { uploadFile, type UploadFileOptions } from "@/lib/uploads/client";
import { fetchTrackPreview } from "./api";

export interface MusicActions {
  /** Title, artist and genres (FormData: title, artist, repeated genreIds). */
  updateTrack: (trackId: string, formData: FormData) => Promise<ActionState>;
  setTrackActive: (trackId: string, active: boolean) => Promise<ActionState>;
  setTracksActive: (trackIds: string[], active: boolean) => Promise<ActionState>;
  removeTrack: (trackId: string) => Promise<ActionState>;
  removeTracks: (trackIds: string[]) => Promise<ActionState>;
  restoreTrack: (trackId: string) => Promise<ActionState>;
  deleteTrack: (trackId: string) => Promise<ActionState>;
}

export interface GenreActions {
  /** FormData from genreDraftFormData(); success carries `values.createdGenreId`. */
  createGenre: (formData: FormData) => Promise<ActionState>;
  /** FormData from genreDraftFormData() (fields plus business access). */
  saveGenre: (genreId: string, formData: FormData) => Promise<ActionState>;
  deleteGenre: (genreId: string) => Promise<ActionState>;
  setGenreEnabled: (genreId: string, enabled: boolean) => Promise<ActionState>;
  /** The complete display order. */
  reorderGenres: (genreIds: string[]) => Promise<ActionState>;
  removeGenreCover: (genreId: string) => Promise<ActionState>;
}

export interface CatalogServices {
  /** Sign → upload with progress → server validation (uploadFile() from @/lib/uploads/client). */
  upload: (options: UploadFileOptions) => Promise<CompleteUploadResponse>;
  /** Short-lived signed URL for a track's audio (POST /api/admin/media/preview). */
  previewTrack: (trackId: string, signal?: AbortSignal) => Promise<AdminPreviewResponse>;
}

export const DEFAULT_CATALOG_SERVICES: CatalogServices = {
  upload: uploadFile,
  previewTrack: fetchTrackPreview,
};
