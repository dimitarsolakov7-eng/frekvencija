import { describe, expect, it } from "vitest";
import { MUSIC_GAIN } from "@/config/platform";
import { welcomeStorageKey } from "@/lib/player/announcements";
import { SINGLE_TRACK_NOTICE } from "@/lib/player/engine";
import { announcement, idFromSrc, setup, track } from "./engine-harness";
import { seededRandom } from "./fakes";

const genreA = ["a1", "a2", "a3", "a4"].map((id) => track(id));
const genreB = ["b1", "b2", "b3", "b4"].map((id) => track(id));
const genreC = ["c1", "c2", "c3"].map((id) => track(id));

describe("PlayerEngine control flow", () => {
  it("stays idle until Start and asks for a genre when none is selected", async () => {
    const h = await setup({ initialGenreId: null });
    expect(h.snapshot()).toMatchObject({ status: "idle", hasStarted: false, canSkip: false });
    expect(h.snapshot().message).toMatch(/choose a genre/i);
    h.engine.start();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("idle");
    expect(h.api.requestCount).toBe(0);

    h.engine.selectGenre("g1");
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "idle", genreId: "g1" });
    expect(h.api.calls.filter((c) => c.method !== "preferences")).toHaveLength(0);

    await h.start();
    expect(h.snapshot()).toMatchObject({ status: "playing", hasStarted: true });
  });

  it("unlocks idle pooled elements synchronously inside start() and resume()", async () => {
    const h = await setup();
    expect(h.media.elements).toHaveLength(3);
    h.engine.start();
    // Before any await: every element without a source got load() (WebKit per-element unlock).
    for (const el of h.media.elements) expect(el.loadCalls).toBeGreaterThanOrEqual(1);
    await h.clock.advance(0);
    expect(h.media.elements).toHaveLength(3); // never created per track
  });

  it("reports playing only after the element fired `playing`", async () => {
    const h = await setup();
    h.media.playBehavior = () => "pending";
    await h.start();
    expect(h.snapshot().status).toBe("loading");
    const el = h.media.active()[0];
    el.resolvePlay();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
    expect(h.snapshot().current?.kind).toBe("track");
  });

  it("does not treat the `pause` fired at a natural end as a user pause", async () => {
    const h = await setup();
    await h.start();
    await h.finish();
    expect(h.snapshot().status).toBe("playing");
    expect(h.logs.some((l) => l.event === "pause.external")).toBe(false);
  });

  it("an external pause (OS interruption) shows paused and Resume continues", async () => {
    const h = await setup();
    await h.start();
    const el = h.playingElement();
    el.externalPause();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("paused");
    h.engine.resume();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
    expect(h.playingElement()).toBe(el);
  });

  it("togglePlay pauses and resumes", async () => {
    const h = await setup();
    await h.start();
    h.engine.togglePlay();
    expect(h.snapshot().status).toBe("paused");
    expect(h.media.active()).toHaveLength(0);
    h.engine.togglePlay();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
  });

  it("a transition that completes while paused ends paused with the next item loaded", async () => {
    const h = await setup();
    await h.start();
    h.api.holding.add("sign");
    h.engine.skip();
    await h.clock.advance(400);
    expect(h.snapshot().status).toBe("loading");
    h.engine.pause();
    h.api.holding.delete("sign");
    h.api.releaseHeld();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("paused");
    expect(h.snapshot().current?.kind).toBe("track");
    expect(h.media.active()).toHaveLength(0);
    h.engine.resume();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
  });

  it("genre change while playing cancels preloads, plays the new genre and ignores stale events", async () => {
    const h = await setup({ genres: { g1: genreA, g2: genreB } });
    await h.start();
    await h.clock.advance(6_000); // next track preloaded
    const oldCurrent = h.playingElement();
    const preloaded = h.media.elements.filter((el) => el !== oldCurrent && el.src !== "");
    expect(preloaded).toHaveLength(1);
    const preloadLoads = preloaded[0].loadCalls;

    h.engine.selectGenre("g2");
    h.media.assertExclusive("right after selectGenre");
    expect(preloaded[0].src).toBe("");
    expect(preloaded[0].loadCalls).toBe(preloadLoads + 1); // pause + removeAttribute('src') + load()

    await h.clock.advance(1_000);
    expect(h.snapshot()).toMatchObject({ status: "playing", genreId: "g2" });
    expect(h.currentId()).toMatch(/^b/);
    expect(oldCurrent.src === "" || idFromSrc(oldCurrent.src)?.startsWith("b")).toBe(true);

    // Stale events from elements of the old session never drive the engine.
    const signsBefore = h.api.signCalls.length;
    for (const el of h.media.elements) {
      if (el !== h.playingElement()) el.forcePlaying();
    }
    await h.clock.advance(0);
    h.media.violations.length = 0; // the forced events were ours; the engine must have paused them
    h.media.assertExclusive("after stray playing events");
    expect(h.currentId()).toMatch(/^b/);
    expect(h.api.signCalls.length).toBe(signsBefore);
  });

  it("exclusivity: a stray `playing` from a preloaded element is paused immediately", async () => {
    const h = await setup();
    await h.start();
    await h.clock.advance(6_000);
    const current = h.playingElement();
    const preloaded = h.media.elements.find((el) => el !== current && el.src !== "");
    expect(preloaded).toBeDefined();
    preloaded?.forcePlaying();
    h.media.violations.length = 0; // injected by the test itself
    await h.clock.advance(0);
    expect(preloaded?.paused).toBe(true);
    expect(h.playingElement()).toBe(current);
    expect(h.snapshot().status).toBe("playing");
  });

  it("exclusivity: every other element is paused before play() is called", async () => {
    const h = await setup();
    await h.start();
    await h.clock.advance(6_000);
    const current = h.playingElement();
    const preloaded = h.media.elements.find((el) => el !== current && el.src !== "");
    h.engine.pause();
    await h.clock.advance(0);
    preloaded?.forcePlaying(); // un-paused, its `playing` event not delivered yet
    h.engine.resume(); // synchronous play() of the current element
    expect(h.media.violations).toEqual([]);
    expect(preloaded?.paused).toBe(true);
    await h.clock.advance(0);
    expect(h.playingElement()).toBe(current);
  });

  it("a second Skip while the next item is still loading skips that item too and frees its element", async () => {
    const h = await setup();
    await h.start();
    await h.clock.advance(6_000);
    const current = h.playingElement();
    const preloadedEl = h.media.elements.find((el) => el !== current && el.src !== "");
    const preloadedId = idFromSrc(preloadedEl?.src ?? "");
    expect(preloadedId).not.toBeNull();

    h.api.holding.add("sign");
    h.engine.skip();
    await h.clock.advance(400); // the first transition claimed the preloaded track and is re-validating it
    h.engine.skip();
    h.api.holding.delete("sign");
    h.api.releaseHeld();
    await h.clock.advance(400);

    expect(h.snapshot().status).toBe("playing");
    expect(h.currentId()).not.toBe(preloadedId);
    // The superseded pick was unloaded, not leaked: only the current element holds a source.
    expect(h.media.elements.filter((el) => el.src !== "")).toEqual([h.playingElement()]);
  });

  it("a late sign response from the previous genre never plays", async () => {
    const h = await setup({ genres: { g1: genreA, g2: genreB } });
    h.api.holding.add("sign");
    h.api.honorAbortWhileHeld = false; // simulate a response that arrives despite the abort
    h.engine.start();
    await h.clock.advance(0);
    expect(h.api.signCalls.some((c) => c.request.id.startsWith("a"))).toBe(true);

    h.engine.selectGenre("g2");
    await h.clock.advance(0);
    h.api.holding.delete("sign");
    h.api.releaseHeld();
    await h.clock.advance(0);

    expect(h.media.elements.some((el) => el.srcHistory.some((src) => src.includes("/track/a")))).toBe(false);
    expect(h.snapshot()).toMatchObject({ status: "playing", genreId: "g2" });
    expect(h.currentId()).toMatch(/^b/);
  });

  it("a late play() resolution from the previous genre is paused immediately", async () => {
    const h = await setup({ genres: { g1: genreA, g2: genreB } });
    h.media.playBehavior = (el) => (el.src.includes("/track/a") ? "pending" : "play");
    await h.start();
    const oldEl = h.media.active()[0];
    expect(h.snapshot().status).toBe("loading");

    h.engine.selectGenre("g2");
    await h.clock.advance(0);
    expect(h.currentId()).toMatch(/^b/);
    const newEl = h.playingElement();
    expect(idFromSrc(newEl.src)).toMatch(/^b/);
    // The old pending play() was rejected (AbortError) by the unload; nothing from g1 may resurface,
    // including after the old play timeout would have fired.
    expect(oldEl === newEl || oldEl.src === "").toBe(true);
    await h.clock.advance(20_000);
    expect(h.media.active()).toEqual([newEl]);
    expect(h.snapshot()).toMatchObject({ status: "playing", genreId: "g2" });
  });

  it("genre change while paused stays paused (and loads the new genre)", async () => {
    const h = await setup({ genres: { g1: genreA, g2: genreB } });
    await h.start();
    h.engine.pause();
    h.engine.selectGenre("g2");
    await h.clock.advance(1_000);
    expect(h.snapshot()).toMatchObject({ status: "paused", genreId: "g2" });
    expect(h.currentId()).toMatch(/^b/);
    expect(h.media.active()).toHaveLength(0);
    h.engine.resume();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
    expect(h.currentId()).toMatch(/^b/);
  });

  it("genre change before Start only remembers the genre", async () => {
    const h = await setup({ genres: { g1: genreA, g2: genreB } });
    h.engine.selectGenre("g2");
    await h.clock.advance(2_000);
    expect(h.snapshot()).toMatchObject({ status: "idle", genreId: "g2" });
    expect(h.api.calls.filter((c) => c.method === "tracks")).toHaveLength(0);
    expect(h.api.savedPreferences).toEqual([{ genreId: "g2" }]);
  });

  it("rapid start/skip/genre/pause spam never overlaps audio and never gets stuck", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const h = await setup({
        genres: { g1: genreA, g2: genreB, g3: genreC },
        announcements: [announcement("w1", "welcome"), announcement("r1", "rotation")],
        everyN: 1,
        seed,
      });
      const random = seededRandom(seed * 7919);
      const commands: Array<() => void> = [
        () => h.engine.start(),
        () => h.engine.skip(),
        () => h.engine.skip(),
        () => h.engine.selectGenre("g1"),
        () => h.engine.selectGenre("g2"),
        () => h.engine.selectGenre("g3"),
        () => h.engine.pause(),
        () => h.engine.resume(),
        () => h.engine.togglePlay(),
        () => h.media.playing()?.finish(),
      ];
      const waits = [0, 0, 5, 50, 150, 320, 1_000, 6_000];
      for (let step = 0; step < 60; step++) {
        const before = h.snapshot().current;
        const command = Math.floor(random() * commands.length);
        commands[command]();
        h.media.assertExclusive(`seed ${seed} step ${step} (sync)`);
        // Skip applies to music only: it never moves off an announcement.
        if ((command === 1 || command === 2) && before?.kind === "announcement") expect(h.snapshot().current).toBe(before);
        await h.clock.advance(waits[Math.floor(random() * waits.length)]);
        h.media.assertExclusive(`seed ${seed} step ${step}`);
      }
      h.engine.resume();
      await h.clock.advance(2_000);
      expect(h.snapshot().status).toBe("playing");
      expect(h.media.active()).toHaveLength(1);
      expect(h.media.playing()).not.toBeNull();
      expect(h.snapshot().current).not.toBeNull();
      expect(h.media.violations).toEqual([]);
      h.engine.destroy();
    }
  });

  it("NotAllowedError ⇒ blocked; resume() from a gesture plays", async () => {
    const h = await setup();
    h.media.playBehavior = () => "block";
    await h.start();
    expect(h.snapshot().status).toBe("blocked");
    expect(h.snapshot().message).toMatch(/blocked/i);
    expect(h.media.active()).toHaveLength(0);

    h.media.playBehavior = () => "play";
    h.engine.resume();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
  });

  it("the Start button also recovers from blocked", async () => {
    const h = await setup();
    h.media.playBehavior = () => "block";
    await h.start();
    h.media.playBehavior = () => "play";
    h.engine.start();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
  });

  it("single-track genre shows a notice, repeats the track and disables Skip", async () => {
    const h = await setup({ genres: { g1: [track("only")] } });
    await h.start();
    expect(h.snapshot()).toMatchObject({ status: "playing", notice: SINGLE_TRACK_NOTICE, canSkip: false });
    await h.clock.advance(6_000);
    await h.finish();
    expect(h.currentId()).toBe("only");
    expect(h.snapshot().status).toBe("playing");
    await h.finish();
    expect(h.currentId()).toBe("only");
  });

  it("fades in from ≥0.02 of the target and reaches master × gain", async () => {
    const h = await setup({ initialVolume: 1 });
    h.engine.start();
    await h.clock.advance(0);
    const el = h.playingElement();
    expect(el.volume).toBeGreaterThan(0);
    expect(el.volume).toBeLessThan(MUSIC_GAIN);
    expect(el.volume).toBeGreaterThanOrEqual(0.02 * MUSIC_GAIN - 1e-9);
    await h.clock.advance(300);
    expect(el.volume).toBeCloseTo(MUSIC_GAIN, 5);
  });

  it("skips fades when the page is hidden", async () => {
    const h = await setup({ initialVolume: 1 });
    h.visibility.visible = false;
    h.engine.start();
    await h.clock.advance(0);
    expect(h.playingElement().volume).toBeCloseTo(MUSIC_GAIN, 5);
  });

  it("fades out on skip, then the next item starts", async () => {
    const h = await setup({ initialVolume: 1 });
    await h.start();
    await h.clock.advance(1_000);
    const first = h.playingElement();
    h.engine.skip();
    await h.clock.advance(100);
    expect(first.paused).toBe(false);
    expect(first.volume).toBeLessThan(MUSIC_GAIN);
    await h.clock.advance(400);
    expect(first.paused).toBe(true);
    expect(h.snapshot().status).toBe("playing");
    expect(h.playingElement()).not.toBe(first);
  });

  it("detects read-only volume (iOS) and disables volume control and fades", async () => {
    const h = await setup({ volumeMode: "readonly" });
    expect(h.snapshot().volumeControllable).toBe(false);
    await h.start();
    expect(h.snapshot().status).toBe("playing");
    expect(h.playingElement().volume).toBe(1);
  });

  it("mute applies to every pooled element and is persisted", async () => {
    const h = await setup();
    await h.start();
    h.engine.setMuted(true);
    expect(h.media.elements.every((el) => el.muted)).toBe(true);
    expect(h.snapshot().muted).toBe(true);
    h.engine.setVolume(0.3);
    await h.clock.advance(1_500);
    expect(h.api.savedPreferences).toContainEqual({ muted: true, volume: 0.3 });
  });

  it("wires Media Session handlers, metadata and playback state", async () => {
    const h = await setup();
    expect(h.session.handlers.get("play")).toBeTypeOf("function");
    expect(h.session.handlers.get("pause")).toBeTypeOf("function");
    expect(h.session.handlers.get("nexttrack")).toBeTypeOf("function");
    expect(h.session.handlers.get("previoustrack")).toBeNull();
    expect(h.session.handlers.has("seekto")).toBe(false); // unsupported: threw, was caught

    await h.start();
    expect(h.session.playbackState).toBe("playing");
    expect(h.session.metadata).toMatchObject({ title: `Title ${h.currentId()}`, album: "EmeraldBar Radio" });

    h.session.handlers.get("pause")?.();
    expect(h.snapshot().status).toBe("paused");
    expect(h.session.playbackState).toBe("paused");
    h.session.handlers.get("play")?.();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
    const before = h.currentId();
    h.session.handlers.get("nexttrack")?.();
    await h.clock.advance(500);
    expect(h.currentId()).not.toBe(before);
  });

  it("keeps the snapshot identity stable until something changes", async () => {
    const h = await setup();
    let notifications = 0;
    const unsubscribe = h.engine.subscribe(() => notifications++);
    const first = h.engine.getSnapshot();
    expect(h.engine.getSnapshot()).toBe(first);
    h.engine.setVolume(first.volume);
    h.engine.setMuted(first.muted);
    expect(h.engine.getSnapshot()).toBe(first);
    expect(notifications).toBe(0);

    await h.start();
    h.engine.pause();
    const paused = h.engine.getSnapshot();
    const count = notifications;
    h.engine.pause();
    await h.clock.advance(5_000);
    expect(h.engine.getSnapshot()).toBe(paused);
    expect(notifications).toBe(count);
    unsubscribe();
  });

  it("updates position about once per second while playing", async () => {
    const h = await setup();
    await h.start();
    const seen: number[] = [];
    h.engine.subscribe(() => seen.push(h.engine.getSnapshot().positionSeconds));
    await h.clock.advance(5_000);
    const positions = [...new Set(seen)];
    expect(positions).toEqual([1, 2, 3, 4, 5]);
    expect(h.snapshot().positionSeconds).toBe(5);
  });

  it("destroy() stops everything, releases elements, keeps the welcome flag and ignores later events", async () => {
    const h = await setup({ announcements: [announcement("w1", "welcome")] });
    await h.start();
    await h.finish();
    await h.clock.advance(6_000);
    expect(h.storage.get(welcomeStorageKey("user-1", "biz-1"))).toBe("1");

    h.engine.destroy();
    expect(h.snapshot().status).toBe("idle");
    for (const el of h.media.elements) {
      expect(el.paused).toBe(true);
      expect(el.src).toBe("");
      expect(el.listenerCount).toBe(0);
    }
    expect(h.session.metadata).toBeNull();
    expect(h.session.playbackState).toBe("none");
    expect(h.session.handlers.get("play")).toBeNull();
    // PLAY-06: an unmount is not a logout (logout clears it with clearPlayerSessionState()).
    expect(h.storage.get(welcomeStorageKey("user-1", "biz-1"))).toBe("1");

    const requests = h.api.requestCount;
    for (const el of h.media.elements) {
      el.forcePlaying();
      el.finish();
    }
    h.engine.start();
    h.engine.skip();
    h.engine.selectGenre("g1");
    h.goOnline();
    await h.clock.advance(120_000);
    expect(h.api.requestCount).toBe(requests);
    expect(h.clock.pendingCount).toBe(0);
    expect(() => h.engine.destroy()).not.toThrow();
  });
});
