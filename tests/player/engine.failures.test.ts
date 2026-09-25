import { describe, expect, it } from "vitest";
import { PlayerApiError } from "@/lib/player/types";
import { announcement, idFromSrc, setup, track } from "./engine-harness";

const threeTracks = { g1: ["a", "b", "c"].map((id) => track(id)) };

describe("PlayerEngine failures and recovery", () => {
  it("retries a failing track with fresh URLs (bounded), excludes it and advances", async () => {
    const h = await setup({ genres: { g1: ["a", "b", "c", "d"].map((id) => track(id)) } });
    let failing: string | null = null;
    h.media.playBehavior = (el) => {
      const id = idFromSrc(el.src);
      if (failing === null && el.src.includes("/track/")) failing = id;
      return id === failing ? "unsupported" : "play";
    };
    await h.start();
    expect(failing).not.toBeNull();
    const failedId = failing as unknown as string;
    // 1 initial sign + maxLoadRetries (2) re-signs, each with a fresh URL.
    const signs = h.api.signsFor(failedId);
    expect(signs).toHaveLength(3);
    const urls = h.media.elements.flatMap((el) => el.srcHistory).filter((src) => idFromSrc(src) === failedId);
    expect(new Set(urls).size).toBe(3);

    expect(h.snapshot().status).toBe("playing");
    expect(h.currentId()).not.toBe(failedId);
    for (let i = 0; i < 6; i++) {
      await h.clock.advance(6_000);
      await h.finish();
      expect(h.currentId()).not.toBe(failedId);
    }
    expect(h.api.signsFor(failedId)).toHaveLength(3);
  });

  it("treats a play() that never settles as a load failure", async () => {
    const h = await setup({ tuning: { playTimeoutMs: 5_000, maxLoadRetries: 0 } });
    h.media.playBehavior = () => "pending";
    await h.start();
    const first = h.currentId();
    h.media.playBehavior = () => "play";
    await h.clock.advance(5_000);
    expect(h.snapshot().status).toBe("playing");
    expect(h.currentId()).not.toBe(first);
  });

  it("stops with catalogue_unavailable after min(5, pool) consecutive failures, with no further requests", async () => {
    const h = await setup({ genres: threeTracks });
    h.media.playBehavior = () => "unsupported";
    await h.start();
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "catalogue_unavailable" });
    expect(h.snapshot().message).toBeTruthy();
    expect(h.api.signCalls).toHaveLength(9); // 3 tracks × (1 + 2 retries)
    expect(h.media.active()).toHaveLength(0);
    expect(h.media.elements.every((el) => el.src === "")).toBe(true);

    const requests = h.api.requestCount;
    await h.clock.advance(300_000);
    h.goOnline();
    await h.clock.advance(10_000);
    expect(h.api.requestCount).toBe(requests);
    expect(h.snapshot().status).toBe("error");

    // Retry starts over with cleared exclusions.
    h.media.playBehavior = () => "play";
    h.engine.retry();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
  });

  it("caps consecutive failures at maxConsecutiveFailures for large pools", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const h = await setup({ genres: { g1: ids.map((id) => track(id)) } });
    h.media.playBehavior = () => "unsupported";
    await h.start();
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "catalogue_unavailable" });
    const distinct = new Set(h.api.signCalls.map((c) => c.request.id));
    expect(distinct.size).toBe(5);
  });

  it("401 ⇒ auth_expired: stops and makes no further requests", async () => {
    const h = await setup();
    await h.start();
    h.api.failSign = () => new PlayerApiError("auth", "Session expired", 401, "unauthenticated");
    await h.clock.advance(6_000); // preload sign fails quietly
    await h.finish();
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "auth_expired" });
    expect(h.snapshot().message).toMatch(/sign in/i);
    expect(h.media.active()).toHaveLength(0);
    const requests = h.api.requestCount;
    await h.clock.advance(120_000);
    expect(h.api.requestCount).toBe(requests);
  });

  it("403 business_inactive on the track list ⇒ business_inactive", async () => {
    const h = await setup();
    h.api.failTracks = () => new PlayerApiError("forbidden", "Inactive", 403, "business_inactive");
    await h.start();
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "business_inactive" });
  });

  it("403 on the track list for another reason ⇒ genre_unavailable", async () => {
    const h = await setup();
    h.api.failTracks = () => new PlayerApiError("forbidden", "No access", 403, "forbidden");
    await h.start();
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "genre_unavailable" });
  });

  it("network error ⇒ error(network) with backoff, then recovers on `online`", async () => {
    const h = await setup();
    let failures = 2;
    h.api.failTracks = () => (failures-- > 0 ? new PlayerApiError("network", "offline") : null);
    await h.start();
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "network" });
    expect(h.snapshot().message).toMatch(/retrying/i);
    expect(h.api.calls.filter((c) => c.method === "tracks")).toHaveLength(1);

    await h.clock.advance(1_999);
    expect(h.api.calls.filter((c) => c.method === "tracks")).toHaveLength(1);
    await h.clock.advance(1);
    expect(h.api.calls.filter((c) => c.method === "tracks")).toHaveLength(2); // first backoff (2 s)
    expect(h.snapshot().errorCode).toBe("network");

    h.goOnline(); // before the 5 s backoff elapses
    await h.clock.advance(0);
    expect(h.api.calls.filter((c) => c.method === "tracks")).toHaveLength(3);
    expect(h.snapshot().status).toBe("playing");
  });

  it("network retries are bounded; Retry recovers afterwards", async () => {
    const h = await setup({ tuning: { networkRetryDelaysMs: [1_000, 2_000] } });
    h.api.failTracks = () => new PlayerApiError("network", "offline");
    await h.start();
    await h.clock.advance(10_000);
    expect(h.api.calls.filter((c) => c.method === "tracks")).toHaveLength(3);
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "network" });
    expect(h.snapshot().message).toMatch(/press retry/i);
    await h.clock.advance(120_000);
    expect(h.api.calls.filter((c) => c.method === "tracks")).toHaveLength(3);

    h.api.failTracks = null;
    h.engine.retry();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
  });

  it("empty genre ⇒ empty status; another genre then plays", async () => {
    const h = await setup({ genres: { g1: [], g2: [track("b1")] } });
    await h.start();
    expect(h.snapshot()).toMatchObject({ status: "empty", errorCode: null, canSkip: false });
    expect(h.snapshot().message).toMatch(/no tracks/i);
    h.engine.selectGenre("g2");
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
  });

  it("a genre emptied mid-session ends in `empty` after the current track", async () => {
    const h = await setup();
    await h.start();
    h.api.genres.set("g1", []);
    await h.clock.advance(61_000);
    expect(h.snapshot().status).toBe("playing"); // the current track is not cut
    await h.finish();
    expect(h.snapshot()).toMatchObject({ status: "empty", errorCode: null });
    expect(h.media.active()).toHaveLength(0);
  });

  it("after a failed announcement the next item is music, not another announcement", async () => {
    const h = await setup({ announcements: [announcement("r1", "rotation"), announcement("r2", "rotation")], everyN: 1 });
    h.media.playBehavior = (el) => (el.src.includes("/announcement/") ? "unsupported" : "play");
    await h.start();
    await h.finish();
    expect(h.currentKind()).toBe("track");
    expect(h.api.signCalls.filter((c) => c.request.kind === "announcement")).toHaveLength(1);
  });

  it("a preloaded track that was disabled (removed from the list) is never played", async () => {
    const h = await setup({ genres: { g1: ["a", "b", "c", "d"].map((id) => track(id, 600)) } });
    await h.start();
    await h.clock.advance(6_000);
    const current = h.playingElement();
    const preloadedEl = h.media.elements.find((el) => el !== current && el.src !== "");
    const preloadedId = idFromSrc(preloadedEl?.src ?? "");
    expect(preloadedId).not.toBeNull();

    h.api.genres.set("g1", (h.api.genres.get("g1") ?? []).filter((t) => t.id !== preloadedId));
    await h.clock.advance(60_000); // list becomes stale → refreshed at the next transition
    await h.finish();
    expect(h.snapshot().status).toBe("playing");
    expect(h.currentId()).not.toBe(preloadedId);
    expect(preloadedEl?.src).not.toContain(`/track/${preloadedId}?`);
    for (let i = 0; i < 5; i++) {
      await h.clock.advance(6_000);
      await h.finish();
      expect(h.currentId()).not.toBe(preloadedId);
    }
  });

  it("signMedia 410 when promoting the preloaded track ⇒ picks another", async () => {
    const h = await setup({ genres: { g1: ["a", "b", "c", "d"].map((id) => track(id)) } });
    await h.start();
    await h.clock.advance(6_000);
    const current = h.playingElement();
    const preloadedId = idFromSrc(h.media.elements.find((el) => el !== current && el.src !== "")?.src ?? "");
    expect(preloadedId).not.toBeNull();
    h.api.failSign = (req) => (req.id === preloadedId ? new PlayerApiError("unavailable", "Gone", 410) : null);
    await h.finish();
    expect(h.snapshot().status).toBe("playing");
    expect(h.currentId()).not.toBe(preloadedId);
    expect(h.api.signsFor(preloadedId as string)).toHaveLength(2); // preload + re-validation only
  });

  it("keeps the preloaded URL when it still covers duration + margin", async () => {
    const h = await setup({ genres: { g1: ["a", "b", "c"].map((id) => track(id)) } });
    await h.start();
    await h.clock.advance(6_000);
    const current = h.playingElement();
    const preloadedEl = h.media.elements.find((el) => el !== current && el.src !== "");
    const preloadedSrc = preloadedEl?.src;
    const loads = preloadedEl?.srcHistory.length;
    await h.finish();
    expect(h.playingElement()).toBe(preloadedEl);
    expect(preloadedEl?.src).toBe(preloadedSrc);
    expect(preloadedEl?.srcHistory.length).toBe(loads);
  });

  it("re-signs a preloaded URL that is near expiry before starting it", async () => {
    const h = await setup({ genres: { g1: ["a", "b", "c"].map((id) => track(id, 180)) } });
    await h.start();
    const firstId = h.currentId();
    // Preload URLs live only 100 s: less than 180 s duration + 120 s margin.
    h.api.ttlFor = (req, count) => (req.id !== firstId && count === 1 ? 100 : null);
    await h.clock.advance(6_000);
    const current = h.playingElement();
    const preloadedEl = h.media.elements.find((el) => el !== current && el.src !== "");
    const shortUrl = preloadedEl?.src;
    await h.finish();
    expect(h.snapshot().status).toBe("playing");
    expect(h.playingElement()).toBe(preloadedEl);
    expect(preloadedEl?.src).not.toBe(shortUrl);
    expect(idFromSrc(preloadedEl?.src ?? "")).toBe(idFromSrc(shortUrl ?? ""));
  });

  it("re-signs on resume after a long pause when the URL would expire mid-track", async () => {
    const h = await setup({ genres: { g1: ["a", "b"].map((id) => track(id, 180)) } });
    h.api.signTtlSeconds = 400;
    await h.start();
    await h.clock.advance(20_000);
    const el = h.playingElement();
    const id = h.currentId() as string;
    h.engine.pause();
    await h.clock.advance(300_000); // 80 s of URL life left < 160 s remaining + 120 s
    const signs = h.api.signsFor(id).length;
    h.engine.resume();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
    expect(h.api.signsFor(id).length).toBe(signs + 1);
    expect(h.playingElement()).toBe(el);
    expect(el.currentTime).toBeCloseTo(20, 0);
  });

  it("mid-track network error ⇒ re-sign and resume at the same position", async () => {
    const h = await setup();
    await h.start();
    await h.clock.advance(30_000);
    const el = h.playingElement();
    const id = h.currentId() as string;
    const oldSrc = el.src;
    el.failNetwork();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
    expect(h.currentId()).toBe(id);
    expect(h.playingElement()).toBe(el);
    expect(el.src).not.toBe(oldSrc);
    expect(el.currentTime).toBeCloseTo(30, 0);
  });

  it("mid-track network error while offline ⇒ error(network), then resumes at position on `online`", async () => {
    const h = await setup();
    await h.start();
    await h.clock.advance(42_000);
    const el = h.playingElement();
    h.api.failSign = () => new PlayerApiError("network", "offline");
    el.failNetwork();
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "network" });
    h.api.failSign = null;
    h.goOnline();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
    expect(h.playingElement().currentTime).toBeCloseTo(42, 0);
  });

  it("buffering watchdog: reload once after stallReloadMs, fail the track after stallFailMs", async () => {
    const h = await setup();
    await h.start();
    await h.clock.advance(10_000);
    const el = h.playingElement();
    const id = h.currentId() as string;
    const signs = h.api.signsFor(id).length;
    // The stall persists even after reloading.
    h.media.playBehavior = (candidate) => (idFromSrc(candidate.src) === id ? "pending" : "play");
    el.stall();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("buffering");

    await h.clock.advance(14_000);
    expect(h.api.signsFor(id).length).toBe(signs);
    await h.clock.advance(2_000);
    expect(h.api.signsFor(id).length).toBe(signs + 1); // one re-sign + reload at position
    expect(h.currentId()).toBe(id);

    await h.clock.advance(30_000);
    expect(h.snapshot().status).toBe("playing");
    expect(h.currentId()).not.toBe(id);
    expect(h.api.signsFor(id).length).toBe(signs + 1);
  });

  it("buffering that recovers on its own does not reload", async () => {
    const h = await setup();
    await h.start();
    await h.clock.advance(5_000);
    const el = h.playingElement();
    const id = h.currentId() as string;
    const signs = h.api.signsFor(id).length;
    el.stall();
    await h.clock.advance(3_000);
    expect(h.snapshot().status).toBe("buffering");
    el.unstall();
    await h.clock.advance(20_000);
    expect(h.snapshot().status).toBe("playing");
    expect(h.currentId()).toBe(id);
    expect(h.api.signsFor(id)).toHaveLength(signs);
  });

  it("a frozen currentTime without `waiting` is detected as buffering", async () => {
    const h = await setup();
    await h.start();
    await h.clock.advance(3_000);
    const el = h.playingElement();
    el.freezeSilently(); // no `waiting` event
    await h.clock.advance(4_000);
    expect(h.snapshot().status).toBe("buffering");
  });
});
