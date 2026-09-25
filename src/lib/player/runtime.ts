/**
 * Environment defaults shared by the player modules. Nothing here touches `window`/`document`,
 * so it is safe to import from server-rendered client components and from tests.
 */
import type { KeyValueStorage, Timers } from "./types";

/** Real timers; `now()` is wall-clock epoch milliseconds (signed URL expiry is wall-clock too). */
export const systemTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  now: () => Date.now(),
};

/** Non-persistent storage used when no sessionStorage-backed store is injected. */
export function createMemoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
}

/** True for the rejection produced by an aborted fetch / AbortSignal (a DOMException named AbortError). */
export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}
