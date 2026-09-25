/**
 * Regression tests for the announcement rules fixed after the code review
 * (docs/build-notes/review-findings.md): PLAY-02/REQ-02 (Skip applies to music only), PLAY-03
 * (rotation state survives dropped preloads), PLAY-04 (the welcome is not lost while it loads),
 * PLAY-06 (destroy() keeps the welcome flag) and the destroy option used by PLAY-01.
 */
import { describe, expect, it } from "vitest";
import { welcomeStorageKey } from "@/lib/player/announcements";
import { MAX_WELCOME_ATTEMPTS } from "@/lib/player/engine";
import { PlayerApiError } from "@/lib/player/types";
import { announcement, idFromSrc, setup, track, type Harness } from "./engine-harness";
import { MemoryStorage } from "./fakes";

const WELCOME_KEY = welcomeStorageKey("user-1", "biz-1");
const genreA = ["a1", "a2", "a3", "a4"].map((id) => track(id));
const genreB = ["b1", "b2", "b3", "b4"].map((id) => track(id));

/** Storage in which the welcome already played (tests about the rotation only). */
function welcomeDone(): MemoryStorage {
  const storage = new MemoryStorage();
  storage.set(WELCOME_KEY, "1");
  return storage;
}

const announcementSigns = (h: Harness) => h.api.signCalls.filter((call) => call.request.kind === "announcement");

describe("Skip applies to music only (PLAY-02, REQ-02)", () => {
  it("is unavailable and ignored while the welcome plays, and available again for the next song", async () => {
    const h = await setup({ announcements: [announcement("w1", "welcome"), announcement("r1", "rotation")] });
    await h.start();
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: "w1" });
    expect(h.snapshot()).toMatchObject({ status: "playing", canSkip: false, announcementInProgress: true });
    const welcomeEl = h.playingElement();
    const requests = h.api.requestCount;

    h.engine.skip();
    h.session.handlers.get("nexttrack")?.(); // headset / lock-screen "next"
    await h.clock.advance(1_000);
    expect(h.currentId()).toBe("w1");
    expect(h.playingElement()).toBe(welcomeEl);
    expect(h.api.requestCount).toBe(requests);

    await h.finish(); // the welcome plays to its end
    expect(h.storage.get(WELCOME_KEY)).toBe("1");
    expect(h.currentKind()).toBe("track");
    expect(h.snapshot()).toMatchObject({ canSkip: true, announcementInProgress: false });
    const song = h.currentId();
    h.engine.skip();
    await h.clock.advance(500);
    expect(h.currentKind()).toBe("track");
    expect(h.currentId()).not.toBe(song);
  });

  it("is ignored during a station announcement, which then plays to its end and restarts the count", async () => {
    const h = await setup({ announcements: [announcement("r1", "rotation")], everyN: 1 });
    await h.start();
    await h.finish(); // 1 completed song → the station announcement
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: "r1" });
    expect(h.snapshot()).toMatchObject({ canSkip: false, announcementInProgress: true, tracksSinceAnnouncement: 1 });

    h.engine.skip();
    await h.clock.advance(1_000);
    expect(h.currentId()).toBe("r1");
    expect(h.snapshot().tracksSinceAnnouncement).toBe(1); // not reset by a Skip

    h.engine.pause(); // Pause still freezes the announcement…
    expect(h.snapshot()).toMatchObject({ status: "paused", canSkip: false });
    h.engine.skip(); // …and Skip stays unavailable while it is paused
    expect(h.currentId()).toBe("r1");
    h.engine.resume();
    await h.clock.advance(0);

    await h.finish();
    expect(h.currentKind()).toBe("track");
    expect(h.snapshot()).toMatchObject({ canSkip: true, tracksSinceAnnouncement: 0 });
  });

  it("stays off during announcements in a single-track genre too", async () => {
    const h = await setup({ genres: { g1: [track("only")] }, announcements: [announcement("r1", "rotation")], everyN: 1 });
    await h.start();
    expect(h.currentKind()).toBe("track");
    expect(h.snapshot().canSkip).toBe(false); // skipping the only song would restart it
    await h.finish();
    expect(h.currentKind()).toBe("announcement");
    expect(h.snapshot().canSkip).toBe(false);
    h.engine.skip();
    await h.clock.advance(500);
    expect(h.currentId()).toBe("r1");
  });

  it("pressing Skip while a station announcement is loading neither re-draws nor replaces it", async () => {
    for (let seed = 1; seed <= 8; seed++) {
      const h = await setup({
        seed,
        storage: welcomeDone(),
        announcements: [announcement("r1", "rotation"), announcement("r2", "rotation")],
        everyN: 1,
      });
      await h.start(); // no preload: the transition signs the clip itself
      h.api.holding.add("sign");
      await h.finish(); // the song ended: the station announcement is being signed
      expect(h.snapshot()).toMatchObject({ status: "loading", current: null, canSkip: false, announcementInProgress: true });
      const signing = announcementSigns(h);
      expect(signing).toHaveLength(1);

      h.engine.skip();
      h.session.handlers.get("nexttrack")?.();
      await h.clock.advance(0);
      expect(announcementSigns(h)).toHaveLength(1);

      h.api.holding.delete("sign");
      h.api.releaseHeld();
      await h.clock.advance(0);
      expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: signing[0].request.id });
      h.engine.destroy();
    }
  });

  it("is already off while the lists refresh before a due announcement (the item is not chosen yet)", async () => {
    const h = await setup({ storage: welcomeDone(), announcements: [announcement("r1", "rotation")], everyN: 1 });
    await h.start();
    await h.clock.advance(61_000); // the genre list is stale: the next transition refreshes it first
    h.api.holding.add("tracks");
    await h.finish();
    const trackListCalls = h.api.calls.filter((call) => call.method === "tracks").length;
    expect(h.snapshot()).toMatchObject({ status: "loading", current: null, canSkip: false, announcementInProgress: true });

    h.engine.skip(); // would restart the transition (and its refresh) if it were allowed
    await h.clock.advance(0);
    expect(h.api.calls.filter((call) => call.method === "tracks")).toHaveLength(trackListCalls);

    h.api.holding.delete("tracks");
    h.api.releaseHeld();
    await h.clock.advance(0);
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: "r1" });
  });

  it("a song that is still loading can be skipped, and the next pick is music", async () => {
    const h = await setup({ storage: welcomeDone(), announcements: [announcement("r1", "rotation")], everyN: 2 });
    await h.start();
    h.api.holding.add("sign");
    await h.finish(); // 1 of 2 completed: a song is loading
    expect(h.snapshot()).toMatchObject({ status: "loading", canSkip: true, announcementInProgress: false });
    h.engine.skip();
    h.api.holding.delete("sign");
    h.api.releaseHeld();
    await h.clock.advance(0);
    expect(h.currentKind()).toBe("track");
    expect(h.snapshot().tracksSinceAnnouncement).toBe(1);
  });
});

describe("rotation state survives dropped preloads and superseded loads (PLAY-03)", () => {
  it("a preloaded station clip dropped by a genre change is still the next one: never the same clip twice in a row", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const h = await setup({
        seed,
        genres: { g1: genreA, g2: genreB },
        storage: welcomeDone(),
        announcements: [announcement("r1", "rotation"), announcement("r2", "rotation")],
        everyN: 1,
      });
      await h.start();
      await h.finish(); // song → first station clip
      const first = h.currentId() as string;
      expect(h.currentKind()).toBe("announcement");
      await h.finish(); // clip → song
      await h.clock.advance(6_000); // the next clip is preloaded while this song plays
      const preloaded = h.media.elements.map((el) => idFromSrc(el.src)).find((id) => id === "r1" || id === "r2");
      expect(preloaded, `seed ${seed}`).toBeDefined();
      expect(preloaded).not.toBe(first);

      h.engine.selectGenre("g2"); // drops the preload
      await h.clock.advance(1_000);
      expect(h.currentId()).toMatch(/^b/);
      await h.finish();
      expect(h.currentKind()).toBe("announcement");
      expect(h.currentId(), `seed ${seed}`).toBe(preloaded);
      h.engine.destroy();
    }
  });

  it("a station clip whose loading is superseded by a genre change stays next in line", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const h = await setup({
        seed,
        genres: { g1: genreA, g2: genreB },
        storage: welcomeDone(),
        announcements: [announcement("r1", "rotation"), announcement("r2", "rotation")],
        everyN: 1,
      });
      await h.start();
      await h.finish();
      const first = h.currentId() as string;
      await h.finish(); // clip → song (not preloaded: the transition signs the next clip)
      h.api.holding.add("sign");
      await h.finish();
      const loading = announcementSigns(h).at(-1)?.request.id;
      expect(loading).not.toBe(first);

      h.engine.selectGenre("g2"); // cancels that load
      h.api.holding.delete("sign");
      h.api.releaseHeld();
      await h.clock.advance(1_000);
      expect(h.currentId()).toMatch(/^b/);
      await h.finish();
      expect(h.currentId(), `seed ${seed}`).toBe(loading);
      h.engine.destroy();
    }
  });

  it("an unused preload is claimed by the transition (no second sign)", async () => {
    const h = await setup({ storage: welcomeDone(), announcements: [announcement("r1", "rotation"), announcement("r2", "rotation")], everyN: 1 });
    await h.start();
    await h.clock.advance(6_000);
    const preloaded = announcementSigns(h).map((call) => call.request.id);
    expect(preloaded).toHaveLength(1);
    await h.finish();
    expect(h.currentId()).toBe(preloaded[0]);
    expect(announcementSigns(h)).toHaveLength(1);
  });
});

describe("the welcome is not lost while it loads (PLAY-04)", () => {
  it("a genre change while the welcome is being signed still plays it first, once", async () => {
    const h = await setup({ genres: { g1: genreA, g2: genreB }, announcements: [announcement("w1", "welcome")] });
    h.api.holding.add("sign");
    h.engine.start();
    await h.clock.advance(0);
    expect(announcementSigns(h).map((call) => call.request.id)).toEqual(["w1"]);
    expect(h.snapshot()).toMatchObject({ status: "loading", canSkip: false, announcementInProgress: true });

    h.engine.selectGenre("g2");
    await h.clock.advance(0);
    h.api.holding.delete("sign");
    h.api.releaseHeld();
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "playing", genreId: "g2", current: { kind: "announcement", id: "w1" } });
    expect(h.storage.get(WELCOME_KEY)).toBe("1");

    await h.finish();
    for (let i = 0; i < 4; i++) {
      expect(h.currentId()).toMatch(/^b/);
      await h.finish();
    }
    expect(h.api.signsFor("w1")).toHaveLength(2); // the cancelled attempt and the one that played
  });

  it("paused, then a genre change before the welcome started: it plays on resume", async () => {
    const h = await setup({ genres: { g1: genreA, g2: genreB }, announcements: [announcement("w1", "welcome")] });
    h.engine.start();
    h.engine.pause();
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "paused", current: { kind: "announcement", id: "w1" } });
    h.engine.selectGenre("g2");
    await h.clock.advance(1_000);
    expect(h.snapshot()).toMatchObject({ status: "paused", genreId: "g2", current: { kind: "announcement", id: "w1" } });
    expect(h.storage.get(WELCOME_KEY)).toBeNull();
    h.engine.resume();
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "playing", current: { kind: "announcement", id: "w1" } });
    expect(h.storage.get(WELCOME_KEY)).toBe("1");
  });

  it("a failed request while signing the welcome plays music first, then the welcome between songs", async () => {
    const h = await setup({ announcements: [announcement("w1", "welcome")] });
    let failures = 1;
    h.api.failSign = (req) => (req.id === "w1" && failures-- > 0 ? new PlayerApiError("server", "Bad gateway", 502) : null);
    await h.start();
    expect(h.snapshot()).toMatchObject({ status: "playing", current: { kind: "track" } });
    expect(h.storage.get(WELCOME_KEY)).toBeNull();
    await h.finish();
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: "w1" });
    await h.finish();
    for (let i = 0; i < 4; i++) {
      expect(h.currentKind()).toBe("track");
      await h.finish();
    }
    expect(h.api.signsFor("w1")).toHaveLength(2);
  });

  it("an announcement list that fails once at Start does not lose the welcome", async () => {
    const h = await setup({ announcements: [announcement("w1", "welcome"), announcement("r1", "rotation")], everyN: 2 });
    let failures = 1;
    h.api.failAnnouncements = () => (failures-- > 0 ? new PlayerApiError("server", "Unavailable", 503) : null);
    await h.start();
    expect(h.currentKind()).toBe("track"); // the list is unknown: music first
    await h.finish(); // the transition loads the list: the welcome is still pending
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: "w1" });
    await h.finish();
    await h.finish();
    await h.finish(); // two completed songs after the welcome → the station announcement
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: "r1" });
    expect(h.api.signsFor("w1")).toHaveLength(1);
  });

  it("gives the welcome up after a bounded number of failed attempts", async () => {
    const h = await setup({ announcements: [announcement("w1", "welcome")] });
    h.api.failSign = (req) => (req.id === "w1" ? new PlayerApiError("server", "Bad gateway", 502) : null);
    await h.start();
    for (let i = 0; i < MAX_WELCOME_ATTEMPTS + 3; i++) {
      expect(h.currentKind()).toBe("track");
      await h.finish();
    }
    expect(h.api.signsFor("w1")).toHaveLength(MAX_WELCOME_ATTEMPTS);
    expect(h.logs.some((entry) => entry.event === "welcome.given_up")).toBe(true);
  });

  it("does not retry a welcome whose clip is gone (404)", async () => {
    const h = await setup({ announcements: [announcement("w1", "welcome")] });
    h.api.failSign = (req) => (req.id === "w1" ? new PlayerApiError("unavailable", "Gone", 404) : null);
    await h.start();
    for (let i = 0; i < 3; i++) await h.finish();
    expect(h.api.signsFor("w1")).toHaveLength(1);
  });
});

describe("destroy() and the welcome flag (PLAY-06) / pending preferences (PLAY-01)", () => {
  it("keeps the welcome flag, so a new engine in the same browser session does not replay it", async () => {
    const storage = new MemoryStorage();
    const first = await setup({ storage, announcements: [announcement("w1", "welcome")] });
    await first.start();
    expect(first.currentId()).toBe("w1");
    first.engine.destroy(); // e.g. /account → /reset-password unmounts the venue layout
    expect(storage.get(WELCOME_KEY)).toBe("1");

    const second = await setup({ storage, announcements: [announcement("w1", "welcome")] });
    await second.start();
    expect(second.currentKind()).toBe("track");
    expect(second.api.signsFor("w1")).toHaveLength(0);
  });

  it("destroy() saves pending preference changes; destroy({ savePreferences: false }) drops them", async () => {
    const saved = await setup();
    saved.engine.setVolume(0.3);
    saved.engine.destroy();
    await saved.clock.advance(2_000);
    expect(saved.api.savedPreferences).toEqual([{ volume: 0.3 }]);

    const dropped = await setup();
    dropped.engine.setVolume(0.3);
    dropped.engine.setMuted(true);
    dropped.engine.destroy({ savePreferences: false });
    await dropped.clock.advance(2_000);
    expect(dropped.api.savedPreferences).toEqual([]);
    expect(dropped.clock.pendingCount).toBe(0);
  });
});
