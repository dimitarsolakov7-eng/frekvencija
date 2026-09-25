/**
 * Stand-ins for the catalogue screens' server calls in the development previews: every Server Action
 * answers with a success ActionState after a short delay (nothing is stored), uploads are simulated
 * with real progress/phase callbacks and cancellation, and track previews play the synthetic demo
 * audio served by /api/dev/audio (run `npm run demo:audio` once). Never used outside /dev.
 */
import type { CatalogServices, GenreActions, MusicActions } from "@/components/admin/catalog/services";
import { actionSuccess, type ActionState } from "@/lib/actions/state";
import type { AdminTrack, CompleteUploadResponse } from "@/lib/api/contracts";
import { UploadError, type UploadFileOptions } from "@/lib/uploads/client";
import { UNKNOWN_ARTIST } from "@/lib/validation/tracks";

const NOTHING_STORED = "Preview only — nothing was stored.";

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError("aborted", "Upload cancelled."));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new UploadError("aborted", "Upload cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function ok(message: string, delayMs = 450): Promise<ActionState> {
  return wait(delayMs).then(() => actionSuccess(`${message} ${NOTHING_STORED}`));
}

export const PREVIEW_MUSIC_ACTIONS: MusicActions = {
  updateTrack: () => ok("Saved."),
  setTrackActive: (_trackId, active) => ok(active ? "The track is active." : "The track is inactive."),
  setTracksActive: (trackIds, active) => ok(`${trackIds.length} tracks are ${active ? "active" : "inactive"}.`),
  removeTrack: () => ok("The track was removed from playback."),
  removeTracks: (trackIds) => ok(`${trackIds.length} tracks were removed from playback.`),
  restoreTrack: () => ok("The track was restored."),
  deleteTrack: () => ok("The track was deleted permanently."),
};

export const PREVIEW_GENRE_ACTIONS: GenreActions = {
  createGenre: () =>
    ok("Genre created.").then((state) => ({ ...state, values: { createdGenreId: crypto.randomUUID() } })),
  saveGenre: () => ok("Saved."),
  deleteGenre: () => ok("Genre deleted."),
  setGenreEnabled: (_genreId, enabled) => ok(enabled ? "The genre is active." : "The genre is inactive."),
  reorderGenres: () => ok("Order saved.", 300),
  removeGenreCover: () => ok("Cover removed."),
};

/** "01 - evening_session.mp3" → "evening session" (the server uses ID3 tags or the file name). */
function titleFromFileName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/^\d+\s*[-_.]\s*/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Untitled";
}

function fakeTrack(file: Blob, fileName: string, id: string, genreIds: string[]): AdminTrack {
  const now = new Date().toISOString();
  return {
    id,
    title: titleFromFileName(fileName),
    artist: UNKNOWN_ARTIST,
    durationSeconds: 180 + (file.size % 120),
    fileSizeBytes: file.size,
    bitrateKbps: 192,
    originalFilename: fileName,
    isActive: true,
    removedAt: null,
    genreIds,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Simulated sign → upload → validate. A file whose name contains "broken" fails validation like a
 * non-MP3 would, so the error and Retry states can be reviewed too.
 */
async function simulateUpload(options: UploadFileOptions): Promise<CompleteUploadResponse> {
  const { request, file, metadata, onPhase, onProgress, signal } = options;
  onPhase?.("signing");
  await wait(350, signal);
  onPhase?.("uploading");
  const steps = 20;
  for (let step = 1; step <= steps; step += 1) {
    await wait(90 + Math.min(260, file.size / 400_000), signal);
    onProgress?.(step / steps);
  }
  onPhase?.("validating");
  await wait(700);
  if (request.fileName.toLowerCase().includes("broken")) {
    throw new UploadError("unsupported_media", "This is not an MP3 file. Upload an MP3 (MPEG Layer III) audio file.", 415);
  }
  switch (request.kind) {
    case "track":
      return { kind: "track", track: fakeTrack(file, request.fileName, crypto.randomUUID(), metadata?.genreIds ?? []) };
    case "track-replace":
      return { kind: "track-replace", track: fakeTrack(file, request.fileName, request.trackId, []) };
    case "genre-cover":
      return {
        kind: "genre-cover",
        genreId: request.genreId,
        coverPath: `${request.genreId}/preview.png`,
        // The picked image itself, so the new cover shows up immediately.
        coverUrl: URL.createObjectURL(file),
      };
    default:
      throw new UploadError("invalid_request", "This preview only simulates track and genre cover uploads.");
  }
}

/** Demo loops from supabase/seed/audio (served by /api/dev/audio in development only). */
const DEMO_AUDIO_IDS = [
  "test-loop-01-house",
  "test-loop-07-deep-house",
  "test-loop-10-lounge",
  "test-loop-14-jazz",
  "test-loop-17-balkan-hits",
  "test-loop-19-chillout",
] as const;

export const PREVIEW_SERVICES: CatalogServices = {
  upload: simulateUpload,
  previewTrack: async (trackId) => {
    await wait(250);
    let hash = 0;
    for (const char of trackId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const id = DEMO_AUDIO_IDS[hash % DEMO_AUDIO_IDS.length];
    return { url: `/api/dev/audio/${id}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  },
};
