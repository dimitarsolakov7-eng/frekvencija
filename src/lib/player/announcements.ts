/**
 * Decides which announcement plays and when (docs/ARCHITECTURE.md §9):
 * - a welcome announcement (placement welcome|both) once per browser session per user+business;
 * - a rotation announcement (placement rotation|both) after every N *completed* tracks, rotated
 *   with a shuffle bag so the same one never plays twice in a row (when more than one exists).
 *   The rotation only moves on when a clip is actually heard (peekRotation + markRotationStarted),
 *   so a preloaded or loading clip that is dropped stays next in line.
 * Pure logic: the engine reports what happened; nothing here touches media elements.
 */
import type { AnnouncementSummary } from "@/lib/api/contracts";
import { DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS } from "@/config/platform";
import { ShuffleBag } from "./shuffle";
import type { KeyValueStorage } from "./types";

/** Prefix of every sessionStorage key the player writes (cleared on logout). */
export const PLAYER_STORAGE_PREFIX = "radio-player:";

export const MIN_EVERY_N_TRACKS = 1;
export const MAX_EVERY_N_TRACKS = 50;

export function welcomeStorageKey(userId: string, businessId: string): string {
  return `${PLAYER_STORAGE_PREFIX}welcome:${userId}:${businessId}`;
}

export function normalizeEveryNTracks(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS;
  return Math.min(MAX_EVERY_N_TRACKS, Math.max(MIN_EVERY_N_TRACKS, Math.round(value)));
}

export interface AnnouncementSchedulerOptions {
  everyNTracks: number;
  storage: KeyValueStorage;
  /** Key marking "welcome already played in this browser session" (see welcomeStorageKey). */
  welcomeKey: string;
  random?: () => number;
}

export class AnnouncementScheduler {
  private readonly storage: KeyValueStorage;
  private readonly welcomeKey: string;
  private readonly random: () => number;
  private readonly rotation: ShuffleBag;
  private readonly byId = new Map<string, AnnouncementSummary>();
  private welcomes: AnnouncementSummary[] = [];
  private readonly failed = new Set<string>();
  private everyN: number;
  private completed = 0;

  constructor(options: AnnouncementSchedulerOptions) {
    this.storage = options.storage;
    this.welcomeKey = options.welcomeKey;
    this.random = options.random ?? Math.random;
    this.rotation = new ShuffleBag(this.random);
    this.everyN = normalizeEveryNTracks(options.everyNTracks);
  }

  /** Replace the playable list. Also forgets earlier failures (a refreshed list is re-trusted). */
  setAnnouncements(list: readonly AnnouncementSummary[]): void {
    this.byId.clear();
    for (const item of list) this.byId.set(item.id, item);
    this.failed.clear();
    this.welcomes = list.filter((a) => a.placement === "welcome" || a.placement === "both");
    this.rotation.clearExclusions();
    this.rotation.setPool(list.filter((a) => a.placement === "rotation" || a.placement === "both").map((a) => a.id));
  }

  setEveryNTracks(value: number): void {
    this.everyN = normalizeEveryNTracks(value);
  }

  get everyNTracks(): number {
    return this.everyN;
  }

  /** Completed (naturally ended) tracks since the last announcement. */
  get completedTracks(): number {
    return this.completed;
  }

  /** Whether at least one rotation announcement is currently eligible. */
  get hasRotation(): boolean {
    return this.rotation.size > 0;
  }

  /** Tracks left before the next rotation announcement, or null when none is available. */
  get tracksUntilAnnouncement(): number | null {
    return this.hasRotation ? Math.max(0, this.everyN - this.completed) : null;
  }

  /** The counter reached N (stays due while no announcement is available). */
  isDue(): boolean {
    return this.completed >= this.everyN;
  }

  /** Whether completing the current track would make an announcement due (used for preloading). */
  wouldBeDueAfterNextCompletion(): boolean {
    return this.hasRotation && this.completed + 1 >= this.everyN;
  }

  /** Only natural `ended` of a music track counts; skips and failures must not call this. */
  onTrackCompleted(): void {
    this.completed += 1;
  }

  /** An announcement played to its end: restart the count (announcements cannot be skipped). */
  onAnnouncementPlayed(): void {
    this.completed = 0;
  }

  /**
   * The rotation announcement that plays next (never the same one twice in a row when ≥ 2 exist),
   * without taking it: call markRotationStarted() once it is actually heard. Until then every call
   * returns the same clip (unless the list changes), so a preloaded or loading clip that is dropped
   * (genre change, reclaimed element, error) is still the next one instead of being skipped over.
   */
  peekRotation(): AnnouncementSummary | null {
    const [id] = this.rotation.peek(1);
    return id === undefined ? null : (this.byId.get(id) ?? null);
  }

  /** A rotation announcement started playing: the rotation moves past it. */
  markRotationStarted(id: string): void {
    this.rotation.take(id);
  }

  /** Takes the next rotation announcement at once (peekRotation + markRotationStarted). */
  nextRotation(): AnnouncementSummary | null {
    const id = this.rotation.next();
    return id === null ? null : (this.byId.get(id) ?? null);
  }

  /** Still in the current list and not failed in this session. */
  isAvailable(id: string): boolean {
    return this.byId.has(id) && !this.failed.has(id);
  }

  /** Exclude an announcement that failed to load until the list is refreshed. */
  markFailed(id: string): void {
    this.failed.add(id);
    this.rotation.exclude(id);
  }

  /** Whether takeWelcome() would offer a welcome right now (draws no randomness). */
  hasWelcome(): boolean {
    return !this.welcomePlayed() && this.welcomes.some((a) => !this.failed.has(a.id));
  }

  /** A welcome candidate if none has played in this browser session yet; does not mark it played. */
  takeWelcome(): AnnouncementSummary | null {
    if (this.welcomePlayed()) return null;
    const candidates = this.welcomes.filter((a) => !this.failed.has(a.id));
    if (candidates.length === 0) return null;
    const r = this.random();
    const index = Number.isFinite(r) && r >= 0 && r < 1 ? Math.floor(r * candidates.length) : 0;
    return candidates[index];
  }

  markWelcomePlayed(): void {
    try {
      this.storage.set(this.welcomeKey, "1");
    } catch {
      // Storage unavailable (private mode, quota): the welcome may repeat after a reload. Harmless.
    }
  }

  clearWelcome(): void {
    try {
      this.storage.remove(this.welcomeKey);
    } catch {
      // See markWelcomePlayed.
    }
  }

  private welcomePlayed(): boolean {
    try {
      return this.storage.get(this.welcomeKey) !== null;
    } catch {
      return false;
    }
  }
}
