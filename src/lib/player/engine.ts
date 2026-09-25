/**
 * PlayerEngine: the single controller for venue playback (docs/ARCHITECTURE.md §9,
 * docs/research/browser-audio.md §12). Framework-agnostic: every browser dependency is injected.
 *
 * Concurrency model
 * - `generation` identifies a genre session. Genre change, retry, a terminal state and destroy()
 *   bump it (and abort that session's fetches).
 * - `transitionSeq` identifies the transition that is choosing the next item (start, natural end,
 *   skip, failure). Every new transition bumps it and aborts the previous transition's fetches.
 * - Every async continuation captures both numbers and re-checks them before touching state, so
 *   late fetches, late play() settles and events from superseded work are ignored.
 *
 * Media elements
 * - A fixed pool of 3 elements is created at construction and reused for the whole session
 *   (WebKit unlocks autoplay per element). Each element has a role: current, nextTrack,
 *   nextAnnouncement, claimed (picked by an in-flight transition), retiring (fading out) or free.
 * - Exclusivity: only `current` may play. Every other element is paused before any play(), and a
 *   `playing` event from any other element pauses it immediately.
 *
 * Announcements
 * - Skip applies to music only (design/CLAUDE-HANDOFF.md §03/04): canSkip() is false while an
 *   announcement is current and while a transition is loading (or is about to load) one, so Skip,
 *   the N key and the Media Session `nexttrack` action never cut or re-draw a station clip.
 * - The first Start arms the welcome; it stays pending until it actually starts playing, so a genre
 *   change or a failed request while it loads does not lose it (failed attempts are bounded).
 * - The rotation only advances when a clip is heard (AnnouncementScheduler.peekRotation), so a
 *   dropped preload or a superseded transition never makes the same clip play twice in a row.
 */
import { MUSIC_GAIN } from "@/config/platform";
import type {
  AnnouncementSummary,
  AnnouncementsResponse,
  SignMediaRequest,
  SignedMedia,
  TrackSummary,
  UpdatePreferencesRequest,
} from "@/lib/api/contracts";
import { AnnouncementScheduler, welcomeStorageKey } from "./announcements";
import {
  HAVE_FUTURE_DATA,
  NETWORK_EMPTY,
  classifyMediaError,
  detectVolumeWritable,
  rampValue,
  reloadAt,
  safePlay,
  unloadMedia,
  type PlayOutcome,
} from "./media";
import { clamp01, createMemoryStorage, isAbortError, systemTimers } from "./runtime";
import { ShuffleBag } from "./shuffle";
import {
  PlayerApiError,
  type DestroyOptions,
  type EngineConfig,
  type EngineDeps,
  type EngineTuning,
  type MediaElementLike,
  type MediaSessionActionName,
  type NowPlaying,
  type PlayerApi,
  type PlayerEngineApi,
  type PlayerErrorCode,
  type PlayerSnapshot,
  type PlayerStatus,
  type Timers,
  type UpcomingTrack,
} from "./types";

export const DEFAULT_ENGINE_TUNING: Readonly<Required<EngineTuning>> = Object.freeze({
  trackListRefreshMs: 60_000,
  announcementRefreshMs: 120_000,
  maxLoadRetries: 2,
  maxConsecutiveFailures: 5,
  stallReloadMs: 15_000,
  stallFailMs: 45_000,
  fadeInMs: 250,
  fadeOutMs: 300,
  urlExpiryMarginSeconds: 120,
  networkRetryDelaysMs: [2_000, 5_000, 10_000, 20_000, 30_000],
  preloadDelayMs: 5_000,
  playTimeoutMs: 15_000,
});

/** Watchdog sampling interval; elapsed time is always computed from the clock, never tick counts. */
const PROGRESS_TICK_MS = 1_000;
/** No currentTime advance for longer than this while not paused counts as buffering. */
const PROGRESS_GRACE_MS = 2_000;
const PREFERENCES_DEBOUNCE_MS = 1_000;
/** Fade-ins start here, never at 0 (WebKit would pause a silently started element later). */
const FADE_FLOOR = 0.02;
/** Conservative duration assumed for URL-expiry maths when the real one is unknown. */
const UNKNOWN_DURATION_SECONDS = 600;
/** Maximum number of tracks in PlayerSnapshot.upcoming. */
export const UPCOMING_LIMIT = 3;
/** Failed attempts (signing or playback) after which the pending welcome is given up for this engine. */
export const MAX_WELCOME_ATTEMPTS = 3;
/** Statuses in which nothing is queued to play, so no "coming up" preview is shown. */
const NO_UPCOMING_STATUSES: ReadonlySet<PlayerStatus> = new Set<PlayerStatus>(["idle", "empty", "error"]);

export const WELCOME_ANNOUNCEMENT_LABEL = "Welcome announcement";
export const STATION_ANNOUNCEMENT_LABEL = "Station announcement";
export const SINGLE_TRACK_NOTICE = "This genre has only one track, so it repeats.";

const MEDIA_EVENTS = ["playing", "pause", "ended", "error", "waiting", "timeupdate", "durationchange"] as const;
type MediaEventType = (typeof MEDIA_EVENTS)[number];

type ItemKind = "track" | "announcement";
type TransitionReason = "start" | "ended" | "skip" | "failure";
type TimerName = "tick" | "preload" | "network" | "preferences";

interface PlayableItem {
  readonly kind: ItemKind;
  readonly id: string;
  readonly isWelcome: boolean;
  readonly nowPlaying: NowPlaying;
  url: string;
  expiresAtMs: number;
  durationSeconds: number | null;
  /** A `playing` event was seen for this item. */
  started: boolean;
  /** Fresh-URL reloads spent (load retries and mid-track recoveries share the budget). */
  recoveries: number;
  /** The one-off buffering-watchdog reload was used. */
  stallReloaded: boolean;
  /** A fresh-URL reload is in flight: failure signals from the old source are ignored. */
  reloading: boolean;
}

type SlotRole = "free" | "current" | "nextTrack" | "nextAnnouncement" | "claimed" | "retiring";

interface Slot {
  readonly el: MediaElementLike;
  role: SlotRole;
  item: PlayableItem | null;
  /** Bumped whenever the element's source changes; stale play() settles compare against it. */
  loadToken: number;
  /** `pause` events caused by the engine itself, still to be delivered. */
  pendingPauseEvents: number;
  /** Multiplier applied on top of master × gain while fading. */
  fadeFactor: number;
  fadeAbort: AbortController | null;
  readonly listeners: Array<[MediaEventType, () => void]>;
}

interface LoadedItem {
  slot: Slot;
  item: PlayableItem;
}

/** What loading an announcement needs (the display text is not used for playback). */
type AnnouncementRef = Pick<AnnouncementSummary, "id" | "durationSeconds">;

export class PlayerEngine implements PlayerEngineApi {
  private readonly deps: EngineDeps;
  private readonly config: EngineConfig;
  private readonly api: PlayerApi;
  private readonly timers: Timers;
  private readonly tuning: Required<EngineTuning>;
  private readonly bag: ShuffleBag;
  private readonly scheduler: AnnouncementScheduler;
  private slots: Slot[];
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: Array<() => void> = [];
  private readonly timerHandles = new Map<TimerName, unknown>();
  private snapshot: PlayerSnapshot;

  private destroyed = false;
  private generation = 0;
  private transitionSeq = 0;
  private sessionAbort = new AbortController();
  private transitionAbort = new AbortController();

  private status: PlayerStatus = "idle";
  private errorCode: PlayerErrorCode | null = null;
  private genreId: string | null;
  private hasStarted = false;
  /** The listener wants audio (Start/Resume); false after Pause or an external pause. */
  private wantsPlayback = false;
  /**
   * Armed by the first Start. Stays true until the welcome actually starts playing, turns out to be
   * unavailable (none approved, or already played in this browser session) or has failed
   * MAX_WELCOME_ATTEMPTS times: a superseded or failed attempt never loses it.
   */
  private welcomePending = false;
  private welcomeFailures = 0;

  private current: Slot | null = null;
  private retiring: { slot: Slot; done: Promise<void> } | null = null;

  private tracks = new Map<string, TrackSummary>();
  private tracksLoadedAt = Number.NEGATIVE_INFINITY;
  private announcementsLoadedAt = Number.NEGATIVE_INFINITY;
  private consecutiveFailures = 0;
  /** Bag picks since the track list was last loaded (a cycle boundary refreshes only when > 0). */
  private picksSinceListLoad = 0;
  /**
   * The track the running transition picked (taken from the bag or the preload slot) and is
   * validating/loading; it plays next. Cleared when a transition starts or the item is promoted.
   */
  private transitionTrackId: string | null = null;
  /** The running transition (why it runs and what played before it); null when none runs. */
  private transition: { reason: TransitionReason; previousKind: ItemKind | null } | null = null;
  /** Kind of item the running transition chose and is loading; null until it has chosen. */
  private transitionKind: ItemKind | null = null;
  /** Last published PlayerSnapshot.upcoming, reused while its content is unchanged (stable identity). */
  private upcomingCache: UpcomingTrack[] = [];

  private masterVolume: number;
  private muted: boolean;
  private announcementGain: number;
  /** null until the asynchronous probe finishes (fades stay off until it says true). */
  private volumeWritable: boolean | null = null;

  private positionSeconds = 0;
  private progressTime = -1;
  private progressAt = 0;
  private stallSince: number | null = null;

  private networkAttempt = 0;
  private networkRetriesExhausted = false;
  private networkRetryAction: (() => void) | null = null;

  private pendingPreferences: UpdatePreferencesRequest = {};
  private mediaSessionKey = "";

  constructor(deps: EngineDeps, config: EngineConfig, tuning: Partial<EngineTuning> = {}) {
    this.deps = deps;
    this.config = config;
    this.api = deps.api;
    this.timers = deps.timers ?? systemTimers;
    this.tuning = { ...DEFAULT_ENGINE_TUNING, ...definedOnly(tuning) };
    const random = deps.random ?? Math.random;
    this.bag = new ShuffleBag(random);
    this.scheduler = new AnnouncementScheduler({
      everyNTracks: config.announcementEveryNTracks,
      storage: deps.storage ?? createMemoryStorage(),
      welcomeKey: welcomeStorageKey(config.userId, config.businessId),
      random,
    });
    this.genreId = config.initialGenreId;
    this.masterVolume = clamp01(config.initialVolume);
    this.muted = config.initialMuted;
    this.announcementGain = normalizeGain(config.announcementVolume);
    this.slots = [0, 1, 2].map(() => this.createSlot(deps.createMediaElement()));
    if (deps.onOnline) this.cleanups.push(deps.onOnline(() => this.handleOnline()));
    if (deps.onVisibilityChange) this.cleanups.push(deps.onVisibilityChange(() => this.handleVisibilityChange()));
    this.bindMediaSession();
    this.snapshot = this.buildSnapshot();
    void this.detectVolume();
  }

  // -------------------------------------------------------------------------
  // Public API (arrow properties: stable references for useSyncExternalStore and handlers)
  // -------------------------------------------------------------------------

  readonly getSnapshot = (): PlayerSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly start = (): void => {
    if (this.destroyed) return;
    if (this.genreId === null) return;
    if (!this.hasStarted) {
      // Synchronously inside the gesture: unlock the pool before any await (WebKit).
      this.unlockIdleElements();
      this.hasStarted = true;
      this.wantsPlayback = true;
      // The first explicit Start plays the welcome (once per browser session) when there is one.
      this.welcomePending = true;
      this.beginSession();
      return;
    }
    if (this.status === "error" || this.status === "empty") this.retry();
    else if (this.status === "paused" || this.status === "blocked") this.resume();
  };

  readonly resume = (): void => {
    if (this.destroyed) return;
    if (!this.hasStarted) return this.start();
    if (this.status === "error" || this.status === "empty") return this.retry();
    if (this.wantsPlayback && this.status !== "blocked") return;
    this.unlockIdleElements();
    this.wantsPlayback = true;
    const slot = this.current;
    const item = slot?.item;
    if (!slot || !item || item.reloading) {
      // A transition or reload is in flight; it starts playback when it completes.
      this.setStatus("loading");
      return;
    }
    if (!this.urlCovers(item, this.remainingSeconds(slot, item))) {
      // Long pauses are the usual way to outlive a signed URL mid-track.
      void this.reloadWithFreshUrl(slot, item, slot.el.currentTime, "expiry");
      return;
    }
    this.playSlot(slot);
  };

  readonly pause = (): void => {
    if (this.destroyed || !this.hasStarted) return;
    this.wantsPlayback = false;
    for (const slot of this.slots) this.pauseSlot(slot);
    this.stallSince = null;
    this.clearTimer("tick");
    if (this.status === "error" || this.status === "empty") {
      this.emit();
      return;
    }
    this.setStatus("paused");
  };

  readonly togglePlay = (): void => {
    const active = this.status === "playing" || this.status === "buffering" || this.status === "loading";
    if (this.wantsPlayback && active) this.pause();
    else this.resume();
  };

  readonly skip = (): void => {
    // Skip applies to music only: canSkip() is false while an announcement is current or while a
    // transition is loading (or is about to load) one, so this is a no-op then (button, N key and
    // the Media Session `nexttrack` action alike).
    if (this.destroyed || !this.canSkip()) return;
    this.unlockIdleElements();
    const slot = this.current;
    const item = slot?.item ?? null;
    // Skipping a song that is still loading keeps what played before it (e.g. a failed
    // announcement is not followed by another one just because of the Skip).
    const previousKind = item?.kind ?? this.transition?.previousKind ?? null;
    if (slot) {
      this.current = null;
      this.retireSlot(slot, true);
    }
    // A skipped track never counts toward the announcement interval.
    this.log("skip", { kind: item?.kind ?? null, id: item?.id ?? null });
    this.startTransition("skip", previousKind);
  };

  readonly selectGenre = (genreId: string): void => {
    if (this.destroyed) return;
    const recovering = this.status === "error" || this.status === "empty";
    if (genreId === this.genreId && !recovering) return;
    this.genreId = genreId;
    this.queuePreferences({ genreId });
    if (!this.hasStarted) {
      this.resetGenreState();
      this.emit();
      return;
    }
    this.unlockIdleElements();
    // Plays the new genre if the listener wanted audio; otherwise loads it and stays paused.
    this.beginSession();
  };

  readonly setVolume = (volume: number): void => {
    if (this.destroyed) return;
    const next = clamp01(volume);
    if (next === this.masterVolume) return;
    this.masterVolume = next;
    for (const slot of this.slots) this.applyVolume(slot);
    this.queuePreferences({ volume: next });
    this.emit();
  };

  readonly setMuted = (muted: boolean): void => {
    if (this.destroyed || muted === this.muted) return;
    this.muted = muted;
    for (const slot of this.slots) slot.el.muted = muted;
    this.queuePreferences({ muted });
    this.emit();
  };

  readonly retry = (): void => {
    if (this.destroyed) return;
    if (this.status !== "error" && this.status !== "empty") return;
    if (this.genreId === null) return;
    this.unlockIdleElements();
    this.hasStarted = true;
    this.wantsPlayback = true;
    this.networkAttempt = 0;
    this.networkRetriesExhausted = false;
    if (this.errorCode === "network" && this.networkRetryAction) {
      this.runNetworkRetry();
      return;
    }
    this.bag.clearExclusions();
    this.announcementsLoadedAt = Number.NEGATIVE_INFINITY;
    this.beginSession();
  };

  readonly destroy = (options?: DestroyOptions): void => {
    if (this.destroyed) return;
    if (options?.savePreferences === false) this.discardPreferences();
    else this.flushPreferences();
    this.destroyed = true;
    this.stopWork();
    for (const slot of this.slots) {
      slot.fadeAbort?.abort();
      try {
        unloadMedia(slot.el);
      } catch (error) {
        this.log("media.unload_failed", { error: describeError(error) });
      }
      for (const [type, listener] of slot.listeners) slot.el.removeEventListener(type, listener);
      slot.listeners.length = 0;
      slot.item = null;
      slot.role = "free";
    }
    this.slots = [];
    this.current = null;
    this.retiring = null;
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        this.log("cleanup.failed", { error: describeError(error) });
      }
    }
    this.unbindMediaSession();
    // The welcome-played flag is deliberately kept: an unmount (e.g. /account → /reset-password →
    // back to /radio) must not replay the welcome in the same signed-in session. Logout and a
    // session change clear it with clearPlayerSessionState().
    this.wantsPlayback = false;
    this.status = "idle";
    this.errorCode = null;
    this.positionSeconds = 0;
    this.publish();
    this.listeners.clear();
  };

  // -------------------------------------------------------------------------
  // Sessions (one per genre selection / retry)
  // -------------------------------------------------------------------------

  private beginSession(): void {
    this.stopWork();
    const previous = this.current;
    this.current = null;
    for (const slot of this.slots) {
      if (slot === previous) this.retireSlot(slot, true);
      else if (slot.role !== "retiring") this.unloadSlot(slot);
    }
    this.errorCode = null;
    this.networkAttempt = 0;
    this.networkRetriesExhausted = false;
    this.resetGenreState();
    this.setStatus(this.wantsPlayback ? "loading" : "paused");
    void this.loadSession(this.generation);
  }

  private async loadSession(generation: number): Promise<void> {
    const genreId = this.genreId;
    if (genreId === null) return;
    const signal = this.sessionAbort.signal;
    try {
      const [response] = await Promise.all([
        this.api.getGenreTracks(genreId, signal),
        this.refreshAnnouncementsIfStale(signal, generation),
      ]);
      if (!this.isSessionAlive(generation)) return;
      this.applyTrackList(response.tracks);
      if (this.tracks.size === 0) {
        this.enterEmpty();
        return;
      }
      this.startTransition("start", null);
    } catch (error) {
      if (!this.isSessionAlive(generation) || isAbortError(error)) return;
      this.handleApiFailure(error, "session", () => {
        if (this.isSessionAlive(generation)) void this.loadSession(generation);
      });
    }
  }

  /** Cancels all in-flight work of the current session (does not touch media elements). */
  private stopWork(): void {
    this.generation += 1;
    this.transitionSeq += 1;
    this.transitionTrackId = null;
    this.transition = null;
    this.transitionKind = null;
    this.sessionAbort.abort();
    this.sessionAbort = new AbortController();
    this.transitionAbort.abort();
    this.transitionAbort = new AbortController();
    this.clearTimer("tick");
    this.clearTimer("preload");
    this.clearTimer("network");
    this.networkRetryAction = null;
    this.stallSince = null;
  }

  private resetGenreState(): void {
    this.tracks = new Map();
    this.bag.setPool([]);
    this.tracksLoadedAt = Number.NEGATIVE_INFINITY;
    this.picksSinceListLoad = 0;
    this.consecutiveFailures = 0;
    this.positionSeconds = 0;
  }

  private releaseAllMedia(): void {
    this.current = null;
    this.retiring = null;
    for (const slot of this.slots) this.unloadSlot(slot);
  }

  private enterEmpty(): void {
    this.stopWork();
    this.releaseAllMedia();
    this.setStatus("empty");
  }

  /** Terminal until retry(): stop everything, keep the listener's intent for the retry. */
  private enterFatal(code: PlayerErrorCode): void {
    this.log("fatal", { code });
    this.stopWork();
    this.releaseAllMedia();
    this.errorCode = code;
    this.status = "error";
    this.emit();
  }

  private isSessionAlive(generation: number): boolean {
    return !this.destroyed && generation === this.generation;
  }

  private isTransitionAlive(generation: number, seq: number): boolean {
    return this.isSessionAlive(generation) && seq === this.transitionSeq;
  }

  // -------------------------------------------------------------------------
  // Catalogue and announcement lists
  // -------------------------------------------------------------------------

  private applyTrackList(list: readonly TrackSummary[]): void {
    this.tracks = new Map(list.map((track) => [track.id, track]));
    this.bag.setPool(list.map((track) => track.id));
    this.tracksLoadedAt = this.timers.now();
    this.picksSinceListLoad = 0;
    // A preloaded track that was disabled/removed meanwhile must never be promoted.
    for (const slot of this.slots) {
      if (slot.role === "nextTrack" && slot.item && !this.bag.has(slot.item.id)) {
        this.log("preload.dropped_ineligible", { id: slot.item.id });
        this.unloadSlot(slot);
      }
    }
    this.emit();
  }

  /** Refresh at most every trackListRefreshMs (or when forced by a bag cycle). Only fatal errors throw. */
  private async refreshTracksIfNeeded(signal: AbortSignal, generation: number, force: boolean): Promise<void> {
    const genreId = this.genreId;
    if (genreId === null) return;
    if (!force && this.timers.now() - this.tracksLoadedAt < this.tuning.trackListRefreshMs) return;
    try {
      const response = await this.api.getGenreTracks(genreId, signal);
      if (this.isSessionAlive(generation)) this.applyTrackList(response.tracks);
    } catch (error) {
      if (isAbortError(error)) return;
      if (error instanceof PlayerApiError && (error.kind === "auth" || error.kind === "forbidden" || error.kind === "unavailable")) {
        throw error;
      }
      // Keep playing from the list we have; the next transition tries again.
      this.log("tracks.refresh_failed", { error: describeError(error) });
    }
  }

  private async refreshAnnouncementsIfStale(signal: AbortSignal, generation: number): Promise<void> {
    if (this.timers.now() - this.announcementsLoadedAt < this.tuning.announcementRefreshMs) return;
    let response: AnnouncementsResponse;
    try {
      response = await this.api.getAnnouncements(signal);
    } catch (error) {
      if (isAbortError(error)) return;
      if (error instanceof PlayerApiError && (error.kind === "auth" || error.kind === "forbidden")) throw error;
      // Announcements are optional: music continues without them.
      this.log("announcements.refresh_failed", { error: describeError(error) });
      return;
    }
    if (!this.isSessionAlive(generation)) return;
    this.scheduler.setAnnouncements(response.announcements);
    this.scheduler.setEveryNTracks(response.settings.everyNTracks);
    this.announcementGain = normalizeGain(response.settings.volume);
    this.announcementsLoadedAt = this.timers.now();
    for (const slot of this.slots) {
      if (slot.role === "nextAnnouncement" && slot.item && !this.scheduler.isAvailable(slot.item.id)) this.unloadSlot(slot);
      this.applyVolume(slot);
    }
    this.emit();
  }

  // -------------------------------------------------------------------------
  // Transitions: choose, validate and load the next item, then promote it
  // -------------------------------------------------------------------------

  private startTransition(reason: TransitionReason, previousKind: ItemKind | null): void {
    this.transitionSeq += 1;
    this.transitionTrackId = null;
    this.transition = { reason, previousKind };
    this.transitionKind = null;
    this.transitionAbort.abort();
    this.transitionAbort = new AbortController();
    this.clearTimer("preload");
    this.stallSince = null;
    this.positionSeconds = 0;
    // Items picked by a superseded transition are dropped: a second Skip skips a loading song too
    // (announcements cannot be superseded by Skip, see canSkip()).
    for (const slot of this.slots) {
      if (slot.role === "claimed") this.unloadSlot(slot);
    }
    this.setStatus(this.wantsPlayback ? "loading" : "paused");
    void this.runTransition(this.generation, this.transitionSeq, reason, previousKind, this.transitionAbort.signal);
  }

  private async runTransition(
    generation: number,
    seq: number,
    reason: TransitionReason,
    previousKind: ItemKind | null,
    signal: AbortSignal,
  ): Promise<void> {
    const alive = () => this.isTransitionAlive(generation, seq);
    try {
      if (reason !== "start") {
        await this.refreshTracksIfNeeded(signal, generation, false);
        if (!alive()) return;
        await this.refreshAnnouncementsIfStale(signal, generation);
        if (!alive()) return;
      }
      const next = await this.acquireNext(reason, previousKind, generation, seq, signal);
      if (!alive() || next === null) return;
      const retiring = this.retiring;
      if (retiring) {
        // Let the previous item finish its short fade-out before the next one starts.
        await retiring.done;
        if (!alive()) return;
      }
      this.promote(next);
    } catch (error) {
      if (!alive() || isAbortError(error)) return;
      this.handleApiFailure(error, "transition", () => {
        if (this.isSessionAlive(generation)) this.startTransition(reason, previousKind);
      });
    }
  }

  private async acquireNext(
    reason: TransitionReason,
    previousKind: ItemKind | null,
    generation: number,
    seq: number,
    signal: AbortSignal,
  ): Promise<LoadedItem | null> {
    const alive = () => this.isTransitionAlive(generation, seq);
    if (this.welcomeDue(previousKind)) {
      const welcome = this.scheduler.takeWelcome();
      if (!welcome) {
        // Settled: already played in this browser session, or the venue has no playable welcome.
        this.welcomePending = false;
      } else {
        this.chooseTransitionKind("announcement");
        const loaded = await this.loadAnnouncement(welcome, true, signal, alive);
        if (!alive()) return null;
        if (loaded) return loaded;
        // It could not be loaded right now: music first, and the welcome stays pending (bounded).
      }
    }
    if (this.rotationDue(reason, previousKind)) {
      const loaded = await this.loadRotationAnnouncement(signal, alive);
      if (!alive()) return null;
      if (loaded) return loaded;
      // None available (or it failed): music continues and the counter stays due.
    }
    return this.loadNextTrack(generation, signal, alive);
  }

  /**
   * The pending welcome can be tried at this transition: the announcement list has been loaded
   * (a failed fetch at Start must not lose it) and no announcement played right before.
   */
  private welcomeDue(previousKind: ItemKind | null): boolean {
    return this.welcomePending && previousKind !== "announcement" && this.announcementsLoadedAt !== Number.NEGATIVE_INFINITY;
  }

  /** A station announcement is due at this transition (the counter reached N after music). */
  private rotationDue(reason: TransitionReason, previousKind: ItemKind | null): boolean {
    return reason !== "start" && previousKind !== "announcement" && this.scheduler.isDue();
  }

  /**
   * Loads the rotation clip the scheduler plays next (peekRotation: it is only taken once heard,
   * see markPlaying). A preloaded clip is claimed only while it is still that clip.
   */
  private async loadRotationAnnouncement(signal: AbortSignal, alive: () => boolean): Promise<LoadedItem | null> {
    const next = this.scheduler.peekRotation();
    const preloaded = this.findSlot("nextAnnouncement");
    if (preloaded?.item) {
      const item = preloaded.item;
      if (item.id === next?.id && this.urlCovers(item, item.durationSeconds ?? UNKNOWN_DURATION_SECONDS)) {
        this.chooseTransitionKind("announcement");
        preloaded.role = "claimed";
        return { slot: preloaded, item };
      }
      // No longer the clip that plays next (the list changed), or its URL is too close to expiry
      // (then the same clip is signed again below).
      this.unloadSlot(preloaded);
    }
    if (!next) return null;
    this.chooseTransitionKind("announcement");
    return this.loadAnnouncement(next, false, signal, alive);
  }

  /** Signs and loads an announcement into a claimed slot. Non-fatal failures return null (music next). */
  private async loadAnnouncement(
    summary: AnnouncementRef,
    isWelcome: boolean,
    signal: AbortSignal,
    alive: () => boolean,
  ): Promise<LoadedItem | null> {
    let signed: SignedMedia;
    try {
      signed = await this.api.signMedia({ kind: "announcement", id: summary.id }, signal);
    } catch (error) {
      // A superseded attempt is not a failure (the welcome stays pending, the rotation unchanged).
      if (isAbortError(error) || !alive()) return null;
      if (isSessionFatal(error)) throw error;
      if (isIneligible(error)) this.scheduler.markFailed(summary.id);
      if (isWelcome) this.noteWelcomeFailure();
      this.log("announcement.sign_failed", { id: summary.id, error: describeError(error) });
      return null;
    }
    if (!alive()) return null;
    const slot = this.allocateSlot();
    slot.role = "claimed";
    const item = this.createItem("announcement", summary.id, signed, isWelcome, summary.durationSeconds, undefined);
    this.loadSlot(slot, item, 0);
    return { slot, item };
  }

  /** A welcome attempt failed: it stays pending for a later transition, within a small budget. */
  private noteWelcomeFailure(): void {
    this.welcomeFailures += 1;
    if (this.welcomeFailures >= MAX_WELCOME_ATTEMPTS) {
      this.log("welcome.given_up", { attempts: this.welcomeFailures });
      this.welcomePending = false;
    }
  }

  /**
   * Picks the next track (the preloaded one if still eligible), re-validates it with
   * POST /api/media/sign and loads it. Ineligible tracks are excluded and count as failures.
   */
  private async loadNextTrack(generation: number, signal: AbortSignal, alive: () => boolean): Promise<LoadedItem | null> {
    const genreId = this.genreId;
    if (genreId === null) return null;
    let refreshedForCycle = false;
    for (;;) {
      if (this.bag.isEmpty) {
        if (this.tracks.size === 0) this.enterEmpty();
        else this.enterFatal("catalogue_unavailable");
        return null;
      }
      let slot = this.findSlot("nextTrack");
      if (slot?.item && !this.bag.has(slot.item.id)) {
        this.unloadSlot(slot);
        slot = null;
      }
      if (!slot && this.cycleNeedsFreshList() && !refreshedForCycle) {
        // The bag is about to start a new cycle: refresh first so new tracks join it.
        refreshedForCycle = true;
        await this.refreshTracksIfNeeded(signal, generation, true);
        if (!alive()) return null;
        continue;
      }
      const id = slot?.item?.id ?? this.takeNextTrackId();
      if (id === null) continue;
      const target = slot ?? this.allocateSlot();
      target.role = "claimed";
      this.transitionTrackId = id;
      this.chooseTransitionKind("track");
      let signed: SignedMedia;
      try {
        signed = await this.api.signMedia({ kind: "track", id, genreId }, signal);
      } catch (error) {
        if (!alive() || isAbortError(error)) return null;
        if (!isIneligible(error)) throw error;
        this.log("track.ineligible", { id, error: describeError(error) });
        this.transitionTrackId = null;
        this.unloadSlot(target);
        this.bag.exclude(id);
        // A 403 may mean the genre itself became inaccessible: make the next transition re-check the list.
        if (error.kind === "forbidden") this.tracksLoadedAt = Number.NEGATIVE_INFINITY;
        if (this.registerTrackFailure()) return null;
        continue;
      }
      if (!alive()) return null;
      return { slot: target, item: this.adoptSignedTrack(target, id, signed) };
    }
  }

  /** Keeps a preloaded element's buffer when its URL still covers the whole track + margin. */
  private adoptSignedTrack(slot: Slot, id: string, signed: SignedMedia): PlayableItem {
    const summary = this.tracks.get(id);
    const durationSeconds = signed.durationSeconds ?? summary?.durationSeconds ?? null;
    const existing = slot.item?.kind === "track" && slot.item.id === id ? slot.item : null;
    if (existing && this.urlCovers(existing, durationSeconds ?? UNKNOWN_DURATION_SECONDS)) {
      existing.durationSeconds = durationSeconds;
      return existing;
    }
    const item = this.createItem("track", id, signed, false, durationSeconds, summary);
    this.loadSlot(slot, item, 0);
    return item;
  }

  /** The bag is about to start a new cycle and the list was not reloaded since the last pick. */
  private cycleNeedsFreshList(): boolean {
    return this.bag.remainingInCycle === 0 && this.picksSinceListLoad > 0;
  }

  private takeNextTrackId(): string | null {
    const id = this.bag.next();
    if (id !== null) this.picksSinceListLoad += 1;
    return id;
  }

  /** Returns true when the failure budget is spent (the engine is now in a terminal error). */
  private registerTrackFailure(): boolean {
    this.consecutiveFailures += 1;
    const threshold = Math.max(1, Math.min(this.tuning.maxConsecutiveFailures, this.tracks.size));
    if (this.consecutiveFailures >= threshold || this.bag.isEmpty) {
      this.enterFatal("catalogue_unavailable");
      return true;
    }
    return false;
  }

  /** The running transition committed to the kind of its next item (Skip is for music only). */
  private chooseTransitionKind(kind: ItemKind): void {
    if (this.transitionKind === kind) return;
    this.transitionKind = kind;
    this.emit();
  }

  private promote({ slot, item }: LoadedItem): void {
    slot.role = "current";
    this.current = slot;
    this.transitionTrackId = null;
    this.transition = null;
    this.transitionKind = null;
    this.positionSeconds = 0;
    this.stallSince = null;
    this.log("item.promoted", { kind: item.kind, id: item.id });
    if (this.wantsPlayback) this.playSlot(slot);
    else this.setStatus("paused");
    this.emit();
  }

  private createItem(
    kind: ItemKind,
    id: string,
    signed: SignedMedia,
    isWelcome: boolean,
    fallbackDuration: number | null,
    summary: TrackSummary | undefined,
  ): PlayableItem {
    const durationSeconds = signed.durationSeconds ?? fallbackDuration;
    const nowPlaying: NowPlaying =
      kind === "track"
        ? {
            kind,
            id,
            title: signed.title ?? summary?.title ?? "Untitled",
            artist: signed.artist ?? summary?.artist ?? "Unknown Artist",
            durationSeconds,
          }
        : { kind, id, label: isWelcome ? WELCOME_ANNOUNCEMENT_LABEL : STATION_ANNOUNCEMENT_LABEL, durationSeconds };
    return {
      kind,
      id,
      isWelcome,
      nowPlaying,
      url: signed.url,
      expiresAtMs: this.parseExpiry(signed.expiresAt),
      durationSeconds,
      started: false,
      recoveries: 0,
      stallReloaded: false,
      reloading: false,
    };
  }

  /** First `playing` of an announcement: only now is the welcome settled and the rotation advanced. */
  private onAnnouncementStarted(item: PlayableItem): void {
    if (item.isWelcome) {
      this.scheduler.markWelcomePlayed();
      this.welcomePending = false;
    } else {
      this.scheduler.markRotationStarted(item.id);
    }
  }

  /** An announcement played to its natural end. */
  private finishAnnouncement(item: PlayableItem): void {
    this.scheduler.onAnnouncementPlayed();
    if (item.isWelcome) this.scheduler.markWelcomePlayed();
  }

  // -------------------------------------------------------------------------
  // Playback of the current item
  // -------------------------------------------------------------------------

  private playSlot(slot: Slot): void {
    const item = slot.item;
    if (!item) return;
    this.pauseAllExcept(slot);
    slot.fadeAbort?.abort();
    slot.fadeAbort = null;
    slot.fadeFactor = !item.started && this.fadesEnabled() ? FADE_FLOOR : 1;
    this.applyVolume(slot);
    this.setStatus(item.started && this.stallSince !== null ? "buffering" : "loading");
    const generation = this.generation;
    const token = slot.loadToken;
    // safePlay() calls el.play() synchronously, so a gesture-initiated command keeps its activation.
    void safePlay(slot.el, this.timers, this.tuning.playTimeoutMs).then((outcome) =>
      this.handlePlayOutcome(slot, token, generation, outcome),
    );
    this.resetProgress(slot);
    this.ensureTick();
  }

  private handlePlayOutcome(slot: Slot, token: number, generation: number, outcome: PlayOutcome): void {
    if (this.destroyed) return;
    if (generation !== this.generation || slot !== this.current || token !== slot.loadToken) {
      // Superseded. If a late settle left a non-current element running, stop it (exclusivity).
      if (slot !== this.current && !slot.el.paused) this.pauseSlot(slot);
      return;
    }
    const item = slot.item;
    if (!item || item.reloading) return;
    switch (outcome.kind) {
      case "playing":
        // The `playing` event is the source of truth; only enforce a pause requested meanwhile.
        if (!this.wantsPlayback) this.pauseSlot(slot);
        return;
      case "blocked":
        if (this.wantsPlayback) {
          this.log("play.blocked", { id: item.id });
          this.clearTimer("tick");
          this.setStatus("blocked");
        }
        return;
      case "superseded":
        // Not an error to show. If the element is paused and we did not ask for it, the UA paused it.
        if (slot.el.paused && this.wantsPlayback) this.handleExternalPause();
        return;
      case "timeout":
        if (!item.started) this.recoverOrFail(slot, item, false);
        return;
      case "unsupported":
      case "failed":
        this.log("play.failed", { id: item.id, outcome: outcome.kind });
        this.recoverOrFail(slot, item, false);
        return;
    }
  }

  private markPlaying(slot: Slot): void {
    const item = slot.item;
    if (!item || slot.el.paused || slot.el.ended || slot.el.error !== null) return;
    this.stallSince = null;
    this.resetProgress(slot);
    this.networkAttempt = 0;
    this.networkRetriesExhausted = false;
    if (!item.started) {
      item.started = true;
      if (item.kind === "track") this.consecutiveFailures = 0;
      else this.onAnnouncementStarted(item);
      this.fadeIn(slot);
      this.schedulePreload();
    }
    this.setStatus("playing");
    this.ensureTick();
  }

  private handleExternalPause(): void {
    this.log("pause.external");
    this.wantsPlayback = false;
    for (const slot of this.slots) this.pauseSlot(slot);
    this.stallSince = null;
    this.clearTimer("tick");
    this.setStatus("paused");
  }

  private handleEnded(slot: Slot): void {
    const item = slot.item;
    if (!item) return;
    this.current = null;
    this.unloadSlot(slot);
    // Only a natural end of a music track counts toward the announcement interval.
    if (item.kind === "track") this.scheduler.onTrackCompleted();
    else this.finishAnnouncement(item);
    this.startTransition("ended", item.kind);
  }

  /**
   * Retry a track with a fresh URL (same position) within its budget; otherwise drop the item.
   * Announcements are never retried: their failures go straight to music.
   */
  private recoverOrFail(slot: Slot, item: PlayableItem, unrecoverable: boolean): void {
    if (unrecoverable || item.kind === "announcement" || item.recoveries >= this.tuning.maxLoadRetries) {
      this.failCurrentItem(slot, item);
      return;
    }
    item.recoveries += 1;
    const position = item.started ? slot.el.currentTime : 0;
    void this.reloadWithFreshUrl(slot, item, position, "recovery");
  }

  private failCurrentItem(slot: Slot, item: PlayableItem): void {
    this.log("item.failed", { kind: item.kind, id: item.id });
    this.current = null;
    this.unloadSlot(slot);
    if (item.kind === "track") {
      this.bag.exclude(item.id);
      if (this.registerTrackFailure()) return;
    } else {
      // Announcement failures go straight to music.
      this.scheduler.markFailed(item.id);
      if (item.isWelcome && !item.started) this.noteWelcomeFailure();
    }
    this.startTransition("failure", item.kind);
  }

  private async reloadWithFreshUrl(
    slot: Slot,
    item: PlayableItem,
    position: number,
    reason: "recovery" | "stall" | "expiry",
  ): Promise<void> {
    const generation = this.generation;
    const alive = () => this.isSessionAlive(generation) && this.current === slot && slot.item === item;
    item.reloading = true;
    if (this.wantsPlayback) this.setStatus(item.started && reason !== "expiry" ? "buffering" : "loading");
    this.log("item.reload", { id: item.id, reason, position });
    try {
      const signed = await this.api.signMedia(this.signRequestFor(item), this.sessionAbort.signal);
      if (!alive()) return;
      item.reloading = false;
      item.url = signed.url;
      item.expiresAtMs = this.parseExpiry(signed.expiresAt);
      if (signed.durationSeconds !== null) item.durationSeconds = signed.durationSeconds;
      this.loadSlot(slot, item, position);
      if (this.wantsPlayback) this.playSlot(slot);
      else this.setStatus("paused");
    } catch (error) {
      if (!alive() || isAbortError(error)) return;
      item.reloading = false;
      if (isIneligible(error)) {
        this.failCurrentItem(slot, item);
        return;
      }
      this.handleApiFailure(error, "reload", () => {
        if (alive()) void this.reloadWithFreshUrl(slot, item, position, reason);
      });
    }
  }

  private signRequestFor(item: PlayableItem): SignMediaRequest {
    return item.kind === "track"
      ? { kind: "track", id: item.id, genreId: this.genreId ?? "" }
      : { kind: "announcement", id: item.id };
  }

  // -------------------------------------------------------------------------
  // Media events (listeners are registered once per pooled element)
  // -------------------------------------------------------------------------

  private handleMediaEvent(slot: Slot, type: MediaEventType): void {
    if (this.destroyed) return;
    const isCurrent = slot === this.current;
    switch (type) {
      case "playing":
        slot.pendingPauseEvents = 0;
        if (!isCurrent || !this.wantsPlayback) {
          this.log("exclusivity.paused_stray", { role: slot.role });
          this.pauseSlot(slot);
          return;
        }
        this.markPlaying(slot);
        return;
      case "pause":
        if (slot.pendingPauseEvents > 0) {
          slot.pendingPauseEvents -= 1;
          return;
        }
        // At a natural end `pause` fires before `ended` with el.ended === true: not a user pause.
        if (!isCurrent || slot.el.ended || !this.wantsPlayback || slot.item?.reloading) return;
        this.handleExternalPause();
        return;
      case "ended":
        if (isCurrent) this.handleEnded(slot);
        return;
      case "error":
        if (isCurrent) this.handleCurrentError(slot);
        else if (slot.role === "nextTrack" || slot.role === "nextAnnouncement") {
          this.log("preload.media_error", { id: slot.item?.id ?? null, code: slot.el.error?.code ?? null });
          this.unloadSlot(slot);
          // A dropped preloaded track no longer plays next: publish the corrected preview.
          this.emit();
        }
        return;
      case "waiting":
        if (isCurrent) this.handleWaiting(slot);
        return;
      case "timeupdate":
        if (isCurrent) this.updatePosition(slot);
        return;
      case "durationchange": {
        const item = slot.item;
        if (isCurrent && item && item.durationSeconds === null && Number.isFinite(slot.el.duration)) {
          item.durationSeconds = slot.el.duration;
          this.emit();
        }
        return;
      }
    }
  }

  private handleCurrentError(slot: Slot): void {
    const item = slot.item;
    const failure = classifyMediaError(slot.el.error);
    // `error` is null when the event is stale (the source was replaced meanwhile).
    if (!item || failure === null || item.reloading) return;
    this.log("media.error", { id: item.id, failure, started: item.started });
    this.recoverOrFail(slot, item, failure === "decode");
  }

  private handleWaiting(slot: Slot): void {
    const item = slot.item;
    // Before the first `playing` of an item this is still "loading" (covered by the play timeout).
    if (!item?.started || !this.wantsPlayback || item.reloading) return;
    if (this.stallSince === null) this.stallSince = this.timers.now();
    this.setStatus("buffering");
    this.ensureTick();
  }

  // -------------------------------------------------------------------------
  // Progress, buffering watchdog and position
  // -------------------------------------------------------------------------

  private ensureTick(): void {
    if (this.destroyed || this.timerHandles.has("tick")) return;
    this.setTimer("tick", PROGRESS_TICK_MS, () => {
      const slot = this.current;
      if (!slot?.item || !this.wantsPlayback) return;
      this.checkProgress(slot, slot.item);
      if (this.current === slot && this.wantsPlayback) this.ensureTick();
    });
  }

  private resetProgress(slot: Slot): void {
    this.progressTime = slot.el.currentTime;
    this.progressAt = this.timers.now();
  }

  private checkProgress(slot: Slot, item: PlayableItem): void {
    this.updatePosition(slot);
    if (!item.started || item.reloading || slot.el.paused) return;
    const now = this.timers.now();
    const time = slot.el.currentTime;
    if (time !== this.progressTime) {
      this.progressTime = time;
      this.progressAt = now;
      if (this.stallSince !== null && slot.el.readyState >= HAVE_FUTURE_DATA) {
        this.stallSince = null;
        this.setStatus("playing");
      }
      return;
    }
    if (this.stallSince === null) {
      if (now - this.progressAt <= PROGRESS_GRACE_MS) return;
      this.stallSince = this.progressAt;
      this.setStatus("buffering");
    }
    const stalledFor = now - this.stallSince;
    if (stalledFor >= this.tuning.stallFailMs || (item.kind === "announcement" && stalledFor >= this.tuning.stallReloadMs)) {
      this.log("watchdog.failed", { id: item.id, stalledFor });
      this.failCurrentItem(slot, item);
    } else if (stalledFor >= this.tuning.stallReloadMs && !item.stallReloaded) {
      item.stallReloaded = true;
      this.log("watchdog.reload", { id: item.id, stalledFor });
      void this.reloadWithFreshUrl(slot, item, time, "stall");
    }
  }

  private updatePosition(slot: Slot): void {
    const time = slot.el.currentTime;
    if (!Number.isFinite(time)) return;
    // Whole seconds keep snapshot churn to about one update per second.
    const position = Math.max(0, Math.floor(time));
    if (position === this.positionSeconds) return;
    this.positionSeconds = position;
    this.emit();
  }

  // -------------------------------------------------------------------------
  // Bounded preloading: one next track, plus one announcement only when it would be due
  // -------------------------------------------------------------------------

  private schedulePreload(): void {
    const generation = this.generation;
    const seq = this.transitionSeq;
    this.setTimer("preload", this.tuning.preloadDelayMs, () => {
      void this.preloadNext(generation, seq);
    });
  }

  private async preloadNext(generation: number, seq: number): Promise<void> {
    const alive = () => this.isTransitionAlive(generation, seq) && this.current !== null;
    const currentItem = this.current?.item;
    if (!alive() || !currentItem) return;
    const signal = this.transitionAbort.signal;
    try {
      if (currentItem.kind === "track" && this.scheduler.wouldBeDueAfterNextCompletion() && !this.findSlot("nextAnnouncement")) {
        // Peek, never take: if this preload is dropped, the same clip is still the next one.
        const next = this.scheduler.peekRotation();
        if (next) await this.preloadAnnouncement(next, signal, alive);
        if (!alive()) return;
      }
      if (!this.findSlot("nextTrack")) await this.preloadTrack(generation, signal, alive);
    } catch (error) {
      if (!alive() || isAbortError(error)) return;
      // Preloading is an optimisation; the transition redoes (and reports) anything that failed here.
      this.log("preload.failed", { error: describeError(error) });
    } finally {
      // A pick that could not be preloaded is dropped from this cycle (and a reclaimed preload slot
      // loses its track): publish the corrected "coming up" preview. No-op when nothing changed.
      this.emit();
    }
  }

  private async preloadAnnouncement(summary: AnnouncementRef, signal: AbortSignal, alive: () => boolean): Promise<void> {
    let signed: SignedMedia;
    try {
      signed = await this.api.signMedia({ kind: "announcement", id: summary.id }, signal);
    } catch (error) {
      if (!alive() || isAbortError(error)) return;
      if (isIneligible(error)) this.scheduler.markFailed(summary.id);
      this.log("preload.announcement_failed", { id: summary.id, error: describeError(error) });
      return;
    }
    if (!alive() || this.findSlot("nextAnnouncement") || !this.scheduler.isAvailable(summary.id)) return;
    const slot = this.allocateSlot();
    slot.role = "nextAnnouncement";
    this.loadSlot(slot, this.createItem("announcement", summary.id, signed, false, summary.durationSeconds, undefined), 0);
  }

  private async preloadTrack(generation: number, signal: AbortSignal, alive: () => boolean): Promise<void> {
    const genreId = this.genreId;
    if (genreId === null) return;
    if (this.cycleNeedsFreshList()) {
      await this.refreshTracksIfNeeded(signal, generation, true);
      if (!alive()) return;
    }
    const id = this.takeNextTrackId();
    if (id === null) return;
    let signed: SignedMedia;
    try {
      signed = await this.api.signMedia({ kind: "track", id, genreId }, signal);
    } catch (error) {
      if (!alive() || isAbortError(error)) return;
      if (isIneligible(error)) this.bag.exclude(id);
      this.log("preload.track_failed", { id, error: describeError(error) });
      return;
    }
    if (!alive() || this.findSlot("nextTrack") || !this.bag.has(id)) return;
    const summary = this.tracks.get(id);
    const slot = this.allocateSlot();
    slot.role = "nextTrack";
    this.loadSlot(slot, this.createItem("track", id, signed, false, summary?.durationSeconds ?? null, summary), 0);
  }

  // -------------------------------------------------------------------------
  // Element pool
  // -------------------------------------------------------------------------

  private createSlot(el: MediaElementLike): Slot {
    const slot: Slot = {
      el,
      role: "free",
      item: null,
      loadToken: 0,
      pendingPauseEvents: 0,
      fadeFactor: 1,
      fadeAbort: null,
      listeners: [],
    };
    el.preload = "auto";
    el.muted = this.muted;
    for (const type of MEDIA_EVENTS) {
      const listener = () => this.handleMediaEvent(slot, type);
      el.addEventListener(type, listener);
      slot.listeners.push([type, listener]);
    }
    this.applyVolume(slot);
    return slot;
  }

  private findSlot(role: SlotRole): Slot | null {
    return this.slots.find((slot) => slot.role === role) ?? null;
  }

  private allocateSlot(): Slot {
    const free = this.findSlot("free");
    if (free) return free;
    if (this.retiring) {
      const { slot } = this.retiring;
      this.retiring = null;
      this.unloadSlot(slot);
      return slot;
    }
    // current + nextTrack + nextAnnouncement can fill the pool: give up the announcement preload first.
    const reclaim = this.findSlot("nextAnnouncement") ?? this.findSlot("nextTrack") ?? this.slots.find((slot) => slot !== this.current);
    if (!reclaim) throw new Error("PlayerEngine: no media element available");
    this.unloadSlot(reclaim);
    return reclaim;
  }

  /** WebKit gates autoplay per element: load() on idle elements inside the gesture unlocks them. */
  private unlockIdleElements(): void {
    for (const slot of this.slots) {
      if (slot.role !== "free" || slot.item !== null || slot.el.networkState !== NETWORK_EMPTY) continue;
      try {
        slot.el.load();
      } catch (error) {
        this.log("media.unlock_failed", { error: describeError(error) });
      }
    }
  }

  private loadSlot(slot: Slot, item: PlayableItem, position: number): void {
    slot.fadeAbort?.abort();
    slot.fadeAbort = null;
    this.pauseElement(slot);
    slot.item = item;
    slot.loadToken += 1;
    slot.fadeFactor = 1;
    slot.el.muted = this.muted;
    this.applyVolume(slot);
    reloadAt(slot.el, item.url, position);
  }

  /** Cancel the download and free the element: pause(); removeAttribute('src'); load(). */
  private unloadSlot(slot: Slot): void {
    slot.fadeAbort?.abort();
    slot.fadeAbort = null;
    if (!slot.el.paused) slot.pendingPauseEvents += 1;
    try {
      unloadMedia(slot.el);
    } catch (error) {
      this.log("media.unload_failed", { error: describeError(error) });
    }
    slot.loadToken += 1;
    slot.item = null;
    slot.role = "free";
    slot.fadeFactor = 1;
    this.applyVolume(slot);
  }

  /** Fade the outgoing item (skip / genre change) and then free its element. */
  private retireSlot(slot: Slot, fade: boolean): void {
    if (this.retiring) {
      const previous = this.retiring.slot;
      this.retiring = null;
      if (previous.role === "retiring") this.unloadSlot(previous);
    }
    if (!fade || !this.fadesEnabled() || slot.el.paused || !slot.item?.started) {
      this.unloadSlot(slot);
      return;
    }
    slot.role = "retiring";
    const token = slot.loadToken;
    const done = this.fadeSlot(slot, 0, this.tuning.fadeOutMs).then(() => {
      if (slot.role === "retiring" && slot.loadToken === token) this.unloadSlot(slot);
      if (this.retiring?.slot === slot) this.retiring = null;
    });
    this.retiring = { slot, done };
  }

  private pauseSlot(slot: Slot): void {
    slot.fadeAbort?.abort();
    slot.fadeAbort = null;
    this.pauseElement(slot);
  }

  private pauseElement(slot: Slot): void {
    if (slot.el.paused) return;
    slot.pendingPauseEvents += 1;
    slot.el.pause();
  }

  private pauseAllExcept(keep: Slot): void {
    for (const slot of this.slots) {
      if (slot !== keep) this.pauseSlot(slot);
    }
  }

  // -------------------------------------------------------------------------
  // Volume and fades
  // -------------------------------------------------------------------------

  private applyVolume(slot: Slot): void {
    if (this.volumeWritable === false) return;
    const gain = slot.item?.kind === "announcement" ? this.announcementGain : MUSIC_GAIN;
    const value = clamp01(this.masterVolume * gain * slot.fadeFactor);
    try {
      if (slot.el.volume !== value) slot.el.volume = value;
    } catch {
      // Read-only or out-of-range volume on this platform: nothing useful to do.
    }
  }

  private fadesEnabled(): boolean {
    return this.volumeWritable === true && this.isPageVisible();
  }

  private isPageVisible(): boolean {
    try {
      return this.deps.isPageVisible?.() ?? true;
    } catch {
      return true;
    }
  }

  private fadeIn(slot: Slot): void {
    if (slot.fadeFactor >= 1) return;
    if (!this.fadesEnabled()) {
      slot.fadeFactor = 1;
      this.applyVolume(slot);
      return;
    }
    void this.fadeSlot(slot, 1, this.tuning.fadeInMs);
  }

  private fadeSlot(slot: Slot, to: number, durationMs: number): Promise<void> {
    slot.fadeAbort?.abort();
    const controller = new AbortController();
    slot.fadeAbort = controller;
    return rampValue({
      from: slot.fadeFactor,
      to,
      durationMs,
      timers: this.timers,
      isHidden: () => !this.isPageVisible(),
      signal: controller.signal,
      apply: (value) => {
        // A fade-out ends with pause() in the same tick: never leave an element playing at volume 0.
        if (value <= 0) this.pauseElement(slot);
        slot.fadeFactor = value;
        this.applyVolume(slot);
      },
    }).finally(() => {
      if (slot.fadeAbort === controller) slot.fadeAbort = null;
    });
  }

  private async detectVolume(): Promise<void> {
    const probe = this.findSlot("free");
    if (!probe) return;
    let writable: boolean;
    try {
      writable = await detectVolumeWritable(probe.el, this.timers);
    } catch {
      writable = false;
    }
    if (this.destroyed) return;
    this.volumeWritable = writable;
    if (writable) {
      for (const slot of this.slots) this.applyVolume(slot);
    }
    this.log("volume.writable", { writable });
    this.emit();
  }

  // -------------------------------------------------------------------------
  // API failures and network recovery
  // -------------------------------------------------------------------------

  private handleApiFailure(error: unknown, context: string, retry: () => void): void {
    this.log("api.failed", { context, error: describeError(error) });
    if (error instanceof PlayerApiError) {
      switch (error.kind) {
        case "auth":
          return this.enterFatal("auth_expired");
        case "forbidden":
          return this.enterFatal(isBusinessBlock(error.code) ? "business_inactive" : "genre_unavailable");
        case "unavailable":
          return this.enterFatal("genre_unavailable");
        case "network":
        case "server":
        case "rate_limited":
          return this.enterNetworkError(retry);
      }
    }
    this.enterFatal("unknown");
  }

  /** error(network) with bounded backoff; `online` and Retry run the pending action immediately. */
  private enterNetworkError(retry: () => void): void {
    for (const slot of this.slots) this.pauseSlot(slot);
    this.clearTimer("tick");
    this.clearTimer("preload");
    this.clearTimer("network");
    this.stallSince = null;
    this.networkRetryAction = retry;
    const delays = this.tuning.networkRetryDelaysMs;
    if (this.networkAttempt < delays.length) {
      const delay = delays[this.networkAttempt];
      this.networkAttempt += 1;
      this.networkRetriesExhausted = false;
      this.setTimer("network", delay, () => this.runNetworkRetry());
    } else {
      this.networkRetriesExhausted = true;
    }
    this.errorCode = "network";
    this.status = "error";
    this.emit();
  }

  private runNetworkRetry(): void {
    const action = this.networkRetryAction;
    if (!action || this.destroyed) return;
    this.networkRetryAction = null;
    this.clearTimer("network");
    this.log("network.retry", { attempt: this.networkAttempt });
    this.setStatus(this.wantsPlayback ? "loading" : "paused");
    action();
  }

  private handleOnline(): void {
    if (this.destroyed || this.status !== "error" || this.errorCode !== "network") return;
    this.runNetworkRetry();
  }

  private handleVisibilityChange(): void {
    // Catch-up check: watchdog timers may have been throttled while the tab was hidden.
    if (this.destroyed || !this.isPageVisible()) return;
    const slot = this.current;
    if (slot?.item && this.wantsPlayback) this.checkProgress(slot, slot.item);
  }

  // -------------------------------------------------------------------------
  // Signed URL expiry
  // -------------------------------------------------------------------------

  private urlCovers(item: PlayableItem, neededSeconds: number): boolean {
    const neededMs = (neededSeconds + this.tuning.urlExpiryMarginSeconds) * 1000;
    return item.expiresAtMs - this.timers.now() >= neededMs;
  }

  private remainingSeconds(slot: Slot, item: PlayableItem): number {
    const duration = item.durationSeconds ?? UNKNOWN_DURATION_SECONDS;
    const position = Number.isFinite(slot.el.currentTime) ? slot.el.currentTime : 0;
    return Math.max(0, duration - position);
  }

  private parseExpiry(expiresAt: string): number {
    const value = Date.parse(expiresAt);
    // An unreadable expiry is treated as already expired, which forces a re-sign before use.
    return Number.isFinite(value) ? value : this.timers.now();
  }

  // -------------------------------------------------------------------------
  // Media Session
  // -------------------------------------------------------------------------

  private mediaSessionHandlers(): Array<[MediaSessionActionName, (() => void) | null]> {
    return [
      ["play", () => this.resume()],
      ["pause", () => this.pause()],
      ["stop", () => this.pause()],
      ["nexttrack", () => this.skip()],
      // A radio has no seeking or "previous": make sure no default/stale handler lingers.
      ["previoustrack", null],
      ["seekbackward", null],
      ["seekforward", null],
      ["seekto", null],
    ];
  }

  private bindMediaSession(): void {
    const session = this.deps.mediaSession;
    if (!session) return;
    for (const [action, handler] of this.mediaSessionHandlers()) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Unsupported action in this browser (TypeError).
      }
    }
  }

  private unbindMediaSession(): void {
    const session = this.deps.mediaSession;
    if (!session) return;
    for (const [action] of this.mediaSessionHandlers()) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // Unsupported action in this browser.
      }
    }
    try {
      session.metadata = null;
      session.playbackState = "none";
    } catch (error) {
      this.log("media_session.failed", { error: describeError(error) });
    }
  }

  private syncMediaSession(): void {
    const session = this.deps.mediaSession;
    if (!session || this.destroyed) return;
    const { current, status } = this.snapshot;
    try {
      if (current) {
        const key = `${current.kind}:${current.id}`;
        if (key !== this.mediaSessionKey) {
          this.mediaSessionKey = key;
          session.metadata = this.deps.createMediaMetadata?.(this.mediaMetadataFor(current)) ?? null;
        }
      } else if ((status === "idle" || status === "error" || status === "empty") && this.mediaSessionKey !== "") {
        // Between items (loading) the previous metadata stays up to avoid flicker.
        this.mediaSessionKey = "";
        session.metadata = null;
      }
      const active = status === "playing" || status === "buffering" || status === "loading";
      const state = status === "idle" ? "none" : active && this.wantsPlayback ? "playing" : "paused";
      if (session.playbackState !== state) session.playbackState = state;
    } catch (error) {
      this.log("media_session.failed", { error: describeError(error) });
    }
  }

  private mediaMetadataFor(item: NowPlaying): { title: string; artist: string; album: string; artwork?: { src: string }[] } {
    const station = this.config.stationName;
    return {
      title: item.kind === "track" ? item.title : item.label,
      artist: item.kind === "track" ? item.artist : station,
      album: station,
      artwork: this.config.logoUrl ? [{ src: this.config.logoUrl }] : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  private setStatus(status: PlayerStatus): void {
    this.status = status;
    if (status !== "error") this.errorCode = null;
    this.emit();
  }

  private canSkip(): boolean {
    if (!this.hasStarted || this.genreId === null || this.tracks.size === 0) return false;
    const skippable =
      this.status === "playing" ||
      this.status === "buffering" ||
      this.status === "loading" ||
      this.status === "paused" ||
      this.status === "blocked";
    if (!skippable) return false;
    // Skip applies to music only (design/CLAUDE-HANDOFF.md §03/04).
    if (this.isAnnouncementInProgress()) return false;
    // With a single track, skipping music would only restart the same track.
    return !this.bag.isSingleTrack;
  }

  /**
   * An announcement is the current item, or the running transition is loading one (or will: while
   * it is still refreshing the lists, the same rules acquireNext() applies next are used).
   */
  private isAnnouncementInProgress(): boolean {
    const current = this.current?.item;
    if (current) return current.kind === "announcement";
    const transition = this.transition;
    if (!transition) return false;
    if (this.transitionKind !== null) return this.transitionKind === "announcement";
    return (
      (this.welcomeDue(transition.previousKind) && this.scheduler.hasWelcome()) ||
      (this.rotationDue(transition.reason, transition.previousKind) && this.scheduler.hasRotation)
    );
  }

  private buildSnapshot(): PlayerSnapshot {
    const item = this.current?.item ?? null;
    const terminal = this.status === "error" || this.status === "empty";
    return {
      status: this.status,
      genreId: this.genreId,
      current: item?.nowPlaying ?? null,
      positionSeconds: item ? this.positionSeconds : 0,
      durationSeconds: item?.durationSeconds ?? null,
      volume: this.masterVolume,
      muted: this.muted,
      message: this.describeStatus(item),
      errorCode: this.status === "error" ? this.errorCode : null,
      notice: this.bag.isSingleTrack && !terminal ? SINGLE_TRACK_NOTICE : null,
      hasStarted: this.hasStarted,
      tracksSinceAnnouncement: this.scheduler.completedTracks,
      tracksUntilAnnouncement: this.scheduler.tracksUntilAnnouncement,
      upcoming: this.computeUpcoming(),
      canSkip: this.canSkip(),
      announcementInProgress: this.hasStarted && !terminal && this.status !== "idle" && this.isAnnouncementInProgress(),
      volumeControllable: this.volumeWritable !== false,
    };
  }

  /** PlayerSnapshot.upcoming; the previous array is reused while its content is unchanged. */
  private computeUpcoming(): UpcomingTrack[] {
    const next: UpcomingTrack[] = [];
    for (const id of this.upcomingTrackIds()) {
      const track = this.tracks.get(id);
      if (track) next.push({ id, title: track.title, artist: track.artist, durationSeconds: track.durationSeconds });
    }
    if (sameUpcoming(this.upcomingCache, next)) return this.upcomingCache;
    this.upcomingCache = next;
    return next;
  }

  /**
   * The next tracks in the order they will play (announcements are not listed): the track a running
   * transition is loading, then a still-eligible preloaded track, then the shuffle bag's own order
   * (ShuffleBag.peek never consumes or reorders it). The list stops at the current track or at a
   * repeat, so it is always an exact prefix of what plays next until the genre list refreshes or a
   * track fails. Only ids of the loaded genre list qualify, so removed tracks never appear. A
   * single-track genre shows its track repeating.
   */
  private upcomingTrackIds(): string[] {
    if (NO_UPCOMING_STATUSES.has(this.status) || this.bag.isEmpty) return [];
    const sequence: string[] = [];
    if (this.transitionTrackId !== null && this.bag.has(this.transitionTrackId)) sequence.push(this.transitionTrackId);
    const preloaded = this.findSlot("nextTrack")?.item;
    if (preloaded?.kind === "track" && this.bag.has(preloaded.id)) sequence.push(preloaded.id);
    sequence.push(...this.bag.peek(UPCOMING_LIMIT));
    if (this.bag.isSingleTrack) return sequence.slice(0, 1);
    const currentItem = this.current?.item;
    const currentTrackId = currentItem?.kind === "track" ? currentItem.id : null;
    const ids: string[] = [];
    for (const id of sequence) {
      if (ids.length === UPCOMING_LIMIT || id === currentTrackId || ids.includes(id)) break;
      if (this.tracks.has(id)) ids.push(id);
    }
    return ids;
  }

  private describeStatus(item: PlayableItem | null): string | null {
    switch (this.status) {
      case "idle":
        return this.genreId === null ? "Choose a genre to start the radio." : null;
      case "loading":
        return "Loading…";
      case "playing":
        return item ? `Playing: ${describeNowPlaying(item.nowPlaying)}` : "Playing";
      case "paused":
        return "Paused";
      case "buffering":
        return "Buffering…";
      case "blocked":
        return "Audio was blocked by the browser. Press Start audio to listen.";
      case "empty":
        return "There are no tracks in this genre yet. Choose another genre.";
      case "error":
        return this.errorMessage();
    }
  }

  private errorMessage(): string {
    switch (this.errorCode) {
      case "catalogue_unavailable":
        return "Tracks in this genre could not be played. Press Retry or choose another genre.";
      case "network":
        return this.networkRetriesExhausted
          ? "Connection lost. Check the internet connection and press Retry."
          : "Connection lost. Retrying…";
      case "auth_expired":
        return "Your session has expired. Please sign in again.";
      case "business_inactive":
        return "This venue is not active.";
      case "genre_unavailable":
        return "This genre is no longer available. Choose another genre.";
      case "unknown":
      case null:
        return "Something went wrong. Press Retry.";
    }
  }

  private emit(): void {
    if (!this.destroyed) this.publish();
  }

  /** Replaces the snapshot only when a field changed (useSyncExternalStore needs a stable identity). */
  private publish(): void {
    const next = this.buildSnapshot();
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = next;
    this.syncMediaSession();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.log("listener.failed", { error: describeError(error) });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Preferences, timers, diagnostics
  // -------------------------------------------------------------------------

  /** Debounced best-effort save; a failed save never affects playback. */
  private queuePreferences(update: UpdatePreferencesRequest): void {
    Object.assign(this.pendingPreferences, update);
    this.setTimer("preferences", PREFERENCES_DEBOUNCE_MS, () => this.flushPreferences());
  }

  /** Drops unsaved preference changes (the browser's session now belongs to someone else). */
  private discardPreferences(): void {
    this.clearTimer("preferences");
    if (Object.keys(this.pendingPreferences).length > 0) this.log("preferences.discarded");
    this.pendingPreferences = {};
  }

  private flushPreferences(): void {
    this.clearTimer("preferences");
    const update = this.pendingPreferences;
    this.pendingPreferences = {};
    if (Object.keys(update).length === 0) return;
    const onError = (error: unknown) => this.log("preferences.save_failed", { error: describeError(error) });
    try {
      this.api.savePreferences(update).catch(onError);
    } catch (error) {
      onError(error);
    }
  }

  private setTimer(name: TimerName, ms: number, callback: () => void): void {
    this.clearTimer(name);
    const handle = this.timers.setTimeout(() => {
      if (this.timerHandles.get(name) !== handle) return;
      this.timerHandles.delete(name);
      callback();
    }, ms);
    this.timerHandles.set(name, handle);
  }

  private clearTimer(name: TimerName): void {
    if (!this.timerHandles.has(name)) return;
    this.timers.clearTimeout(this.timerHandles.get(name));
    this.timerHandles.delete(name);
  }

  private log(event: string, detail?: Record<string, unknown>): void {
    try {
      this.deps.log?.(event, detail);
    } catch {
      // Diagnostics must never break playback.
    }
  }
}

export function createPlayerEngine(deps: EngineDeps, config: EngineConfig, tuning?: Partial<EngineTuning>): PlayerEngine {
  return new PlayerEngine(deps, config, tuning);
}

// ---------------------------------------------------------------------------
// Module helpers
// ---------------------------------------------------------------------------

/** Drops undefined values so an explicit `{ fadeInMs: undefined }` cannot erase a default. */
function definedOnly<T extends object>(value: Partial<T>): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function normalizeGain(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0.1, value));
}

function isBusinessBlock(code: string | null): boolean {
  return code === "business_inactive" || code === "no_business";
}

/** The item itself is no longer playable/accessible (404/410, or a 403 that is not a venue block). */
function isIneligible(error: unknown): error is PlayerApiError {
  return (
    error instanceof PlayerApiError &&
    (error.kind === "unavailable" || (error.kind === "forbidden" && !isBusinessBlock(error.code)))
  );
}

/** Errors that end the whole session no matter which item triggered them. */
function isSessionFatal(error: unknown): boolean {
  return (
    error instanceof PlayerApiError &&
    (error.kind === "auth" || (error.kind === "forbidden" && isBusinessBlock(error.code)))
  );
}

function describeNowPlaying(item: NowPlaying): string {
  return item.kind === "track" ? `${item.title} – ${item.artist}` : item.label;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function sameUpcoming(a: readonly UpcomingTrack[], b: readonly UpcomingTrack[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (track, index) =>
        track.id === b[index].id &&
        track.title === b[index].title &&
        track.artist === b[index].artist &&
        track.durationSeconds === b[index].durationSeconds,
    )
  );
}

function sameSnapshot(a: PlayerSnapshot, b: PlayerSnapshot): boolean {
  return (Object.keys(b) as Array<keyof PlayerSnapshot>).every((key) => Object.is(a[key], b[key]));
}
