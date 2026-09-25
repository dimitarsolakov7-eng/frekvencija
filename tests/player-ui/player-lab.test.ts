import { describe, expect, it, vi } from "vitest";
import { LabFaultStore, NO_LAB_FAULTS, createLabPlayerApi, labAudioUrl } from "@/app/dev/player-lab/lab-api";
import {
  LAB_MISSING_GENRE_ID,
  buildLabBootstrap,
  buildLabCatalog,
  firstPlayableGenreId,
  labGenreCards,
  type LabManifestEntry,
} from "@/app/dev/player-lab/lab-catalog";
import { LabLogStore, formatLogDetail } from "@/app/dev/player-lab/lab-log";
import { loadDemoManifest } from "@/app/api/dev/_lib/demo-manifest";
import { PlayerApiError } from "@/lib/player/types";

const ENTRIES: LabManifestEntry[] = [
  { kind: "track", id: "loop-1", title: "Loop 1", artist: "Test Signal", durationSeconds: 30, genre: "house" },
  { kind: "track", id: "loop-2", title: "Loop 2", artist: "Test Signal", durationSeconds: 25, genre: "house" },
  { kind: "track", id: "loop-3", title: "Loop 3", artist: "Test Signal", durationSeconds: 20, genre: "surf-rock" },
  { kind: "announcement", id: "eb-welcome", durationSeconds: 4, business: "emeraldbar", placement: "welcome", text: "Welcome" },
  { kind: "announcement", id: "eb-station", durationSeconds: 5, business: "emeraldbar", placement: "rotation", text: "Station" },
  { kind: "announcement", id: "ha-both", durationSeconds: 6, business: "hotel-aurora", placement: "both", text: "Hello" },
];

const catalog = buildLabCatalog("Synthetic audio.", ENTRIES);

async function expectApiError(promise: Promise<unknown>, kind: PlayerApiError["kind"], status: number | null) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(PlayerApiError);
  expect(error).toMatchObject({ kind, status });
}

describe("buildLabCatalog", () => {
  it("groups tracks by genre in display order, keeps the empty demo genre and appends unknown genres", () => {
    const ids = catalog.genres.map((genre) => genre.id);
    expect(ids.slice(0, 7)).toEqual(["house", "deep-house", "lounge", "jazz", "balkan-hits", "chillout", "pop"]);
    expect(ids.at(-1)).toBe("surf-rock");
    expect(catalog.genres.find((genre) => genre.id === "surf-rock")?.name).toBe("Surf Rock");
    expect(catalog.genres.find((genre) => genre.id === "house")?.tracks.map((track) => track.id)).toEqual(["loop-1", "loop-2"]);
    expect(catalog.genres.find((genre) => genre.id === "pop")?.tracks).toEqual([]);
  });

  it("offers both demo venues with their own announcements", () => {
    expect(catalog.businesses.map((business) => business.name)).toEqual(["EmeraldBar", "Hotel Aurora"]);
    expect(catalog.businesses[0]).toMatchObject({ stationName: "EmeraldBar Radio" });
    expect(catalog.businesses[0].announcements.map((a) => a.id)).toEqual(["eb-welcome", "eb-station"]);
    expect(catalog.businesses[1].announcements.map((a) => a.id)).toEqual(["ha-both"]);
  });

  it("adds a removed genre card and finds the first playable genre", () => {
    const cards = labGenreCards(catalog);
    expect(cards.at(-1)).toMatchObject({ id: LAB_MISSING_GENRE_ID, trackCount: 1 });
    expect(cards.find((card) => card.id === "pop")?.trackCount).toBe(0);
    expect(firstPlayableGenreId(catalog)).toBe("house");
    expect(firstPlayableGenreId(buildLabCatalog("x", []))).toBeNull();
  });

  it("gives every genre card the full PlayerGenre shape (no uploaded covers in the lab)", () => {
    for (const card of labGenreCards(catalog)) expect(card.coverUrl).toBeNull();
    expect(catalog.businesses.map((business) => business.type)).toEqual(["bar", "hotel"]);
  });

  it("builds the bootstrap the real venue screens render from, with the venue's own clips and wording", () => {
    const bootstrap = buildLabBootstrap(catalog, { businessKey: "hotel-aurora", everyNTracks: 3 });
    expect(bootstrap.business).toMatchObject({
      id: "lab-hotel-aurora",
      name: "Hotel Aurora",
      stationName: "Hotel Aurora Radio",
      type: "hotel",
      logoUrl: null,
      announcementEveryNTracks: 3,
      announcementVolume: 1,
    });
    expect(bootstrap.announcements).toEqual([{ id: "ha-both", placement: "both", durationSeconds: 6, text: "Hello" }]);
    expect(bootstrap.announcementCounts).toEqual({ welcome: 1, rotation: 1 });
    expect(bootstrap.genres).toEqual(labGenreCards(catalog));
    expect(bootstrap.preferences).toEqual({ genreId: "house", volume: 0.8, muted: false });
    expect(bootstrap.support).toEqual({ email: null, phone: null });
    // An unknown key falls back to the first demo venue.
    expect(buildLabBootstrap(catalog, { businessKey: "nope", everyNTracks: 2 }).business.name).toBe("EmeraldBar");
  });

  it("builds from the committed demo manifest", async () => {
    const manifest = await loadDemoManifest();
    const real = buildLabCatalog(manifest.notice, manifest.entries);
    expect(real.genres.some((genre) => genre.tracks.length > 0)).toBe(true);
    expect(real.businesses.every((business) => business.announcements.length > 0)).toBe(true);
  });
});

describe("createLabPlayerApi", () => {
  const make = (faults = new LabFaultStore(), log = vi.fn()) => ({
    faults,
    log,
    api: createLabPlayerApi({ catalog, businessKey: "emeraldbar", everyNTracks: 2, faults, latencyMs: 0, now: () => 1_000_000, log }),
  });

  it("lists genre tracks and 404s an unknown genre", async () => {
    const { api } = make();
    const response = await api.getGenreTracks("house");
    expect(response.tracks.map((track) => track.id)).toEqual(["loop-1", "loop-2"]);
    await expectApiError(api.getGenreTracks(LAB_MISSING_GENRE_ID), "unavailable", 404);
  });

  it("returns only the selected venue's announcements and the chosen interval", async () => {
    const { api } = make();
    const response = await api.getAnnouncements();
    expect(response.announcements).toEqual([
      { id: "eb-welcome", placement: "welcome", durationSeconds: 4, text: "Welcome" },
      { id: "eb-station", placement: "rotation", durationSeconds: 5, text: "Station" },
    ]);
    expect(response.settings).toEqual({ everyNTracks: 2, volume: 1 });
  });

  it("signs demo URLs served by the dev audio route", async () => {
    const { api } = make();
    const track = await api.signMedia({ kind: "track", id: "loop-1", genreId: "house" });
    expect(track).toMatchObject({ kind: "track", url: "/api/dev/audio/loop-1", title: "Loop 1", durationSeconds: 30 });
    expect(Date.parse(track.expiresAt)).toBe(1_000_000 + 7_200_000);
    const announcement = await api.signMedia({ kind: "announcement", id: "eb-station" });
    expect(announcement.url).toBe("/api/dev/audio/eb-station");
    await expectApiError(api.signMedia({ kind: "track", id: "loop-3", genreId: "house" }), "unavailable", 404);
    await expectApiError(api.signMedia({ kind: "announcement", id: "ha-both" }), "unavailable", 404);
  });

  it("applies one-shot faults exactly once and switches them off", async () => {
    const { api, faults } = make();
    faults.set("nextSignGone", true);
    await expectApiError(api.signMedia({ kind: "track", id: "loop-1", genreId: "house" }), "unavailable", 410);
    expect(faults.getSnapshot().nextSignGone).toBe(false);
    await expect(api.signMedia({ kind: "track", id: "loop-1", genreId: "house" })).resolves.toMatchObject({ id: "loop-1" });

    faults.set("nextTrackBrokenUrl", true);
    const broken = await api.signMedia({ kind: "track", id: "loop-2", genreId: "house" });
    expect(broken.url).toMatch(/^\/api\/dev\/audio\/lab-missing-file-\d+$/);
    expect(faults.getSnapshot().nextTrackBrokenUrl).toBe(false);
    expect((await api.signMedia({ kind: "track", id: "loop-2", genreId: "house" })).url).toBe("/api/dev/audio/loop-2");
  });

  it("simulates offline, expired session, failing announcements and short URL lifetimes", async () => {
    const { api, faults } = make();
    faults.set("offline", true);
    await expectApiError(api.getGenreTracks("house"), "network", null);
    faults.set("offline", false);

    faults.set("sessionExpired", true);
    await expectApiError(api.signMedia({ kind: "track", id: "loop-1", genreId: "house" }), "auth", 401);
    faults.set("sessionExpired", false);

    faults.set("announcementsFail", true);
    await expectApiError(api.getAnnouncements(), "server", 500);
    await expectApiError(api.signMedia({ kind: "announcement", id: "eb-station" }), "server", 500);
    await expect(api.getGenreTracks("house")).resolves.toBeTruthy();
    faults.set("announcementsFail", false);

    faults.set("shortUrls", true);
    const signed = await api.signMedia({ kind: "track", id: "loop-1", genreId: "house" });
    const expiresAt = Date.parse(signed.expiresAt);
    expect(expiresAt).toBe(1_000_000 + 20_000);
    expect(signed.url).toBe(labAudioUrl("loop-1", expiresAt));
    expect(signed.url).toBe(`/api/dev/audio/loop-1?exp=${expiresAt}`);
  });

  it("rejects with an AbortError when the engine aborts a request", async () => {
    const faults = new LabFaultStore();
    const api = createLabPlayerApi({ catalog, businessKey: "emeraldbar", everyNTracks: 2, faults, latencyMs: 50 });
    const controller = new AbortController();
    const pending = api.getGenreTracks("house", controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps saved preferences and logs every call with its outcome", async () => {
    const { api, log } = make();
    await expect(api.savePreferences({ genreId: "house" })).resolves.toEqual({ genreId: "house", volume: 0.8, muted: false });
    await expect(api.savePreferences({ muted: true })).resolves.toEqual({ genreId: "house", volume: 0.8, muted: true });
    await api.getGenreTracks(LAB_MISSING_GENRE_ID).catch(() => undefined);
    expect(log).toHaveBeenCalledWith("api.savePreferences", expect.objectContaining({ outcome: "ok" }));
    expect(log).toHaveBeenCalledWith("api.getGenreTracks", expect.objectContaining({ outcome: "error", genreId: LAB_MISSING_GENRE_ID }));
  });
});

describe("LabFaultStore", () => {
  it("notifies on change only and resets everything", () => {
    const store = new LabFaultStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set("offline", true);
    store.set("offline", true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.consume("slowApi")).toBe(false);
    store.reset();
    expect(store.getSnapshot()).toBe(NO_LAB_FAULTS);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("LabLogStore", () => {
  it("keeps the newest entries within its capacity with elapsed times", () => {
    let now = 5_000;
    const log = new LabLogStore(3, () => now);
    for (let i = 1; i <= 5; i++) {
      now += 100;
      log.push("engine", `event-${i}`, { i });
    }
    const entries = log.getSnapshot();
    expect(entries.map((entry) => entry.event)).toEqual(["event-3", "event-4", "event-5"]);
    expect(entries.map((entry) => entry.seq)).toEqual([3, 4, 5]);
    expect(entries[2].elapsedMs).toBe(500);
    const before = log.getSnapshot();
    log.clear();
    expect(log.getSnapshot()).toEqual([]);
    expect(log.getSnapshot()).not.toBe(before);
  });

  it("formats details compactly", () => {
    expect(formatLogDetail(undefined)).toBe("");
    expect(formatLogDetail({ id: "a1", attempt: 2, skipped: undefined, info: { x: 1 } })).toBe('id=a1  attempt=2  info={"x":1}');
  });
});
