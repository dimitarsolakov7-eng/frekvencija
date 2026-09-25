/**
 * Deterministic fakes for the playback engine: a manual clock, media elements that mimic the
 * browser behaviours documented in docs/research/browser-audio.md, and a scriptable PlayerApi.
 */
import type {
  AnnouncementSummary,
  AnnouncementsResponse,
  GenreTracksResponse,
  PlaybackPreferences,
  SignMediaRequest,
  SignedMedia,
  TrackSummary,
  UpdatePreferencesRequest,
} from "@/lib/api/contracts";
import type { KeyValueStorage, MediaElementLike, MediaSessionActionName, MediaSessionLike, PlayerApi, Timers } from "@/lib/player/types";

/** Let every pending promise continuation and queued media event run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

interface ScheduledTimer {
  at: number;
  order: number;
  callback: () => void;
}

export class ManualClock implements Timers {
  private current: number;
  private nextId = 1;
  private readonly scheduled = new Map<number, ScheduledTimer>();

  constructor(start = Date.parse("2026-09-25T12:00:00.000Z")) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.scheduled.set(id, { at: this.current + Math.max(0, ms), order: id, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.scheduled.delete(handle as number);
  }

  get pendingCount(): number {
    return this.scheduled.size;
  }

  /** Advance time, firing due timers in order and settling async work after each one. */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    await settle();
    for (;;) {
      let nextId: number | null = null;
      let next: ScheduledTimer | null = null;
      for (const [id, timer] of this.scheduled) {
        if (timer.at > target) continue;
        if (!next || timer.at < next.at || (timer.at === next.at && timer.order < next.order)) {
          next = timer;
          nextId = id;
        }
      }
      if (!next || nextId === null) break;
      this.scheduled.delete(nextId);
      this.current = Math.max(this.current, next.at);
      next.callback();
      await settle();
    }
    this.current = target;
    await settle();
  }
}

// ---------------------------------------------------------------------------
// Media elements
// ---------------------------------------------------------------------------

export type PlayBehavior = "play" | "block" | "unsupported" | "pending";

export class MediaHarness {
  readonly elements: FakeMediaElement[] = [];
  /** Decides what play() does for an element (by default it plays). */
  playBehavior: (el: FakeMediaElement) => PlayBehavior = () => "play";
  volumeMode: "writable" | "readonly" = "writable";
  defaultDuration = 180;
  /** Every time any element became unpaused while another (with a source) was unpaused too. */
  readonly violations: string[] = [];

  constructor(readonly clock: ManualClock) {}

  readonly create = (): FakeMediaElement => {
    const el = new FakeMediaElement(this, this.elements.length);
    this.elements.push(el);
    return el;
  };

  /** Elements that are unpaused and have a source (could be audible). */
  active(): FakeMediaElement[] {
    return this.elements.filter((el) => !el.paused && el.src !== "");
  }

  /** The single element currently playing audio, or null. */
  playing(): FakeMediaElement | null {
    const active = this.active().filter((el) => el.isAudible);
    return active.length === 1 ? active[0] : null;
  }

  assertExclusive(context = ""): void {
    const active = this.active();
    if (active.length > 1) {
      throw new Error(`exclusivity violated ${context}: ${active.map((el) => el.describe()).join(", ")}`);
    }
    if (this.violations.length > 0) throw new Error(`exclusivity violated earlier: ${this.violations.join("; ")}`);
  }

  withSrc(fragment: string): FakeMediaElement[] {
    return this.elements.filter((el) => el.src.includes(fragment));
  }

  noteBecameActive(el: FakeMediaElement): void {
    const others = this.active().filter((other) => other !== el);
    if (others.length > 0) this.violations.push(`${el.describe()} with ${others.map((o) => o.describe()).join(", ")}`);
  }
}

type Listener = (event: Event) => void;

interface PendingPlay {
  resolve: () => void;
  reject: (error: unknown) => void;
}

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

export class FakeMediaElement implements MediaElementLike {
  preload: "" | "none" | "metadata" | "auto" = "";
  muted = false;
  loadCalls = 0;
  playCalls = 0;
  readonly srcHistory: string[] = [];

  private srcAttr: string | null = null;
  private pausedState = true;
  private endedState = false;
  private ready = 0;
  private network = 0;
  private errorState: { code: number } | null = null;
  private baseTime = 0;
  private runningSince: number | null = null;
  private durationValue = Number.NaN;
  private volumeValue = 1;
  private pendingPlays: PendingPlay[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    private readonly harness: MediaHarness,
    readonly index: number,
  ) {}

  describe(): string {
    return `#${this.index}(${this.srcAttr ?? "no src"})`;
  }

  get listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }

  // --- MediaElementLike -----------------------------------------------------

  get src(): string {
    return this.srcAttr ?? "";
  }

  set src(value: string) {
    this.srcAttr = value;
    this.srcHistory.push(value);
    this.runLoadAlgorithm();
  }

  get currentTime(): number {
    if (this.runningSince === null) return this.baseTime;
    const elapsed = (this.harness.clock.now() - this.runningSince) / 1000;
    const limit = Number.isFinite(this.durationValue) ? this.durationValue : Number.POSITIVE_INFINITY;
    return Math.min(limit, this.baseTime + elapsed);
  }

  set currentTime(value: number) {
    this.baseTime = value;
    if (this.runningSince !== null) this.runningSince = this.harness.clock.now();
  }

  get duration(): number {
    return this.durationValue;
  }

  get volume(): number {
    return this.volumeValue;
  }

  set volume(value: number) {
    if (value < 0 || value > 1 || Number.isNaN(value)) throw new RangeError("IndexSizeError");
    if (this.harness.volumeMode === "readonly") return;
    this.volumeValue = value;
  }

  get paused(): boolean {
    return this.pausedState;
  }

  get ended(): boolean {
    return this.endedState;
  }

  get readyState(): number {
    return this.ready;
  }

  get networkState(): number {
    return this.network;
  }

  get error(): { code: number } | null {
    return this.errorState;
  }

  /** Playing and time is advancing. */
  get isAudible(): boolean {
    return !this.pausedState && this.runningSince !== null;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    const behavior = this.srcAttr === null ? null : this.harness.playBehavior(this);
    // Autoplay refusal happens before the play algorithm flips "paused": no play/pause events.
    if (behavior === "block") return Promise.reject(domError("NotAllowedError"));
    return new Promise<void>((resolve, reject) => {
      const wasPaused = this.pausedState;
      this.pausedState = false;
      this.endedState = false;
      if (wasPaused && this.srcAttr !== null) this.harness.noteBecameActive(this);
      this.queue("play");
      if (behavior === null) {
        // Browsers leave a src-less play() pending forever.
        this.pendingPlays.push({ resolve, reject });
        return;
      }
      switch (behavior) {
        case "unsupported":
          this.errorState = { code: 4 };
          this.pausedState = true;
          this.queue("error");
          reject(domError("NotSupportedError"));
          return;
        case "pending":
          this.pendingPlays.push({ resolve, reject });
          return;
        case "play":
          this.pendingPlays.push({ resolve, reject });
          queueMicrotask(() => this.becomePlaying());
          return;
      }
    });
  }

  pause(): void {
    if (this.pausedState) return;
    this.freeze();
    this.pausedState = true;
    this.rejectPending("AbortError");
    this.queue("pause");
  }

  load(): void {
    this.loadCalls += 1;
    this.runLoadAlgorithm();
  }

  removeAttribute(name: string): void {
    if (name === "src") this.srcAttr = null;
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  // --- Test controls ----------------------------------------------------------

  /** Resolve a pending play() (behaviour "pending"): the element starts playing. */
  resolvePlay(): void {
    this.becomePlaying();
  }

  /** Reject pending play() calls with a DOMException-like error of the given name. */
  rejectPlay(name: string): void {
    if (name === "NotAllowedError") {
      this.freeze();
      this.pausedState = true;
    }
    this.rejectPending(name);
  }

  /** Natural end: `pause` (with ended = true) then `ended`. */
  finish(): void {
    this.baseTime = Number.isFinite(this.durationValue) ? this.durationValue : this.currentTime;
    this.runningSince = null;
    this.pausedState = true;
    this.endedState = true;
    this.queue("pause");
    this.queue("ended");
  }

  /** Mid-playback network failure: error code 2, `paused` stays false, no `pause` event. */
  failNetwork(): void {
    this.freeze();
    this.errorState = { code: 2 };
    this.ready = 1;
    this.queue("waiting");
    this.queue("error");
  }

  /** Source failure (code 4), e.g. expired URL before metadata. */
  failSource(): void {
    this.freeze();
    this.errorState = { code: 4 };
    this.queue("error");
  }

  /** Data starvation: `waiting`, time stops advancing. */
  stall(): void {
    this.freeze();
    this.ready = 2;
    this.queue("waiting");
  }

  /** Recover from a stall. */
  unstall(): void {
    if (this.pausedState) return;
    this.ready = 4;
    this.runningSince = this.harness.clock.now();
    this.queue("playing");
  }

  /** Time stops advancing with no event at all (e.g. after device sleep). */
  freezeSilently(): void {
    this.freeze();
  }

  /** A pause the engine did not request (OS interruption, headphones unplugged). */
  externalPause(): void {
    this.pause();
  }

  /** Force a `playing` event even though nothing asked for it (misbehaving/late UA). */
  forcePlaying(): void {
    const wasPaused = this.pausedState;
    this.pausedState = false;
    if (wasPaused) this.harness.noteBecameActive(this);
    this.ready = 4;
    this.runningSince = this.harness.clock.now();
    this.queue("playing");
  }

  dispatch(type: string): void {
    const event = { type } as unknown as Event;
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  // --- internals ----------------------------------------------------------------

  private becomePlaying(): void {
    if (this.pausedState || this.srcAttr === null || this.errorState !== null) return;
    this.ready = 4;
    if (!Number.isFinite(this.durationValue)) {
      this.durationValue = this.harness.defaultDuration;
      this.queue("durationchange");
    }
    this.runningSince = this.harness.clock.now();
    const pending = this.pendingPlays;
    this.pendingPlays = [];
    for (const p of pending) p.resolve();
    this.queue("playing");
  }

  private runLoadAlgorithm(): void {
    this.rejectPending("AbortError");
    this.freeze();
    this.pausedState = true;
    this.endedState = false;
    this.errorState = null;
    this.ready = 0;
    this.baseTime = 0;
    this.durationValue = Number.NaN;
    this.network = this.srcAttr === null ? 0 : 2;
  }

  private freeze(): void {
    this.baseTime = this.currentTime;
    this.runningSince = null;
  }

  private rejectPending(name: string): void {
    const pending = this.pendingPlays;
    this.pendingPlays = [];
    for (const p of pending) p.reject(domError(name));
  }

  private queue(type: string): void {
    queueMicrotask(() => this.dispatch(type));
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export class FakeApiError extends Error {}

type ApiMethod = "tracks" | "announcements" | "sign" | "preferences";

interface HeldRequest {
  release: () => void;
}

export interface SignCall {
  request: SignMediaRequest;
  at: number;
}

export class FakePlayerApi implements PlayerApi {
  readonly genres = new Map<string, TrackSummary[]>();
  announcementList: AnnouncementSummary[] = [];
  settings = { everyNTracks: 4, volume: 1 };
  signTtlSeconds = 7200;
  readonly calls: Array<{ method: ApiMethod; detail: string; at: number }> = [];
  readonly signCalls: SignCall[] = [];
  readonly savedPreferences: UpdatePreferencesRequest[] = [];

  /** Return an error to make the call fail (evaluated per call). */
  failTracks: ((genreId: string) => Error | null) | null = null;
  failAnnouncements: (() => Error | null) | null = null;
  failSign: ((request: SignMediaRequest) => Error | null) | null = null;
  /** Override the TTL of a particular signed URL. */
  ttlFor: ((request: SignMediaRequest, count: number) => number | null) | null = null;

  /** When set, calls of that kind wait until releaseHeld() (optionally ignoring abort). */
  readonly holding = new Set<ApiMethod>();
  honorAbortWhileHeld = true;
  private held: HeldRequest[] = [];
  private signSeq = 0;

  constructor(private readonly clock: ManualClock) {}

  get requestCount(): number {
    return this.calls.length;
  }

  signsFor(id: string): SignCall[] {
    return this.signCalls.filter((call) => call.request.id === id);
  }

  releaseHeld(): void {
    const held = this.held;
    this.held = [];
    for (const request of held) request.release();
  }

  async getGenreTracks(genreId: string, signal?: AbortSignal): Promise<GenreTracksResponse> {
    this.calls.push({ method: "tracks", detail: genreId, at: this.clock.now() });
    await this.gate("tracks", signal);
    const error = this.failTracks?.(genreId);
    if (error) throw error;
    return {
      genreId,
      tracks: [...(this.genres.get(genreId) ?? [])],
      fetchedAt: new Date(this.clock.now()).toISOString(),
    };
  }

  async getAnnouncements(signal?: AbortSignal): Promise<AnnouncementsResponse> {
    this.calls.push({ method: "announcements", detail: "", at: this.clock.now() });
    await this.gate("announcements", signal);
    const error = this.failAnnouncements?.();
    if (error) throw error;
    return {
      announcements: [...this.announcementList],
      settings: { ...this.settings },
      brandingVersion: 1,
      fetchedAt: new Date(this.clock.now()).toISOString(),
    };
  }

  async signMedia(request: SignMediaRequest, signal?: AbortSignal): Promise<SignedMedia> {
    this.calls.push({ method: "sign", detail: `${request.kind}:${request.id}`, at: this.clock.now() });
    this.signCalls.push({ request, at: this.clock.now() });
    const count = this.signsFor(request.id).length;
    await this.gate("sign", signal);
    const error = this.failSign?.(request);
    if (error) throw error;
    const ttl = this.ttlFor?.(request, count) ?? this.signTtlSeconds;
    const seq = ++this.signSeq;
    const base = {
      kind: request.kind,
      id: request.id,
      url: `https://media.test/${request.kind}/${request.id}?sig=${seq}`,
      expiresAt: new Date(this.clock.now() + ttl * 1000).toISOString(),
    };
    if (request.kind === "track") {
      const track = [...this.genres.values()].flat().find((t) => t.id === request.id);
      return { ...base, durationSeconds: track?.durationSeconds ?? null, title: track?.title, artist: track?.artist };
    }
    const announcement = this.announcementList.find((a) => a.id === request.id);
    return { ...base, durationSeconds: announcement?.durationSeconds ?? null };
  }

  async savePreferences(update: UpdatePreferencesRequest): Promise<PlaybackPreferences> {
    this.calls.push({ method: "preferences", detail: JSON.stringify(update), at: this.clock.now() });
    this.savedPreferences.push(update);
    return { genreId: update.genreId ?? null, volume: update.volume ?? 0.8, muted: update.muted ?? false };
  }

  private async gate(method: ApiMethod, signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) throw domError("AbortError");
    if (!this.holding.has(method)) return;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        if (this.honorAbortWhileHeld) reject(domError("AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.held.push({
        release: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  get(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.values.set(key, value);
  }
  remove(key: string): void {
    this.values.delete(key);
  }
}

export class FakeMediaSession implements MediaSessionLike {
  metadata: unknown = null;
  playbackState: "none" | "paused" | "playing" = "none";
  readonly handlers = new Map<MediaSessionActionName, (() => void) | null>();
  /** Actions this "browser" does not support (setActionHandler throws TypeError). */
  unsupported = new Set<MediaSessionActionName>(["seekto"]);

  setActionHandler(action: MediaSessionActionName, handler: (() => void) | null): void {
    if (this.unsupported.has(action)) throw new TypeError(`${action} is not a valid MediaSessionAction`);
    this.handlers.set(action, handler);
  }
}

/** Mulberry32: small seeded PRNG for property-style tests. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
