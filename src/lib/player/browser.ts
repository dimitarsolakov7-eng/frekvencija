/**
 * Real browser dependencies for PlayerEngine. Call only in the browser (inside an effect or an
 * event handler), never during server rendering.
 */
import { createPlayerApi } from "./api-client";
import { PLAYER_STORAGE_PREFIX } from "./announcements";
import { createMemoryStorage, systemTimers } from "./runtime";
import type { EngineDeps, KeyValueStorage, MediaElementLike, MediaSessionLike, PlayerApi } from "./types";

export interface BrowserEngineDepsOptions {
  /** Defaults to createPlayerApi() against the same origin. */
  api?: PlayerApi;
  log?: EngineDeps["log"];
}

export function createBrowserEngineDeps(options: BrowserEngineDepsOptions = {}): EngineDeps {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("createBrowserEngineDeps() must run in the browser.");
  }
  return {
    api: options.api ?? createPlayerApi(),
    createMediaElement,
    timers: systemTimers,
    random: Math.random,
    storage: createSessionStorage(),
    mediaSession: getMediaSession(),
    createMediaMetadata: typeof MediaMetadata === "function" ? (init) => new MediaMetadata(init) : undefined,
    isPageVisible: () => document.visibilityState !== "hidden",
    onOnline: (callback) => {
      window.addEventListener("online", callback);
      return () => window.removeEventListener("online", callback);
    },
    onVisibilityChange: (callback) => {
      document.addEventListener("visibilitychange", callback);
      return () => document.removeEventListener("visibilitychange", callback);
    },
    log: options.log,
  };
}

/**
 * Removes every per-session player key (welcome-played flags) from sessionStorage. Call on logout,
 * after engine.destroy(), so the next person signing in on this browser hears their welcome.
 */
export function clearPlayerSessionState(): void {
  try {
    const storage = window.sessionStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PLAYER_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // sessionStorage unavailable (blocked site data / private mode): nothing was stored either.
  }
}

/**
 * Detached <audio> elements play fine and are never inserted into the document (removing a playing
 * element from the DOM pauses it). No `crossOrigin`: the signed storage URLs are not CORS-enabled
 * for media, and nothing reads the samples.
 */
function createMediaElement(): MediaElementLike {
  const el = new Audio();
  el.preload = "auto";
  return el;
}

function createSessionStorage(): KeyValueStorage {
  let storage: Storage;
  try {
    storage = window.sessionStorage;
  } catch {
    return createMemoryStorage();
  }
  return {
    get: (key) => {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        storage.setItem(key, value);
      } catch {
        // Quota exceeded / storage disabled: the welcome may repeat after a reload. Harmless.
      }
    },
    remove: (key) => {
      try {
        storage.removeItem(key);
      } catch {
        // See set().
      }
    },
  };
}

function getMediaSession(): MediaSessionLike | null {
  return "mediaSession" in navigator ? navigator.mediaSession : null;
}
