import { afterEach, describe, expect, it, vi } from "vitest";
import { welcomeStorageKey } from "@/lib/player/announcements";
import { clearPlayerSessionState, createBrowserEngineDeps } from "@/lib/player/browser";

class FakeStorage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function stubBrowser(options: { mediaSession?: boolean; storageThrows?: boolean } = {}) {
  const storage = new FakeStorage();
  const listeners = new Map<string, Set<() => void>>();
  const target = {
    addEventListener: (type: string, cb: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(cb);
    },
    removeEventListener: (type: string, cb: () => void) => listeners.get(type)?.delete(cb),
  };
  const windowStub = {
    ...target,
    get sessionStorage(): FakeStorage {
      if (options.storageThrows) throw new Error("SecurityError");
      return storage;
    },
  };
  const documentStub = { ...target, visibilityState: "visible" };
  class AudioStub {
    preload = "";
  }
  class MediaMetadataStub {
    constructor(readonly init: unknown) {}
  }
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("navigator", options.mediaSession ? { mediaSession: { metadata: null, playbackState: "none", setActionHandler: () => {} } } : {});
  vi.stubGlobal("Audio", AudioStub);
  vi.stubGlobal("MediaMetadata", MediaMetadataStub);
  return { storage, listeners, documentStub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser engine deps", () => {
  it("refuses to run outside the browser", () => {
    expect(() => createBrowserEngineDeps()).toThrow(/browser/);
  });

  it("creates preload=auto audio elements and wires visibility/online/storage/media session", () => {
    const { storage, listeners, documentStub } = stubBrowser({ mediaSession: true });
    const deps = createBrowserEngineDeps();
    const el = deps.createMediaElement();
    expect(el.preload).toBe("auto");
    expect(deps.mediaSession).not.toBeNull();
    expect(deps.createMediaMetadata?.({ title: "t", artist: "a", album: "s" })).toBeInstanceOf(MediaMetadata);

    expect(deps.isPageVisible?.()).toBe(true);
    documentStub.visibilityState = "hidden";
    expect(deps.isPageVisible?.()).toBe(false);

    let online = 0;
    const unsubscribe = deps.onOnline?.(() => online++);
    for (const cb of listeners.get("online") ?? []) cb();
    expect(online).toBe(1);
    unsubscribe?.();
    expect(listeners.get("online")?.size).toBe(0);

    deps.storage?.set("k", "v");
    expect(storage.getItem("k")).toBe("v");
    expect(deps.storage?.get("k")).toBe("v");
    deps.storage?.remove("k");
    expect(storage.getItem("k")).toBeNull();
  });

  it("works without Media Session and with blocked sessionStorage", () => {
    stubBrowser({ storageThrows: true });
    const deps = createBrowserEngineDeps();
    expect(deps.mediaSession).toBeNull();
    deps.storage?.set("k", "v");
    expect(deps.storage?.get("k")).toBe("v"); // in-memory fallback
    expect(() => clearPlayerSessionState()).not.toThrow();
  });

  it("clearPlayerSessionState removes only player keys", () => {
    const { storage } = stubBrowser();
    storage.setItem(welcomeStorageKey("u1", "b1"), "1");
    storage.setItem(welcomeStorageKey("u2", "b2"), "1");
    storage.setItem("other-app", "keep");
    clearPlayerSessionState();
    expect(storage.length).toBe(1);
    expect(storage.getItem("other-app")).toBe("keep");
  });
});
