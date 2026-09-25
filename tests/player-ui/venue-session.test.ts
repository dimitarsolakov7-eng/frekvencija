/**
 * PLAY-01: a venue player follows sign-outs and sign-ins made in other tabs of the same browser
 * (they share one session), and the venue logout tells the other tabs. Also covers the logout's
 * destination sanitising (only same-origin paths, via safeNextPath).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { signOutOfVenue } from "@/components/player/PlayerProvider";
import {
  VENUE_SESSION_CHANNEL,
  announceVenueSignedOut,
  followVenueSession,
  parseVenueSessionMessage,
  venueSessionChange,
  type SessionChannelLike,
  type VenueSessionChange,
} from "@/components/player/venue-session";

/** BroadcastChannel stand-in: every open channel with the same name except the sender receives (asynchronously). */
class FakeBus {
  readonly channels = new Set<FakeChannel>();
  readonly posted: Array<{ name: string; data: unknown }> = [];
  open = (name: string): SessionChannelLike => new FakeChannel(this, name);
}

class FakeChannel implements SessionChannelLike {
  private readonly listeners = new Set<(event: { data: unknown }) => void>();
  closed = false;

  constructor(
    private readonly bus: FakeBus,
    readonly name: string,
  ) {
    bus.channels.add(this);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  postMessage(data: unknown): void {
    if (this.closed) throw new Error("InvalidStateError");
    this.bus.posted.push({ name: this.name, data });
    for (const channel of this.bus.channels) {
      if (channel !== this && channel.name === this.name) queueMicrotask(() => channel.deliver(data));
    }
  }

  addEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.bus.channels.delete(this);
  }

  private deliver(data: unknown): void {
    if (this.closed) return;
    for (const listener of [...this.listeners]) listener({ data });
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const VENUE_A = { userId: "user-a", businessId: "biz-a" };
const VENUE_B = { userId: "user-b", businessId: "biz-b" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("venue session messages", () => {
  it("accepts only well-formed messages", () => {
    expect(parseVenueSessionMessage({ type: "signed-out", page: "p1" })).toEqual({ type: "signed-out", page: "p1" });
    expect(parseVenueSessionMessage({ type: "venue-active", page: "p1", userId: "u", businessId: "b" })).toEqual({
      type: "venue-active",
      page: "p1",
      userId: "u",
      businessId: "b",
    });
    for (const bad of [null, "signed-out", 7, {}, { type: "signed-out" }, { type: "venue-active", page: "p1", userId: "u" }, { type: "other", page: "p" }]) {
      expect(parseVenueSessionMessage(bad)).toBeNull();
    }
  });

  it("a sign-out anywhere ends this session; another user or venue replaces it; the same identity or this page changes nothing", () => {
    const active = (identity: typeof VENUE_A, page = "other") => ({ type: "venue-active" as const, page, ...identity });
    expect(venueSessionChange(VENUE_A, { type: "signed-out", page: "other" }, "me")).toBe("signed-out");
    expect(venueSessionChange(VENUE_A, active(VENUE_B), "me")).toBe("switched");
    expect(venueSessionChange(VENUE_A, active({ userId: "user-a2", businessId: "biz-a" }), "me")).toBe("switched");
    expect(venueSessionChange(VENUE_A, active({ userId: "user-a", businessId: "biz-other" }), "me")).toBe("switched");
    expect(venueSessionChange(VENUE_A, active(VENUE_A), "me")).toBeNull();
    expect(venueSessionChange(VENUE_A, { type: "signed-out", page: "me" }, "me")).toBeNull();
    expect(venueSessionChange(VENUE_A, active(VENUE_B, "me"), "me")).toBeNull();
  });
});

describe("followVenueSession / announceVenueSignedOut", () => {
  it("stops a tab left playing when another tab signs the browser in as another venue", async () => {
    const bus = new FakeBus();
    const tab1: VenueSessionChange[] = [];
    const stop1 = followVenueSession(VENUE_A, (change) => tab1.push(change), { openChannel: bus.open, pageId: "tab-1" });
    await flush();
    expect(bus.posted.map((entry) => entry.data)).toEqual([{ type: "venue-active", page: "tab-1", ...VENUE_A }]);
    expect(bus.posted[0].name).toBe(VENUE_SESSION_CHANNEL);

    // Tab 2 signs in as venue B and opens its radio.
    const tab2: VenueSessionChange[] = [];
    const stop2 = followVenueSession(VENUE_B, (change) => tab2.push(change), { openChannel: bus.open, pageId: "tab-2" });
    await flush();
    expect(tab1).toEqual(["switched"]);
    expect(tab2).toEqual([]);

    // Only once, however many messages follow while the page reloads.
    followVenueSession(VENUE_B, () => undefined, { openChannel: bus.open, pageId: "tab-3" })();
    announceVenueSignedOut({ openChannel: bus.open, pageId: "tab-4" });
    await flush();
    expect(tab1).toEqual(["switched"]);
    expect(tab2).toEqual(["signed-out"]);
    stop1();
    stop2();
  });

  it("stops every venue tab when one of them signs out, and ignores tabs of the same venue", async () => {
    const bus = new FakeBus();
    const seen: VenueSessionChange[] = [];
    const stop = followVenueSession(VENUE_A, (change) => seen.push(change), { openChannel: bus.open, pageId: "tab-1" });
    const stopTwin = followVenueSession(VENUE_A, () => seen.push("switched"), { openChannel: bus.open, pageId: "tab-2" });
    await flush();
    expect(seen).toEqual([]); // the same venue in two tabs is not a session change

    // Tab 2 logs out: tab 1 stops; tab 2 ignores its own message (it is leaving for /login anyway).
    announceVenueSignedOut({ openChannel: bus.open, pageId: "tab-2" });
    await flush();
    expect(seen).toEqual(["signed-out"]);
    expect(bus.channels.size).toBe(2); // the announcing channel was closed again
    stop();
    stopTwin();
  });

  it("cleans up: no callback after unmount, and the channel is closed", async () => {
    const bus = new FakeBus();
    const seen: VenueSessionChange[] = [];
    const stop = followVenueSession(VENUE_A, (change) => seen.push(change), { openChannel: bus.open, pageId: "tab-1" });
    const [channel] = [...bus.channels] as FakeChannel[];
    stop();
    expect(channel.closed).toBe(true);
    expect(channel.listenerCount).toBe(0);
    announceVenueSignedOut({ openChannel: bus.open, pageId: "tab-2" });
    await flush();
    expect(seen).toEqual([]);
  });

  it("does nothing without BroadcastChannel", () => {
    const stop = followVenueSession(VENUE_A, () => {
      throw new Error("never");
    }, { openChannel: () => null });
    expect(() => stop()).not.toThrow();
    expect(() => announceVenueSignedOut({ openChannel: () => null })).not.toThrow();
  });
});

describe("signOutOfVenue", () => {
  function stubBrowser() {
    const order: string[] = [];
    const values = new Map<string, string>([
      ["radio-player:welcome:user-a:biz-a", "1"],
      ["unrelated", "kept"],
    ]);
    const sessionStorage = {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const replace = vi.fn((url: string) => void order.push(`replace ${url}`));
    vi.stubGlobal("window", { sessionStorage, location: { replace } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        order.push(`fetch ${url}`);
        return new Response(null, { status: 200 });
      }),
    );
    class RecordingChannel {
      constructor(readonly name: string) {}
      postMessage(data: unknown) {
        order.push(`post ${(data as { type: string }).type}`);
      }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", RecordingChannel);
    return { order, values, replace };
  }

  it("stops the player, clears its session keys, signs out, tells the other tabs, then leaves", async () => {
    const browser = stubBrowser();
    await signOutOfVenue(() => browser.order.push("destroy"), { destination: "/login?error=session_expired&next=%2Fradio" });
    expect(browser.order).toEqual([
      "destroy",
      "fetch /auth/signout",
      "post signed-out",
      "replace /login?error=session_expired&next=%2Fradio",
    ]);
    expect([...browser.values.keys()]).toEqual(["unrelated"]);
  });

  it("only ever lands on a same-origin path (control characters, dot segments, other sites → /login)", async () => {
    const browser = stubBrowser();
    for (const destination of ["/\t/evil.example", "//evil.example", "/\\evil.example", "https://evil.example/", "/.//evil.example", ""]) {
      await signOutOfVenue(undefined, { destination });
      expect(browser.replace).toHaveBeenLastCalledWith("/login");
    }
    await signOutOfVenue();
    expect(browser.replace).toHaveBeenLastCalledWith("/login");
  });

  it("still signs out and leaves when stopping the player or the request fails", async () => {
    const browser = stubBrowser();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await signOutOfVenue(() => {
      throw new Error("player broke");
    });
    expect(browser.order).toEqual(["post signed-out", "replace /login"]);
  });
});
