/**
 * Contracts for the framework-agnostic playback engine (see docs/ARCHITECTURE.md §9).
 * The engine never touches `window`/`document` directly: everything environment-specific is
 * injected through EngineDeps so it can be unit-tested with fakes.
 */
import type {
  AnnouncementsResponse,
  GenreTracksResponse,
  PlaybackPreferences,
  SignMediaRequest,
  SignedMedia,
  UpdatePreferencesRequest,
} from "@/lib/api/contracts";

// ---------------------------------------------------------------------------
// Public state
// ---------------------------------------------------------------------------

export type PlayerStatus =
  | "idle" // nothing started yet (or stopped/destroyed)
  | "loading" // fetching lists/URLs or waiting for the first `playing` event
  | "playing" // media element fired `playing` and is not paused
  | "paused" // user paused (an item may be loaded)
  | "buffering" // wanted to play, element is waiting/stalled
  | "blocked" // browser refused play() without a user gesture
  | "empty" // selected genre has no playable tracks
  | "error"; // unrecoverable until retry (see errorCode)

export type PlayerErrorCode =
  | "catalogue_unavailable"
  | "network"
  | "auth_expired"
  | "business_inactive"
  | "genre_unavailable"
  | "unknown";

export type NowPlaying =
  | {
      kind: "track";
      id: string;
      title: string;
      artist: string;
      durationSeconds: number | null;
    }
  | {
      kind: "announcement";
      id: string;
      /** "Welcome announcement" | "Station announcement" */
      label: string;
      durationSeconds: number | null;
    };

export interface UpcomingTrack {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
}

export interface PlayerSnapshot {
  status: PlayerStatus;
  genreId: string | null;
  current: NowPlaying | null;
  /** Seconds, updated at most ~1×/s. */
  positionSeconds: number;
  durationSeconds: number | null;
  /** 0–1 master volume chosen by the listener. */
  volume: number;
  muted: boolean;
  /** Human-readable status line for the aria-live region (never null while an error is shown). */
  message: string | null;
  errorCode: PlayerErrorCode | null;
  /** Non-error informational notice, e.g. single-track genre explanation. */
  notice: string | null;
  /** True once the listener pressed Start at least once in this engine lifetime. */
  hasStarted: boolean;
  /** Completed (naturally ended) music tracks since the last announcement. */
  tracksSinceAnnouncement: number;
  /** Tracks remaining before the next station announcement, or null if none are available. */
  tracksUntilAnnouncement: number | null;
  /**
   * Read-only preview of the next tracks the shuffle will play (at most 3, excluding the current one).
   * It can change when the genre list refreshes; announcements are not listed here.
   */
  upcoming: UpcomingTrack[];
  /** Whether Skip currently does anything (music only: never during an announcement). */
  canSkip: boolean;
  /**
   * An announcement is the current item (playing, paused, buffering…) or is being loaded to play
   * next. Skip applies to music only (design/CLAUDE-HANDOFF.md §03/04), so canSkip is false meanwhile.
   */
  announcementInProgress: boolean;
  /** Volume changes are audible on this device (false on iOS where element volume is read-only). */
  volumeControllable: boolean;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface PlayerCommands {
  /** Explicit user gesture: start the radio (plays welcome first on the first start of a session). */
  start(): void;
  pause(): void;
  /** Resume after pause or after a `blocked` state (must be called from a user gesture). */
  resume(): void;
  togglePlay(): void;
  /** Skip the current (or loading) song. Music only: a no-op while snapshot.canSkip is false. */
  skip(): void;
  /** Switch genre. If paused/idle, stays paused/idle; if playing, plays the new genre. */
  selectGenre(genreId: string): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Recover from `error`/`empty` (reloads lists and resets failure counters). */
  retry(): void;
  /**
   * Stop everything and release media. Idempotent. The per-session welcome flag is kept (logout
   * clears it with clearPlayerSessionState()), so a remount in the same session never replays it.
   */
  destroy(options?: DestroyOptions): void;
}

export interface DestroyOptions {
  /**
   * Save preference changes still waiting for their debounced save (default true). Pass false when
   * the browser's session no longer belongs to this player (another tab signed out, or signed in
   * as another venue), so this tab never writes into another account's preferences.
   */
  savePreferences?: boolean;
}

export interface PlayerEngineApi extends PlayerCommands {
  getSnapshot(): PlayerSnapshot;
  subscribe(listener: () => void): () => void;
}

// ---------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------

/** Subset of HTMLMediaElement the engine relies on (HTMLAudioElement satisfies it). */
export interface MediaElementLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  volume: number;
  muted: boolean;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  readonly networkState: number;
  readonly error: { code: number; message?: string } | null;
  preload: "" | "none" | "metadata" | "auto";
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface PlayerApi {
  getGenreTracks(genreId: string, signal?: AbortSignal): Promise<GenreTracksResponse>;
  getAnnouncements(signal?: AbortSignal): Promise<AnnouncementsResponse>;
  signMedia(request: SignMediaRequest, signal?: AbortSignal): Promise<SignedMedia>;
  savePreferences(update: UpdatePreferencesRequest): Promise<PlaybackPreferences>;
}

/** Errors thrown by PlayerApi implementations so the engine can react precisely. */
export type PlayerApiErrorKind =
  | "auth" // 401: session expired
  | "forbidden" // 403: business inactive / genre not accessible
  | "unavailable" // 404/410: item no longer playable
  | "rate_limited" // 429
  | "network" // fetch failed / offline / timeout
  | "server"; // 5xx or malformed response

export class PlayerApiError extends Error {
  readonly kind: PlayerApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;

  constructor(kind: PlayerApiErrorKind, message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = "PlayerApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Wall-clock milliseconds since the Unix epoch (compared with signed URL `expiresAt`). */
  now(): number;
}

export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Media Session actions the engine registers (play/pause/stop/nexttrack) or clears (previous/seek). */
export type MediaSessionActionName =
  | "play"
  | "pause"
  | "nexttrack"
  | "stop"
  | "previoustrack"
  | "seekbackward"
  | "seekforward"
  | "seekto";

/** Minimal Media Session surface (navigator.mediaSession). */
export interface MediaSessionLike {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  setActionHandler(action: MediaSessionActionName, handler: (() => void) | null): void;
}

export interface EngineDeps {
  api: PlayerApi;
  /** Creates one pooled audio element (called 3 times at construction). */
  createMediaElement(): MediaElementLike;
  timers?: Timers;
  /** Deterministic randomness for tests; defaults to Math.random. */
  random?: () => number;
  /** sessionStorage-backed store for welcome-played flags; defaults to in-memory. */
  storage?: KeyValueStorage;
  mediaSession?: MediaSessionLike | null;
  /** Build a MediaMetadata object (browser only). */
  createMediaMetadata?: (init: { title: string; artist: string; album: string; artwork?: { src: string }[] }) => unknown;
  /** Returns whether the page is currently visible (fades are skipped when hidden). */
  isPageVisible?: () => boolean;
  /** Subscribe to connectivity changes; returns unsubscribe. */
  onOnline?: (callback: () => void) => () => void;
  /** Subscribe to page visibility changes (catch-up watchdog check when the tab becomes visible). */
  onVisibilityChange?: (callback: () => void) => () => void;
  /** Diagnostic hook (dev lab / tests). */
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

export interface EngineConfig {
  userId: string;
  businessId: string;
  stationName: string;
  businessName: string;
  logoUrl: string | null;
  initialGenreId: string | null;
  initialVolume: number;
  initialMuted: boolean;
  announcementEveryNTracks: number;
  announcementVolume: number;
}

/** Tunables (defaults per docs/ARCHITECTURE.md §9); overridable in tests. */
export interface EngineTuning {
  trackListRefreshMs: number; // 60_000
  announcementRefreshMs: number; // 120_000
  maxLoadRetries: number; // 2
  maxConsecutiveFailures: number; // 5 (min with pool size)
  stallReloadMs: number; // 15_000
  stallFailMs: number; // 45_000
  fadeInMs: number; // 250
  fadeOutMs: number; // 300
  urlExpiryMarginSeconds: number; // 120
  networkRetryDelaysMs: number[]; // [2000, 5000, 10000, 20000, 30000]
  preloadDelayMs?: number; // 5_000: next item's src is set only after the current one played this long
  playTimeoutMs?: number; // 15_000: play() promises that never settle are treated as a load failure
}
