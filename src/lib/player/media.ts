/**
 * Low-level media element helpers (docs/research/browser-audio.md §11), written against
 * MediaElementLike + injected Timers so they run unchanged under test fakes.
 */
import { clamp01 } from "./runtime";
import type { MediaElementLike, Timers } from "./types";

/** HTMLMediaElement.NETWORK_EMPTY (no resource selected). */
export const NETWORK_EMPTY = 0;
/** HTMLMediaElement.HAVE_FUTURE_DATA. */
export const HAVE_FUTURE_DATA = 3;

export type PlayOutcome =
  | { kind: "playing" }
  | { kind: "blocked" } // NotAllowedError: needs a user gesture (autoplay policy)
  | { kind: "superseded" } // AbortError: interrupted by pause()/load()/src change/UA pause
  | { kind: "unsupported" } // NotSupportedError: source failed (4xx/expired URL/CORS/bad file)
  | { kind: "timeout" } // promise still pending (no src, or never reached playable)
  | { kind: "failed"; error: unknown };

/** Classify a play() rejection by DOMException name only (messages differ per browser). */
export function classifyPlayError(error: unknown): PlayOutcome {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  switch (name) {
    case "NotAllowedError":
      return { kind: "blocked" };
    case "AbortError":
      return { kind: "superseded" };
    case "NotSupportedError":
      return { kind: "unsupported" };
    default:
      return { kind: "failed", error };
  }
}

/**
 * Calls el.play() synchronously (an async function runs synchronously up to its first await), so
 * calling it inside a click/keydown handler keeps the user gesture. Never throws. The caller must
 * ignore late settles via its own generation/token checks.
 */
export async function safePlay(el: MediaElementLike, timers: Timers, timeoutMs: number): Promise<PlayOutcome> {
  let timer: unknown = null;
  try {
    const played = el.play().then((): PlayOutcome => ({ kind: "playing" }), classifyPlayError);
    const timedOut = new Promise<PlayOutcome>((resolve) => {
      timer = timers.setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    });
    return await Promise.race([played, timedOut]);
  } catch (error) {
    // play() threw synchronously (very old engines) instead of returning a rejected promise.
    return classifyPlayError(error);
  } finally {
    if (timer !== null) timers.clearTimeout(timer);
  }
}

/** Cancel any in-flight download and release the decoder. Never `el.src = ''` (fires error code 4). */
export function unloadMedia(el: MediaElementLike): void {
  el.pause();
  el.removeAttribute("src");
  el.load();
}

/** Point the element at a (fresh) URL and start from `position` seconds. Follow with safePlay(). */
export function reloadAt(el: MediaElementLike, url: string, position: number): void {
  el.src = url; // load algorithm: paused = true, pending play() promises reject with AbortError
  if (Number.isFinite(position) && position > 0) {
    // With readyState HAVE_NOTHING this sets the default playback start position.
    el.currentTime = position;
  }
}

export type MediaFailure = "aborted" | "network" | "decode" | "source" | "unknown";

export function classifyMediaError(error: { code: number } | null): MediaFailure | null {
  if (!error) return null;
  switch (error.code) {
    case 1:
      return "aborted";
    case 2:
      return "network"; // failed after metadata, e.g. an expired signed URL on a later Range request
    case 3:
      return "decode";
    case 4:
      return "source"; // failed before metadata: 4xx/expired URL/CORS/unsupported file
    default:
      return "unknown";
  }
}

/**
 * Element volume is ignored on iPhone: WebKit reverts the assignment in a queued task, so a
 * synchronous read-back lies. Probe an idle element asynchronously and restore its volume.
 */
export async function detectVolumeWritable(el: MediaElementLike, timers: Timers): Promise<boolean> {
  const original = el.volume;
  const probe = original === 0.5 ? 0.25 : 0.5;
  try {
    el.volume = probe;
  } catch {
    return false;
  }
  if (el.volume !== probe) return false;
  await new Promise<void>((resolve) => timers.setTimeout(resolve, 0));
  await new Promise<void>((resolve) => timers.setTimeout(resolve, 0));
  const writable = el.volume === probe;
  try {
    el.volume = original;
  } catch {
    // Restoring is best effort; the engine re-applies volumes after detection.
  }
  return writable;
}

export interface RampOptions {
  from: number;
  to: number;
  durationMs: number;
  timers: Timers;
  /** Called with each intermediate factor, and always with `to` at the end (unless aborted). */
  apply: (value: number) => void;
  /** When true at the start or at any step, jump straight to the target (hidden tab). */
  isHidden?: () => boolean;
  signal?: AbortSignal;
  stepMs?: number;
}

/**
 * Linear ramp driven by wall-clock time: each step computes progress from `timers.now()`, so a
 * throttled timer (hidden tab) simply finishes on its next tick. Resolves when done or aborted
 * (on abort the value is left where it is).
 */
export function rampValue(options: RampOptions): Promise<void> {
  const { durationMs, timers, apply, isHidden, signal } = options;
  const from = clamp01(options.from);
  const to = clamp01(options.to);
  const stepMs = options.stepMs ?? 20;
  if (signal?.aborted) return Promise.resolve();
  if (durationMs <= 0 || from === to || isHidden?.()) {
    apply(to);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const startedAt = timers.now();
    let handle: unknown = null;
    const finish = () => {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const step = () => {
      handle = null;
      if (signal?.aborted) return finish();
      const progress = Math.min(1, (timers.now() - startedAt) / durationMs);
      if (progress >= 1 || isHidden?.()) {
        apply(to);
        return finish();
      }
      apply(from + (to - from) * progress);
      handle = timers.setTimeout(step, stepMs);
    };
    signal?.addEventListener("abort", finish, { once: true });
    handle = timers.setTimeout(step, stepMs);
  });
}
