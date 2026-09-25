/**
 * Tiny per-viewer on/off preferences kept in localStorage (keyboard shortcuts, keep screen awake).
 * Shaped for useSyncExternalStore: the server snapshot is the default, so hydration never
 * mismatches, and every storage access is guarded (private mode / blocked site data).
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StorageEventSource {
  addEventListener(type: "storage", listener: (event: { key: string | null }) => void): void;
  removeEventListener(type: "storage", listener: (event: { key: string | null }) => void): void;
}

export interface FlagPreference {
  readonly key: string;
  readonly defaultValue: boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): boolean;
  getServerSnapshot(): boolean;
  set(value: boolean): void;
}

export interface FlagPreferenceOptions {
  /** Returns the backing store, or null when unavailable. Called lazily (never at import time). */
  getStorage: () => KeyValueStore | null;
  /** Where other tabs' changes are announced (window); optional. */
  getEventSource?: () => StorageEventSource | null;
}

const ON = "1";
const OFF = "0";

export function createFlagPreference(key: string, defaultValue: boolean, options: FlagPreferenceOptions): FlagPreference {
  const listeners = new Set<() => void>();
  // Remembers a value set while storage is unavailable, so the toggle still works for this page view.
  let memoryValue: boolean | null = null;
  // The source the "storage" listener is attached to while anyone is subscribed.
  let attachedSource: StorageEventSource | null = null;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const read = (): boolean => {
    let raw: string | null = null;
    try {
      raw = options.getStorage()?.getItem(key) ?? null;
    } catch {
      raw = null;
    }
    if (raw === ON) return true;
    if (raw === OFF) return false;
    return memoryValue ?? defaultValue;
  };

  const onStorage = (event: { key: string | null }) => {
    if (event.key === null || event.key === key) notify();
  };

  return {
    key,
    defaultValue,
    subscribe(listener) {
      listeners.add(listener);
      if (attachedSource === null) {
        try {
          const source = options.getEventSource?.() ?? null;
          source?.addEventListener("storage", onStorage);
          attachedSource = source;
        } catch {
          attachedSource = null;
        }
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || attachedSource === null) return;
        const source = attachedSource;
        attachedSource = null;
        try {
          source.removeEventListener("storage", onStorage);
        } catch {
          // Nothing left to clean up.
        }
      };
    },
    getSnapshot: read,
    getServerSnapshot: () => defaultValue,
    set(value) {
      memoryValue = value;
      try {
        options.getStorage()?.setItem(key, value ? ON : OFF);
      } catch {
        // Storage blocked or full: the in-memory value still applies to this page view.
      }
      notify();
    },
  };
}

function browserLocalStorage(): KeyValueStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserWindow(): StorageEventSource | null {
  return typeof window === "undefined" ? null : window;
}

const browserOptions: FlagPreferenceOptions = { getStorage: browserLocalStorage, getEventSource: browserWindow };

/** Player keyboard shortcuts (WCAG 2.1.4 requires a way to turn single-key shortcuts off). */
export const shortcutsPreference = createFlagPreference("radio-ui:keyboard-shortcuts", true, browserOptions);

/** Keep the screen awake while music plays (Screen Wake Lock API). */
export const keepAwakePreference = createFlagPreference("radio-ui:keep-screen-awake", false, browserOptions);
