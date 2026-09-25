import { describe, expect, it, vi } from "vitest";
import { PlayerEngineStore } from "@/components/player/engine-store";
import { createFlagPreference, type KeyValueStore, type StorageEventSource } from "@/components/player/local-preference";
import { createIdleSnapshot } from "@/components/player/player-view";
import type { PlayerEngineApi, PlayerSnapshot } from "@/lib/player/types";

function fakeEngine(initial: PlayerSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const engine = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    togglePlay: vi.fn(),
    skip: vi.fn(),
    selectGenre: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    retry: vi.fn(),
    destroy: vi.fn(),
  } satisfies PlayerEngineApi;
  return {
    engine,
    listenerCount: () => listeners.size,
    publish(next: Partial<PlayerSnapshot>) {
      snapshot = { ...snapshot, ...next };
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("PlayerEngineStore", () => {
  const idle = createIdleSnapshot({ genreId: "g1", volume: 0.8, muted: false });

  it("serves the idle snapshot (same object) until an engine is attached", () => {
    const store = new PlayerEngineStore(idle);
    expect(store.getSnapshot()).toBe(idle);
    expect(store.getServerSnapshot()).toBe(idle);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(store.hasEngine).toBe(false);
    // Commands are safe no-ops without an engine.
    expect(() => store.commands.start()).not.toThrow();
  });

  it("forwards engine snapshots and notifies subscribers on attach, change and detach", () => {
    const store = new PlayerEngineStore(idle);
    const fake = fakeEngine({ ...idle, status: "idle" });
    const listener = vi.fn();
    store.subscribe(listener);

    store.attach(fake.engine);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(fake.engine.getSnapshot());

    fake.publish({ status: "playing", hasStarted: true });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().status).toBe("playing");

    store.detach(fake.engine);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot()).toBe(idle);
    expect(fake.listenerCount()).toBe(0);
    expect(fake.engine.destroy).not.toHaveBeenCalled();
  });

  it("calls the attached engine synchronously from its stable command functions", () => {
    const store = new PlayerEngineStore(idle);
    const commands = store.commands;
    const fake = fakeEngine(idle);
    store.attach(fake.engine);
    expect(store.commands).toBe(commands);

    commands.start();
    commands.pause();
    commands.resume();
    commands.togglePlay();
    commands.skip();
    commands.selectGenre("g2");
    commands.setVolume(0.3);
    commands.setMuted(true);
    commands.retry();
    expect(fake.engine.start).toHaveBeenCalledTimes(1);
    expect(fake.engine.pause).toHaveBeenCalledTimes(1);
    expect(fake.engine.resume).toHaveBeenCalledTimes(1);
    expect(fake.engine.togglePlay).toHaveBeenCalledTimes(1);
    expect(fake.engine.skip).toHaveBeenCalledTimes(1);
    expect(fake.engine.selectGenre).toHaveBeenCalledWith("g2");
    expect(fake.engine.setVolume).toHaveBeenCalledWith(0.3);
    expect(fake.engine.setMuted).toHaveBeenCalledWith(true);
    expect(fake.engine.retry).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale detach (Strict Mode re-mount attaches a second engine first)", () => {
    const store = new PlayerEngineStore(idle);
    const first = fakeEngine(idle);
    const second = fakeEngine({ ...idle, volume: 0.1 });
    store.attach(first.engine);
    store.attach(second.engine);
    expect(first.listenerCount()).toBe(0);
    store.detach(first.engine);
    expect(store.getSnapshot()).toBe(second.engine.getSnapshot());
  });

  it("destroyEngine() stops and releases the current engine once", () => {
    const store = new PlayerEngineStore(idle);
    const fake = fakeEngine(idle);
    store.attach(fake.engine);
    store.commands.destroy();
    store.destroyEngine();
    expect(fake.engine.destroy).toHaveBeenCalledTimes(1);
    expect(store.hasEngine).toBe(false);
    expect(store.getSnapshot()).toBe(idle);
  });

  it("forwards the destroy options (a session change must not save preferences into another account)", () => {
    const store = new PlayerEngineStore(idle);
    const fake = fakeEngine(idle);
    store.attach(fake.engine);
    store.destroyEngine({ savePreferences: false });
    expect(fake.engine.destroy).toHaveBeenCalledWith({ savePreferences: false });
  });
});

function memoryStorage(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function eventSource() {
  const listeners = new Set<(event: { key: string | null }) => void>();
  const source: StorageEventSource = {
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  };
  return { source, listeners, fire: (key: string | null) => listeners.forEach((listener) => listener({ key })) };
}

describe("createFlagPreference", () => {
  it("defaults on the server and when nothing is stored", () => {
    const storage = memoryStorage();
    const pref = createFlagPreference("k", true, { getStorage: () => storage });
    expect(pref.getServerSnapshot()).toBe(true);
    expect(pref.getSnapshot()).toBe(true);
  });

  it("persists changes and notifies subscribers", () => {
    const storage = memoryStorage();
    const pref = createFlagPreference("k", true, { getStorage: () => storage });
    const listener = vi.fn();
    pref.subscribe(listener);
    pref.set(false);
    expect(storage.data.get("k")).toBe("0");
    expect(pref.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    pref.set(true);
    expect(storage.data.get("k")).toBe("1");
    expect(pref.getSnapshot()).toBe(true);
  });

  it("still works for this page view when storage throws", () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    const pref = createFlagPreference("k", false, { getStorage: () => broken });
    expect(pref.getSnapshot()).toBe(false);
    pref.set(true);
    expect(pref.getSnapshot()).toBe(true);
  });

  it("follows other tabs via the storage event and detaches when the last subscriber leaves", () => {
    const storage = memoryStorage();
    const events = eventSource();
    const pref = createFlagPreference("k", true, { getStorage: () => storage, getEventSource: () => events.source });
    const a = vi.fn();
    const b = vi.fn();
    const offA = pref.subscribe(a);
    const offB = pref.subscribe(b);
    expect(events.listeners.size).toBe(1);

    storage.data.set("k", "0");
    events.fire("other-key");
    expect(a).not.toHaveBeenCalled();
    events.fire("k");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(pref.getSnapshot()).toBe(false);

    offA();
    expect(events.listeners.size).toBe(1);
    offB();
    expect(events.listeners.size).toBe(0);
  });

  it("ignores unexpected stored values", () => {
    const storage = memoryStorage();
    storage.data.set("k", "yes");
    const pref = createFlagPreference("k", false, { getStorage: () => storage });
    expect(pref.getSnapshot()).toBe(false);
  });
});
