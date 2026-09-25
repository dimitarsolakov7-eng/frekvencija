/**
 * Fixture data for the venue radio dev previews (/dev/preview/radio, …/account, …/help). Names and
 * copy come from the design screens (EmeraldBar Radio, House, Afterglow…); they exist only here and
 * are never used by the real pages, which render database data.
 */
import type { VenueLinks } from "@/components/player/venue-shell-context";
import type { AnnouncementSummary, PlayerBootstrap, PlayerGenre } from "@/lib/api/contracts";
import { STATION_ANNOUNCEMENT_LABEL, SINGLE_TRACK_NOTICE } from "@/lib/player/engine";
import type { NowPlaying, PlayerSnapshot, UpcomingTrack } from "@/lib/player/types";

export const PREVIEW_STATES = [
  "idle",
  "playing",
  "paused",
  "announcement",
  "loading",
  "buffering",
  "blocked",
  "network",
  "catalogue",
  "session",
  "genre-unavailable",
  "empty",
  "single-track",
  "no-voice",
  "fixed-volume",
  "no-music",
  "no-genres",
] as const;

export type PreviewStateName = (typeof PREVIEW_STATES)[number];

export const PREVIEW_STATE_LABELS: Record<PreviewStateName, string> = {
  idle: "Idle (before start)",
  playing: "Playing",
  paused: "Paused",
  announcement: "Station voice playing",
  loading: "Loading",
  buffering: "Buffering",
  blocked: "Blocked by browser",
  network: "Network error",
  catalogue: "Catalogue unavailable",
  session: "Session expired",
  "genre-unavailable": "Genre unavailable",
  empty: "Empty genre",
  "single-track": "Single track",
  "no-voice": "No approved clip",
  "fixed-volume": "Device volume (iOS)",
  "no-music": "No music yet",
  "no-genres": "No genres",
};

export function isPreviewState(value: unknown): value is PreviewStateName {
  return typeof value === "string" && (PREVIEW_STATES as readonly string[]).includes(value);
}

/** Demo clip ids from supabase/seed/audio/manifest.json, so Preview plays real (synthetic) audio. */
export const PREVIEW_ANNOUNCEMENTS: AnnouncementSummary[] = [
  { id: "emeraldbar-welcome-enjoy", placement: "welcome", durationSeconds: 4.57, text: "Welcome to EmeraldBar. Enjoy the music." },
  { id: "emeraldbar-station-listening", placement: "rotation", durationSeconds: 3.32, text: "You’re listening to EmeraldBar Radio." },
];

const GENRES: PlayerGenre[] = [
  { id: "house", name: "House", slug: "house", description: "Uplifting, rhythmic, timeless.", trackCount: 24, coverUrl: null },
  { id: "deep-house", name: "Deep House", slug: "deep-house", description: "Deeper moods for longer evenings.", trackCount: 18, coverUrl: null },
  { id: "lounge", name: "Lounge", slug: "lounge", description: "Stylish, relaxed, sophisticated.", trackCount: 21, coverUrl: null },
  { id: "jazz", name: "Jazz", slug: "jazz", description: "Classic vibes, modern spaces.", trackCount: 16, coverUrl: null },
  { id: "balkan-hits", name: "Balkan Hits", slug: "balkan-hits", description: "Modern Balkan sounds for great energy.", trackCount: 20, coverUrl: null },
  { id: "chillout", name: "Chillout", slug: "chillout", description: "Laid-back sounds for any time.", trackCount: 14, coverUrl: null },
];

const EMPTY_GENRE: PlayerGenre = { id: "pop", name: "Pop", slug: "pop", description: "Familiar, upbeat favourites.", trackCount: 0, coverUrl: null };

const AFTERGLOW: NowPlaying = { kind: "track", id: "afterglow", title: "Afterglow", artist: "Frekvencija Sessions", durationSeconds: 248 };

const UPCOMING: UpcomingTrack[] = [
  { id: "slow-motion", title: "Slow Motion", artist: "Frekvencija Sessions", durationSeconds: 312 },
  { id: "amber-lights", title: "Amber Lights", artist: "Frekvencija Sessions", durationSeconds: 276 },
  { id: "night-shift", title: "Night Shift", artist: "Frekvencija Sessions", durationSeconds: 328 },
];

export function previewBootstrap(state: PreviewStateName): PlayerBootstrap {
  let genres = GENRES;
  if (state === "empty") genres = [...GENRES, EMPTY_GENRE];
  if (state === "no-music") genres = GENRES.map((genre) => ({ ...genre, trackCount: 0 }));
  if (state === "no-genres") genres = [];
  if (state === "single-track") genres = GENRES.map((genre) => (genre.id === "jazz" ? { ...genre, trackCount: 1 } : genre));
  const announcements = state === "no-voice" ? [] : PREVIEW_ANNOUNCEMENTS;
  return {
    userId: "preview-user",
    business: {
      id: "preview-emeraldbar",
      name: "EmeraldBar",
      stationName: "EmeraldBar Radio",
      type: "bar",
      logoUrl: null,
      language: "en",
      announcementEveryNTracks: 4,
      announcementVolume: 1,
    },
    genres,
    preferences: { genreId: genres.length > 0 ? "house" : null, volume: 0.62, muted: false },
    announcementCounts: {
      welcome: announcements.filter((clip) => clip.placement === "welcome" || clip.placement === "both").length,
      rotation: announcements.filter((clip) => clip.placement === "rotation" || clip.placement === "both").length,
    },
    announcements,
    support: { email: "support@example.com", phone: "+1 555 0100" },
  };
}

/** Status line the engine would publish (the live region reads it). */
export function previewMessage(snapshot: Pick<PlayerSnapshot, "status" | "current" | "genreId">): string | null {
  switch (snapshot.status) {
    case "idle":
      return snapshot.genreId === null ? "Choose a genre to start the radio." : null;
    case "playing":
      if (!snapshot.current) return "Playing";
      return snapshot.current.kind === "track"
        ? `Playing: ${snapshot.current.title} – ${snapshot.current.artist}`
        : `Playing: ${snapshot.current.label}`;
    case "paused":
      return "Paused";
    case "loading":
      return "Loading…";
    case "buffering":
      return "Buffering…";
    case "blocked":
      return "Audio was blocked by the browser. Press Start audio to listen.";
    case "empty":
      return "There are no tracks in this genre yet. Choose another genre.";
    case "error":
      return null;
  }
}

const BASE: PlayerSnapshot = {
  status: "playing",
  genreId: "house",
  current: AFTERGLOW,
  positionSeconds: 84,
  durationSeconds: 248,
  volume: 0.62,
  muted: false,
  message: null,
  errorCode: null,
  notice: null,
  hasStarted: true,
  tracksSinceAnnouncement: 2,
  tracksUntilAnnouncement: 2,
  upcoming: UPCOMING,
  canSkip: true,
  announcementInProgress: false,
  volumeControllable: true,
};

function withMessage(snapshot: PlayerSnapshot): PlayerSnapshot {
  return snapshot.status === "error" ? snapshot : { ...snapshot, message: previewMessage(snapshot) };
}

export function previewSnapshot(state: PreviewStateName): PlayerSnapshot {
  const idle: PlayerSnapshot = {
    ...BASE,
    status: "idle",
    current: null,
    positionSeconds: 0,
    durationSeconds: null,
    hasStarted: false,
    tracksSinceAnnouncement: 0,
    tracksUntilAnnouncement: null,
    upcoming: [],
    canSkip: false,
  };
  const stopped = { ...BASE, current: null, positionSeconds: 0, durationSeconds: null, upcoming: [], canSkip: false };
  switch (state) {
    case "idle":
    case "no-voice":
      return withMessage(state === "idle" ? idle : { ...BASE, tracksUntilAnnouncement: null });
    case "playing":
      return withMessage(BASE);
    case "paused":
      return withMessage({ ...BASE, status: "paused" });
    case "announcement":
      // Skip applies to music only: unavailable while the station voice plays.
      return withMessage({
        ...BASE,
        current: { kind: "announcement", id: "emeraldbar-station-listening", label: STATION_ANNOUNCEMENT_LABEL, durationSeconds: 3.32 },
        positionSeconds: 1,
        durationSeconds: 3.32,
        tracksSinceAnnouncement: 0,
        tracksUntilAnnouncement: 4,
        canSkip: false,
        announcementInProgress: true,
      });
    case "loading":
      return withMessage({ ...stopped, status: "loading" });
    case "buffering":
      return withMessage({ ...BASE, status: "buffering" });
    case "blocked":
      return withMessage({ ...BASE, status: "blocked" });
    case "network":
      return { ...stopped, status: "error", errorCode: "network", message: "Connection lost. Check the internet connection and press Retry." };
    case "catalogue":
      return {
        ...stopped,
        status: "error",
        errorCode: "catalogue_unavailable",
        message: "Tracks in this genre could not be played. Press Retry or choose another genre.",
      };
    case "session":
      return { ...stopped, status: "error", errorCode: "auth_expired", message: "Your session has expired. Please sign in again." };
    case "genre-unavailable":
      return {
        ...stopped,
        genreId: "jazz",
        status: "error",
        errorCode: "genre_unavailable",
        message: "This genre is no longer available. Choose another genre.",
      };
    case "empty":
      return withMessage({ ...stopped, genreId: "pop", status: "empty", tracksUntilAnnouncement: null });
    case "single-track":
      return withMessage({
        ...BASE,
        genreId: "jazz",
        current: { kind: "track", id: "midnight-notes", title: "Midnight Notes", artist: "Frekvencija Sessions", durationSeconds: 222 },
        durationSeconds: 222,
        upcoming: [{ id: "midnight-notes", title: "Midnight Notes", artist: "Frekvencija Sessions", durationSeconds: 222 }],
        notice: SINGLE_TRACK_NOTICE,
        canSkip: false,
      });
    case "fixed-volume":
      return withMessage({ ...BASE, volumeControllable: false });
    case "no-music":
      return withMessage({ ...idle, genreId: "house" });
    case "no-genres":
      return withMessage({ ...idle, genreId: null });
  }
}

export type PreviewCommand =
  | { type: "play" }
  | { type: "pause" }
  | { type: "skip" }
  | { type: "retry" }
  | { type: "select"; genreId: string }
  | { type: "volume"; volume: number }
  | { type: "muted"; muted: boolean };

/**
 * A tiny stand-in for the engine so the previews react to clicks (Play/Pause, genre selection,
 * volume) without any audio or network. Pure, for the preview's reducer.
 */
export function applyPreviewCommand(snapshot: PlayerSnapshot, command: PreviewCommand): PlayerSnapshot {
  switch (command.type) {
    case "play": {
      if (snapshot.status === "playing" || snapshot.status === "empty" || snapshot.genreId === null) return snapshot;
      const started = snapshot.hasStarted ? snapshot : { ...snapshot, hasStarted: true, canSkip: true, upcoming: UPCOMING };
      return withMessage({ ...started, status: "playing", errorCode: null, current: snapshot.current ?? AFTERGLOW, durationSeconds: snapshot.durationSeconds ?? 248 });
    }
    case "pause":
      return snapshot.hasStarted && snapshot.status !== "error" && snapshot.status !== "empty"
        ? withMessage({ ...snapshot, status: "paused" })
        : snapshot;
    case "skip": {
      const [next, ...rest] = snapshot.upcoming;
      if (!snapshot.canSkip || !next) return snapshot;
      const previous = snapshot.current?.kind === "track" ? [{ ...snapshot.current }] : [];
      return withMessage({
        ...snapshot,
        current: { kind: "track", ...next },
        positionSeconds: 0,
        durationSeconds: next.durationSeconds,
        upcoming: [...rest, ...previous.map(({ id, title, artist, durationSeconds }) => ({ id, title, artist, durationSeconds }))],
      });
    }
    case "retry":
      return snapshot.status === "error" || snapshot.status === "empty"
        ? withMessage({ ...snapshot, status: "playing", errorCode: null, current: AFTERGLOW, durationSeconds: 248, positionSeconds: 0, canSkip: true, upcoming: UPCOMING })
        : snapshot;
    case "select": {
      // Like the engine: choosing a genre after an error or an empty genre loads it, paused.
      const recovering = snapshot.status === "error" || snapshot.status === "empty";
      if (snapshot.genreId === command.genreId && !recovering) return snapshot;
      return withMessage({
        ...snapshot,
        genreId: command.genreId,
        ...(recovering ? { status: "paused" as const, errorCode: null, hasStarted: true } : {}),
      });
    }
    case "volume":
      return { ...snapshot, volume: Math.min(1, Math.max(0, command.volume)) };
    case "muted":
      return { ...snapshot, muted: command.muted };
  }
}

/** Venue navigation inside the previews (so Account and Help stay in the preview area). */
export const PREVIEW_LINKS = {
  radio: "/dev/preview/radio",
  account: "/dev/preview/radio/account",
  help: "/dev/preview/radio/help",
} as const satisfies VenueLinks;

/** Signed-in email shown in the previews' account menu and account page (design screen 06). */
export const PREVIEW_EMAIL = "manager@emeraldbar.example";
