import { describe, expect, it } from "vitest";
import { UPCOMING_LIMIT } from "@/lib/player/engine";
import { PlayerApiError } from "@/lib/player/types";
import { announcement, idFromSrc, setup, track, type Harness } from "./engine-harness";
import { seededRandom } from "./fakes";

/** Tracks with distinct durations, so the preview's durations are provably from the genre list. */
const genreList = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => track(`${prefix}${i + 1}`, 120 + i * 7));

const upcomingIds = (h: Harness): string[] => h.snapshot().upcoming.map((item) => item.id);

/** Invariants that hold in every state. */
function expectWellFormed(h: Harness, genreIds: ReadonlySet<string>, context: string): void {
  const snapshot = h.snapshot();
  const ids = snapshot.upcoming.map((item) => item.id);
  expect(ids.length, context).toBeLessThanOrEqual(UPCOMING_LIMIT);
  expect(new Set(ids).size, context).toBe(ids.length);
  for (const id of ids) expect(genreIds.has(id), `${context}: ${id} is not in the genre list`).toBe(true);
  if (snapshot.current?.kind === "track") expect(ids, context).not.toContain(snapshot.current.id);
  if (snapshot.status === "idle" || snapshot.status === "empty" || snapshot.status === "error") {
    expect(ids, context).toEqual([]);
  }
  // Skip applies to music only (PLAY-02/REQ-02).
  if (snapshot.current?.kind === "announcement") expect(snapshot.announcementInProgress, context).toBe(true);
  if (snapshot.announcementInProgress) expect(snapshot.canSkip, context).toBe(false);
}

describe("PlayerEngine upcoming (read-only 'coming up' preview)", () => {
  it("is empty before Start (no genre list is loaded) and without a genre", async () => {
    const h = await setup({ initialGenreId: null });
    expect(h.snapshot().upcoming).toEqual([]);
    h.engine.selectGenre("g1");
    await h.clock.advance(1_000);
    expect(h.snapshot()).toMatchObject({ status: "idle", upcoming: [] });
  });

  it("lists up to three next tracks with title, artist and duration from the genre list, excluding the current one", async () => {
    const list = genreList("t", 6);
    const h = await setup({ genres: { g1: list } });
    await h.start();

    const { upcoming, current } = h.snapshot();
    expect(upcoming).toHaveLength(UPCOMING_LIMIT);
    expect(upcoming.map((item) => item.id)).not.toContain(current?.id);
    for (const item of upcoming) {
      const source = list.find((candidate) => candidate.id === item.id);
      expect(item).toEqual({ id: source?.id, title: source?.title, artist: source?.artist, durationSeconds: source?.durationSeconds });
    }
  });

  it("matches the actual next plays across natural ends, with and without preloading, over several cycles", async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const h = await setup({ seed, genres: { g1: genreList("t", 5) } });
      await h.start();
      for (let i = 0; i < 17; i++) {
        const preview = upcomingIds(h);
        expect(preview.length).toBeGreaterThan(0);
        if ((i + seed) % 2 === 0) await h.clock.advance(6_000); // the next track gets preloaded
        expect(upcomingIds(h)).toEqual(preview); // preloading does not change the preview
        await h.finish();
        expect(h.currentId(), `seed ${seed} step ${i}`).toBe(preview[0]);
        // The rest of the preview is still ahead, in the same order.
        expect(upcomingIds(h).slice(0, preview.length - 1)).toEqual(preview.slice(1));
      }
      h.engine.destroy();
    }
  });

  it("matches the actual next track after Skip", async () => {
    for (let seed = 1; seed <= 6; seed++) {
      const h = await setup({ seed, genres: { g1: genreList("t", 7) } });
      await h.start();
      for (let i = 0; i < 12; i++) {
        if (i % 3 === 0) await h.clock.advance(6_000);
        const preview = upcomingIds(h);
        h.engine.skip();
        await h.clock.advance(500);
        expect(h.snapshot().status).toBe("playing");
        expect(h.currentId(), `seed ${seed} skip ${i}`).toBe(preview[0]);
      }
      h.engine.destroy();
    }
  });

  it("shows the track being loaded first while a transition validates it", async () => {
    const h = await setup({ genres: { g1: genreList("t", 6) } });
    await h.start();
    await h.clock.advance(6_000);
    const preview = upcomingIds(h);

    h.api.holding.add("sign");
    h.engine.skip();
    await h.clock.advance(400);
    expect(h.snapshot()).toMatchObject({ status: "loading", current: null });
    expect(upcomingIds(h)).toEqual(preview);
    // A snapshot published while the pick is being validated still lists it first.
    h.engine.setVolume(0.5);
    expect(h.snapshot().volume).toBe(0.5);
    expect(upcomingIds(h)).toEqual(preview);

    h.api.holding.delete("sign");
    h.api.releaseHeld();
    await h.clock.advance(0);
    expect(h.currentId()).toBe(preview[0]);
    expect(upcomingIds(h).slice(0, 2)).toEqual(preview.slice(1));
  });

  it("does not list announcements and stays valid across the welcome and station announcements", async () => {
    const h = await setup({
      genres: { g1: genreList("t", 6) },
      announcements: [announcement("w1", "welcome"), announcement("r1", "rotation")],
      everyN: 2,
    });
    await h.start();
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: "w1" });
    let preview = upcomingIds(h);
    expect(preview).toHaveLength(3);
    expect(preview).not.toContain("w1");

    await h.finish(); // welcome → first track
    expect(h.currentId()).toBe(preview[0]);
    for (let i = 0; i < 2; i++) {
      await h.clock.advance(6_000);
      preview = upcomingIds(h);
      await h.finish();
    }
    // Two completed tracks: the station announcement plays; the preview is still ahead of it.
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", id: "r1" });
    expect(upcomingIds(h)).not.toContain("r1");
    expect(upcomingIds(h).slice(0, preview.length)).toEqual(preview);
    await h.finish();
    expect(h.currentId()).toBe(preview[0]);
  });

  it("switching genre shows only the new genre's tracks, in the order they then play", async () => {
    const h = await setup({ genres: { g1: genreList("a", 4), g2: genreList("b", 5) } });
    await h.start();
    await h.clock.advance(6_000);
    expect(upcomingIds(h).every((id) => id.startsWith("a"))).toBe(true);

    h.engine.selectGenre("g2");
    expect(upcomingIds(h)).toEqual([]); // the old genre's queue is gone at once
    await h.clock.advance(1_000);
    expect(h.snapshot()).toMatchObject({ status: "playing", genreId: "g2" });
    const preview = upcomingIds(h);
    expect(preview).toHaveLength(3);
    expect(preview.every((id) => id.startsWith("b"))).toBe(true);
    expect(preview).not.toContain(h.currentId());

    await h.finish();
    expect(h.currentId()).toBe(preview[0]);
  });

  it("keeps the preview while paused, including after a genre change while paused", async () => {
    const h = await setup({ genres: { g1: genreList("a", 5), g2: genreList("b", 5) } });
    await h.start();
    const preview = upcomingIds(h);
    h.engine.pause();
    expect(upcomingIds(h)).toEqual(preview);

    h.engine.selectGenre("g2");
    await h.clock.advance(1_000);
    expect(h.snapshot().status).toBe("paused");
    const next = upcomingIds(h);
    expect(next).toHaveLength(3);
    expect(next.every((id) => id.startsWith("b"))).toBe(true);
    h.engine.resume();
    await h.clock.advance(0);
    await h.finish();
    expect(h.currentId()).toBe(next[0]);
  });

  it("drops tracks removed from the genre at the next list refresh and never plays them; new tracks can join", async () => {
    for (let seed = 1; seed <= 5; seed++) {
      const list = genreList("t", 6);
      const h = await setup({ seed, genres: { g1: list } });
      await h.start();
      await h.clock.advance(6_000);
      const preview = upcomingIds(h);
      const removedPreloaded = preview[0];
      const removedQueued = preview[1];
      h.api.genres.set("g1", [...list.filter((t) => t.id !== removedPreloaded && t.id !== removedQueued), track("new1", 99)]);

      await h.clock.advance(60_000); // the list is now stale: the next transition refreshes it
      await h.finish();
      // The new track may have been inserted before the next queued one.
      expect([preview[2], "new1"]).toContain(h.currentId());

      let sawNew = false;
      for (let i = 0; i < 14; i++) {
        const { upcoming } = h.snapshot();
        const ids = upcoming.map((item) => item.id);
        expect(ids).not.toContain(removedPreloaded);
        expect(ids).not.toContain(removedQueued);
        const added = upcoming.find((item) => item.id === "new1");
        if (added) expect(added).toMatchObject({ title: "Title new1", durationSeconds: 99 });
        sawNew ||= added !== undefined || h.currentId() === "new1";
        const expected = ids[0];
        await h.finish();
        expect(h.currentId()).toBe(expected);
        expect([removedPreloaded, removedQueued]).not.toContain(h.currentId());
      }
      expect(sawNew).toBe(true);
      h.engine.destroy();
    }
  });

  it("follows metadata edits from a refreshed list", async () => {
    const list = genreList("t", 5);
    const h = await setup({ genres: { g1: list } });
    await h.start();
    await h.clock.advance(6_000);
    const [first, second] = h.snapshot().upcoming;
    h.api.genres.set(
      "g1",
      list.map((t) => (t.id === second.id ? { ...t, title: "Renamed", artist: "New Artist", durationSeconds: 301 } : t)),
    );
    await h.clock.advance(60_000);
    await h.finish(); // this transition refreshes the list
    expect(h.currentId()).toBe(first.id);
    expect(h.snapshot().upcoming[0]).toEqual({ id: second.id, title: "Renamed", artist: "New Artist", durationSeconds: 301 });
  });

  it("a track that fails to play leaves the preview and never returns to it", async () => {
    const h = await setup({ genres: { g1: genreList("t", 6) } });
    await h.start();
    const failing = upcomingIds(h)[0];
    h.media.playBehavior = (el) => (idFromSrc(el.src) === failing ? "unsupported" : "play");
    await h.finish();
    expect(h.snapshot().status).toBe("playing");
    expect(h.currentId()).not.toBe(failing);
    for (let i = 0; i < 10; i++) {
      expect(upcomingIds(h)).not.toContain(failing);
      await h.finish();
      expect(h.currentId()).not.toBe(failing);
    }
  });

  it("a preload that fails drops its pick from the preview, and the next play still matches", async () => {
    const h = await setup({ genres: { g1: genreList("t", 6) } });
    await h.start();
    const preview = upcomingIds(h);
    let failOnce = true;
    h.api.failSign = (req) => {
      if (req.id !== preview[0] || !failOnce) return null;
      failOnce = false;
      return new PlayerApiError("network", "offline");
    };
    // Paused, so no position tick publishes a snapshot: the preview must update by itself.
    h.engine.pause();
    const before = h.snapshot();
    await h.clock.advance(6_000); // preload of preview[0] fails; that pick is dropped for this cycle
    expect(h.logs.some((l) => l.event === "preload.track_failed")).toBe(true);
    expect(h.snapshot()).not.toBe(before);
    const updated = upcomingIds(h);
    expect(updated[0]).toBe(preview[1]);
    h.engine.resume();
    await h.clock.advance(0);
    await h.finish();
    expect(h.currentId()).toBe(updated[0]);
  });

  it("a preloaded element that errors is dropped from the preview, and the next play still matches", async () => {
    const h = await setup({ genres: { g1: genreList("t", 6) } });
    await h.start();
    await h.clock.advance(6_000);
    const preview = upcomingIds(h);
    const current = h.playingElement();
    const preloaded = h.media.elements.find((el) => el !== current && el.src !== "");
    expect(idFromSrc(preloaded?.src ?? "")).toBe(preview[0]);

    h.engine.pause(); // no position ticks: the preview must update by itself
    preloaded?.failSource();
    await h.clock.advance(0);
    const updated = upcomingIds(h);
    h.engine.resume();
    await h.clock.advance(0);
    expect(updated[0]).toBe(preview[1]);
    await h.finish();
    expect(h.currentId()).toBe(updated[0]);
  });

  it("shows a single-track genre repeating", async () => {
    const h = await setup({ genres: { g1: [track("only", 200)] } });
    await h.start();
    expect(h.currentId()).toBe("only");
    expect(h.snapshot().upcoming).toEqual([{ id: "only", title: "Title only", artist: "Artist only", durationSeconds: 200 }]);
    await h.finish();
    expect(h.currentId()).toBe("only");
    expect(upcomingIds(h)).toEqual(["only"]);
  });

  it("shows only the other track of a two-track genre", async () => {
    const h = await setup({ genres: { g1: genreList("t", 2) } });
    await h.start();
    for (let i = 0; i < 6; i++) {
      const preview = upcomingIds(h);
      expect(preview).toHaveLength(1);
      expect(preview[0]).not.toBe(h.currentId());
      await h.finish();
      expect(h.currentId()).toBe(preview[0]);
    }
  });

  it("is empty for an empty genre and in error states, and comes back after recovery", async () => {
    const empty = await setup({ genres: { g1: [] } });
    await empty.start();
    expect(empty.snapshot()).toMatchObject({ status: "empty", upcoming: [] });

    const h = await setup({ genres: { g1: genreList("t", 3) } });
    h.media.playBehavior = () => "unsupported";
    await h.start();
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "catalogue_unavailable", upcoming: [] });
    h.media.playBehavior = () => "play";
    h.engine.retry();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
    expect(upcomingIds(h).length).toBeGreaterThan(0);

    h.api.failTracks = () => new PlayerApiError("network", "offline");
    h.engine.selectGenre("g1-other");
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "network", upcoming: [] });
  });

  it("keeps the upcoming array identity while its content is unchanged", async () => {
    const h = await setup({ genres: { g1: genreList("t", 6) } });
    await h.start();
    const first = h.snapshot().upcoming;
    await h.clock.advance(3_000); // position ticks publish new snapshots
    expect(h.snapshot().positionSeconds).toBeGreaterThan(0);
    expect(h.snapshot().upcoming).toBe(first);
    await h.clock.advance(6_000); // preloading moves a pick into a slot: same preview
    expect(h.snapshot().upcoming).toBe(first);
    h.engine.pause();
    expect(h.snapshot().upcoming).toBe(first);
    h.engine.setVolume(0.2);
    expect(h.snapshot().upcoming).toBe(first);
  });

  it("stays well-formed under rapid start/skip/genre/pause/finish spam", async () => {
    const genres = { g1: genreList("a", 4), g2: genreList("b", 5), g3: genreList("c", 3) };
    const genreIds: Record<string, ReadonlySet<string>> = Object.fromEntries(
      Object.entries(genres).map(([id, list]) => [id, new Set(list.map((t) => t.id))]),
    );
    for (let seed = 1; seed <= 10; seed++) {
      const h = await setup({
        genres,
        announcements: [announcement("w1", "welcome"), announcement("r1", "rotation")],
        everyN: 1,
        seed,
      });
      const random = seededRandom(seed * 104_729);
      const commands: Array<() => void> = [
        () => h.engine.start(),
        () => h.engine.skip(),
        () => h.engine.selectGenre("g1"),
        () => h.engine.selectGenre("g2"),
        () => h.engine.selectGenre("g3"),
        () => h.engine.pause(),
        () => h.engine.resume(),
        () => h.media.playing()?.finish(),
        () => h.media.playing()?.finish(),
      ];
      const waits = [0, 0, 5, 150, 320, 1_000, 6_000];
      for (let step = 0; step < 60; step++) {
        commands[Math.floor(random() * commands.length)]();
        const genreId = h.snapshot().genreId ?? "g1";
        expectWellFormed(h, genreIds[genreId], `seed ${seed} step ${step} (sync)`);
        await h.clock.advance(waits[Math.floor(random() * waits.length)]);
        expectWellFormed(h, genreIds[h.snapshot().genreId ?? "g1"], `seed ${seed} step ${step}`);
      }
      h.engine.destroy();
      expect(h.snapshot().upcoming).toEqual([]);
    }
  });
});
