/**
 * The real PlayerEngine driven the way the venue UI and the player lab drive it: through
 * PlayerEngineStore commands and snapshots, the view helpers, and the lab's fake API with injected
 * faults. Media elements and time come from the engine test fakes (tests/player/fakes.ts).
 */
import { describe, expect, it } from "vitest";
import { LabFaultStore, createLabPlayerApi } from "@/app/dev/player-lab/lab-api";
import { buildLabCatalog, type LabManifestEntry } from "@/app/dev/player-lab/lab-catalog";
import { PlayerEngineStore } from "@/components/player/engine-store";
import {
  createIdleSnapshot,
  genreCardState,
  getPrimaryAction,
  playGenre,
  runPrimaryAction,
  statusMessage,
} from "@/components/player/player-view";
import { createPlayerEngine } from "@/lib/player/engine";
import { FakeMediaSession, ManualClock, MediaHarness, MemoryStorage, seededRandom } from "../player/fakes";

const ENTRIES: LabManifestEntry[] = [
  ...[1, 2, 3, 4].map(
    (n): LabManifestEntry => ({ kind: "track", id: `loop-${n}`, title: `Loop ${n}`, artist: "Test Signal", durationSeconds: 30, genre: "house" }),
  ),
  { kind: "track", id: "jazz-1", title: "Jazz 1", artist: "Test Signal", durationSeconds: 30, genre: "jazz" },
  { kind: "announcement", id: "eb-welcome", durationSeconds: 4, business: "emeraldbar", placement: "welcome", text: "Welcome" },
  { kind: "announcement", id: "eb-station", durationSeconds: 5, business: "emeraldbar", placement: "rotation", text: "Station" },
];

async function setup() {
  const clock = new ManualClock();
  const media = new MediaHarness(clock);
  const faults = new LabFaultStore();
  const catalog = buildLabCatalog("Synthetic.", ENTRIES);
  const api = createLabPlayerApi({ catalog, businessKey: "emeraldbar", everyNTracks: 2, faults, latencyMs: 0, now: () => clock.now() });
  const store = new PlayerEngineStore(createIdleSnapshot({ genreId: "house", volume: 0.8, muted: false }));
  const engine = createPlayerEngine(
    {
      api,
      createMediaElement: media.create,
      timers: clock,
      random: seededRandom(7),
      storage: new MemoryStorage(),
      mediaSession: new FakeMediaSession(),
      createMediaMetadata: (init) => ({ ...init }),
      isPageVisible: () => true,
    },
    {
      userId: "lab-user",
      businessId: "lab-emeraldbar",
      stationName: "EmeraldBar Radio",
      businessName: "EmeraldBar",
      logoUrl: null,
      initialGenreId: "house",
      initialVolume: 0.8,
      initialMuted: false,
      announcementEveryNTracks: 2,
      announcementVolume: 1,
    },
  );
  store.attach(engine);
  await clock.advance(0);
  const snapshot = () => store.getSnapshot();
  const press = () => runPrimaryAction(store.commands, getPrimaryAction(snapshot(), true).kind);
  const finishCurrent = async () => {
    const el = media.playing();
    if (!el) throw new Error(`nothing audible (status ${snapshot().status})`);
    el.finish();
    await clock.advance(0);
  };
  return { clock, media, faults, store, engine, snapshot, press, finishCurrent };
}

describe("venue player flow on the real engine", () => {
  it("Start Radio plays the venue's welcome, then music, then a station announcement every N tracks", async () => {
    const h = await setup();
    expect(getPrimaryAction(h.snapshot(), true).label).toBe("Start Radio");

    h.press();
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "playing", current: { kind: "announcement", label: "Welcome announcement" } });
    expect(getPrimaryAction(h.snapshot(), true).label).toBe("Pause");
    expect(h.media.withSrc("/api/dev/audio/eb-welcome")).toHaveLength(1);

    await h.finishCurrent();
    expect(h.snapshot().current?.kind).toBe("track");
    expect(statusMessage(h.snapshot(), { hasGenres: true })).toMatch(/^Playing: Loop \d/);

    await h.finishCurrent();
    expect(h.snapshot().current?.kind).toBe("track");
    await h.finishCurrent();
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", label: "Station announcement" });
    h.media.assertExclusive();
  });

  it("pauses and resumes through the primary action", async () => {
    const h = await setup();
    h.press();
    await h.clock.advance(0);
    h.press();
    expect(h.snapshot().status).toBe("paused");
    expect(getPrimaryAction(h.snapshot(), true)).toMatchObject({ kind: "resume", label: "Play" });
    h.press();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
  });

  it("a one-shot 410 on sign drops that track and keeps the radio playing", async () => {
    const h = await setup();
    h.press();
    await h.clock.advance(0);
    await h.finishCurrent(); // welcome → first track
    const first = h.snapshot().current?.id;
    h.faults.set("nextSignGone", true);
    h.store.commands.skip();
    // The skipped track fades out (300 ms) before the next one starts.
    await h.clock.advance(1_000);
    expect(h.faults.getSnapshot().nextSignGone).toBe(false);
    expect(h.snapshot().status).toBe("playing");
    expect(h.snapshot().current?.kind).toBe("track");
    expect(h.snapshot().current?.id).not.toBe(first);
  });

  it("failing announcements never stop the music", async () => {
    const h = await setup();
    h.faults.set("announcementsFail", true);
    h.press();
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "playing", current: { kind: "track" } });
    expect(h.snapshot().tracksUntilAnnouncement).toBeNull();
  });

  it("an expired session stops playback with auth_expired (sign in again, no retry button)", async () => {
    const h = await setup();
    h.press();
    await h.clock.advance(0);
    await h.finishCurrent(); // welcome → first track (Skip applies to music only)
    h.faults.set("sessionExpired", true);
    h.store.commands.skip();
    await h.clock.advance(1_000);
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "auth_expired" });
    expect(getPrimaryAction(h.snapshot(), true)).toMatchObject({ kind: "none", disabled: true });
    expect(h.media.active()).toHaveLength(0);
  });

  it("goes offline into a network error that Retry recovers from", async () => {
    const h = await setup();
    h.faults.set("offline", true);
    h.press();
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "network" });
    expect(getPrimaryAction(h.snapshot(), true)).toMatchObject({ kind: "retry", label: "Retry" });
    h.faults.set("offline", false);
    h.press();
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("playing");
  });

  it("an empty genre shows the empty state and a removed genre shows genre_unavailable", async () => {
    const h = await setup();
    h.press();
    await h.clock.advance(0);
    h.store.commands.selectGenre("pop");
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("empty");
    expect(getPrimaryAction(h.snapshot(), true).disabled).toBe(true);

    h.store.commands.selectGenre("lab-removed-genre");
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "error", errorCode: "genre_unavailable" });

    h.store.commands.selectGenre("jazz");
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "playing", genreId: "jazz" });
    expect(h.snapshot().notice).toMatch(/only one track/i);
  });

  it("logout: destroying through the store silences everything and restores the idle snapshot", async () => {
    const h = await setup();
    h.press();
    await h.clock.advance(0);
    expect(h.media.active()).toHaveLength(1);
    h.store.destroyEngine();
    expect(h.media.active()).toHaveLength(0);
    expect(h.store.hasEngine).toBe(false);
    expect(h.snapshot()).toMatchObject({ status: "idle", hasStarted: false });
  });

  it("Play {genre} before the first start selects that genre and starts the radio (welcome first)", async () => {
    const h = await setup();
    playGenre(h.store.commands, h.snapshot(), "jazz");
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "playing", genreId: "jazz", hasStarted: true });
    expect(h.snapshot().current).toMatchObject({ kind: "announcement", label: "Welcome announcement" });
    await h.finishCurrent();
    expect(h.snapshot().current).toMatchObject({ kind: "track", id: "jazz-1" });
  });

  it("selecting a card while paused keeps the radio paused; Play {genre} then starts it", async () => {
    const h = await setup();
    h.press();
    await h.clock.advance(0);
    h.press();
    expect(h.snapshot().status).toBe("paused");

    h.store.commands.selectGenre("jazz");
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "paused", genreId: "jazz" });
    expect(h.media.active()).toHaveLength(0);

    playGenre(h.store.commands, h.snapshot(), "jazz");
    await h.clock.advance(0);
    expect(h.snapshot()).toMatchObject({ status: "playing", genreId: "jazz" });
    expect(genreCardState({ id: "jazz", name: "Jazz", slug: "jazz", description: null, trackCount: 1, coverUrl: null }, h.snapshot()).indicator).toBe(
      "playing",
    );
    h.media.assertExclusive();
  });

  it("Play {genre} while another genre plays moves cleanly to the new genre", async () => {
    const h = await setup();
    h.press();
    await h.clock.advance(0);
    await h.finishCurrent(); // welcome → house track
    expect(h.snapshot().current?.kind).toBe("track");
    playGenre(h.store.commands, h.snapshot(), "jazz");
    await h.clock.advance(1_000);
    expect(h.snapshot()).toMatchObject({ status: "playing", genreId: "jazz", current: { kind: "track", id: "jazz-1" } });
    expect(h.media.active()).toHaveLength(1);
    h.media.assertExclusive();
  });

  it("Play {genre} recovers from an empty genre", async () => {
    const h = await setup();
    h.press();
    await h.clock.advance(0);
    h.store.commands.selectGenre("pop");
    await h.clock.advance(0);
    expect(h.snapshot().status).toBe("empty");
    playGenre(h.store.commands, h.snapshot(), "house");
    await h.clock.advance(1_000);
    expect(h.snapshot()).toMatchObject({ status: "playing", genreId: "house" });
  });
});
