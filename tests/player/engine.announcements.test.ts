import { describe, expect, it } from "vitest";
import { MUSIC_GAIN } from "@/config/platform";
import { welcomeStorageKey } from "@/lib/player/announcements";
import { STATION_ANNOUNCEMENT_LABEL, WELCOME_ANNOUNCEMENT_LABEL } from "@/lib/player/engine";
import { PlayerApiError } from "@/lib/player/types";
import { announcement, setup, track } from "./engine-harness";
import { MemoryStorage } from "./fakes";

describe("PlayerEngine announcements", () => {
  it("plays welcome → 4 tracks → station announcement → track 5", async () => {
    const h = await setup({ announcements: [announcement("w1", "welcome"), announcement("r1", "rotation")], everyN: 4 });
    await h.start();

    expect(h.snapshot().status).toBe("playing");
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: "w1", label: WELCOME_ANNOUNCEMENT_LABEL });
    await h.finish();

    const tracks: string[] = [];
    for (let i = 0; i < 4; i++) {
      expect(h.currentKind()).toBe("track");
      expect(h.snapshot().status).toBe("playing");
      expect(h.snapshot().tracksSinceAnnouncement).toBe(i);
      expect(h.snapshot().tracksUntilAnnouncement).toBe(4 - i);
      tracks.push(h.currentId() as string);
      await h.clock.advance(6_000); // let preloading happen, as in real playback
      await h.finish();
    }
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: "r1", label: STATION_ANNOUNCEMENT_LABEL });
    expect(h.snapshot().tracksSinceAnnouncement).toBe(4);
    await h.finish();

    expect(h.currentKind()).toBe("track");
    expect(h.snapshot().tracksSinceAnnouncement).toBe(0);
    tracks.push(h.currentId() as string);
    expect(new Set(tracks).size).toBe(5);
    expect(h.storage.get(welcomeStorageKey("user-1", "biz-1"))).toBe("1");
  });

  it("does not play the welcome again in the same browser session", async () => {
    const storage = new MemoryStorage();
    storage.set(welcomeStorageKey("user-1", "biz-1"), "1");
    const h = await setup({ storage, announcements: [announcement("w1", "welcome")] });
    await h.start();
    expect(h.currentKind()).toBe("track");
  });

  it("rotates station announcements without immediate repeats", async () => {
    const h = await setup({
      announcements: [announcement("r1", "rotation"), announcement("r2", "rotation"), announcement("r3", "both")],
      everyN: 1,
      seed: 5,
    });
    h.storage.set(welcomeStorageKey("user-1", "biz-1"), "1");
    await h.start();
    const played: string[] = [];
    for (let i = 0; i < 12; i++) {
      expect(h.currentKind()).toBe("track");
      await h.clock.advance(6_000);
      await h.finish();
      expect(h.currentKind()).toBe("announcement");
      played.push(h.currentId() as string);
      await h.finish();
    }
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
    expect(new Set(played)).toEqual(new Set(["r1", "r2", "r3"]));
  });

  it("does not count skipped tracks", async () => {
    const h = await setup({ announcements: [announcement("r1", "rotation")], everyN: 2 });
    await h.start();
    h.engine.skip();
    await h.clock.advance(500);
    expect(h.snapshot().status).toBe("playing");
    expect(h.snapshot().tracksSinceAnnouncement).toBe(0);
    await h.finish(); // completed: 1
    expect(h.snapshot().tracksSinceAnnouncement).toBe(1);
    h.engine.skip();
    await h.clock.advance(500);
    expect(h.currentKind()).toBe("track");
    expect(h.snapshot().tracksSinceAnnouncement).toBe(1);
    await h.finish(); // completed: 2 → announcement
    expect(h.currentKind()).toBe("announcement");
  });

  it("does not count tracks that failed to play", async () => {
    const h = await setup({ announcements: [announcement("r1", "rotation")], everyN: 2 });
    let failing: string | null = null;
    h.media.playBehavior = (el) => {
      if (failing === null && el.src.includes("/track/")) failing = el.src;
      return failing !== null && el.src.split("?")[0] === failing.split("?")[0] ? "unsupported" : "play";
    };
    await h.start();
    expect(h.currentKind()).toBe("track");
    expect(h.snapshot().tracksSinceAnnouncement).toBe(0);
    await h.finish();
    expect(h.snapshot().tracksSinceAnnouncement).toBe(1);
  });

  it("applies an everyN change from a refreshed announcement list", async () => {
    const h = await setup({ announcements: [announcement("r1", "rotation")], everyN: 4 });
    await h.start();
    await h.finish(); // 1 completed
    h.api.settings = { everyNTracks: 2, volume: 1 };
    await h.clock.advance(121_000); // announcement list becomes stale
    await h.finish(); // refresh at the transition: 2 completed ≥ 2
    expect(h.currentKind()).toBe("announcement");
  });

  it("keeps playing music when there are no announcements", async () => {
    const h = await setup({ announcements: [], everyN: 1 });
    await h.start();
    for (let i = 0; i < 4; i++) {
      expect(h.currentKind()).toBe("track");
      await h.finish();
    }
    expect(h.snapshot().tracksUntilAnnouncement).toBeNull();
    expect(h.snapshot().tracksSinceAnnouncement).toBe(4);
  });

  it("goes straight to music when an announcement fails to load", async () => {
    const h = await setup({ announcements: [announcement("r1", "rotation")], everyN: 1 });
    h.media.playBehavior = (el) => (el.src.includes("/announcement/") ? "unsupported" : "play");
    await h.start();
    await h.finish();
    expect(h.snapshot().status).toBe("playing");
    expect(h.currentKind()).toBe("track");
    // Not retried: one sign for the announcement, and it is excluded afterwards.
    expect(h.api.signsFor("r1")).toHaveLength(1);
    await h.finish();
    expect(h.currentKind()).toBe("track");
    expect(h.api.signsFor("r1")).toHaveLength(1);
  });

  it("goes straight to music when signing an announcement fails", async () => {
    const h = await setup({ announcements: [announcement("w1", "welcome")] });
    h.api.failSign = (req) => (req.kind === "announcement" ? new PlayerApiError("unavailable", "gone", 404) : null);
    await h.start();
    expect(h.snapshot().status).toBe("playing");
    expect(h.currentKind()).toBe("track");
  });

  it("pausing during an announcement pauses it; resume continues it and then music", async () => {
    const h = await setup({ announcements: [announcement("r1", "rotation")], everyN: 1 });
    await h.start();
    await h.finish();
    expect(h.currentKind()).toBe("announcement");
    const announcementEl = h.playingElement();
    await h.clock.advance(3_000);

    h.engine.pause();
    expect(h.snapshot().status).toBe("paused");
    expect(h.media.active()).toHaveLength(0);
    await h.clock.advance(60_000);
    expect(h.snapshot().status).toBe("paused");
    expect(h.currentKind()).toBe("announcement");

    const signsBefore = h.api.signCalls.length;
    h.engine.resume();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
    expect(h.playingElement()).toBe(announcementEl);
    expect(announcementEl.currentTime).toBeGreaterThanOrEqual(3);
    expect(h.api.signCalls.length).toBe(signsBefore);

    await h.finish();
    expect(h.currentKind()).toBe("track");
    expect(h.snapshot().tracksSinceAnnouncement).toBe(0);
  });

  it("applies MUSIC_GAIN to music and the venue's announcement volume to announcements", async () => {
    const h = await setup({ announcements: [announcement("r1", "rotation")], everyN: 1, announcementVolume: 0.5, initialVolume: 0.8 });
    await h.start();
    await h.clock.advance(1_000); // past the fade-in
    expect(h.playingElement().volume).toBeCloseTo(0.8 * MUSIC_GAIN, 5);
    await h.finish();
    await h.clock.advance(1_000);
    expect(h.currentKind()).toBe("announcement");
    expect(h.playingElement().volume).toBeCloseTo(0.8 * 0.5, 5);
    h.engine.setVolume(0.4);
    expect(h.playingElement().volume).toBeCloseTo(0.4 * 0.5, 5);
  });

  it("preloads the announcement only when it would be due", async () => {
    const h = await setup({
      genres: { g1: ["a", "b", "c", "d"].map((id) => track(id)) },
      announcements: [announcement("r1", "rotation")],
      everyN: 2,
    });
    await h.start();
    await h.clock.advance(6_000);
    expect(h.api.signsFor("r1")).toHaveLength(0); // 1 more track would not make it due
    await h.finish();
    await h.clock.advance(6_000);
    expect(h.api.signsFor("r1")).toHaveLength(1); // preloaded while track 2 plays
    expect(h.media.withSrc("/announcement/r1")).toHaveLength(1);
    await h.finish();
    expect(h.currentKind()).toBe("announcement");
    expect(h.api.signsFor("r1")).toHaveLength(1); // the preloaded URL was used
  });
});
