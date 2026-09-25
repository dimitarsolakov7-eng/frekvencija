import type { AnnouncementSummary, TrackSummary } from "@/lib/api/contracts";
import { PlayerEngine } from "@/lib/player/engine";
import type { EngineConfig, EngineTuning, PlayerSnapshot } from "@/lib/player/types";
import {
  FakeMediaSession,
  FakePlayerApi,
  ManualClock,
  MediaHarness,
  MemoryStorage,
  seededRandom,
  type FakeMediaElement,
} from "./fakes";

export const track = (id: string, durationSeconds = 180): TrackSummary => ({
  id,
  title: `Title ${id}`,
  artist: `Artist ${id}`,
  durationSeconds,
});

export const announcement = (id: string, placement: AnnouncementSummary["placement"], durationSeconds = 10): AnnouncementSummary => ({
  id,
  placement,
  durationSeconds,
  text: `You're listening to EmeraldBar Radio (${id}).`,
});

export interface SetupOptions {
  genres?: Record<string, TrackSummary[]>;
  announcements?: AnnouncementSummary[];
  everyN?: number;
  announcementVolume?: number;
  initialGenreId?: string | null;
  initialVolume?: number;
  tuning?: Partial<EngineTuning>;
  seed?: number;
  storage?: MemoryStorage;
  volumeMode?: "writable" | "readonly";
}

export type Harness = Awaited<ReturnType<typeof setup>>;

export async function setup(options: SetupOptions = {}) {
  const clock = new ManualClock();
  const media = new MediaHarness(clock);
  media.volumeMode = options.volumeMode ?? "writable";
  const api = new FakePlayerApi(clock);
  const genres = options.genres ?? { g1: ["a1", "a2", "a3", "a4", "a5", "a6"].map((id) => track(id)) };
  for (const [genreId, list] of Object.entries(genres)) api.genres.set(genreId, list);
  api.announcementList = options.announcements ?? [];
  api.settings = { everyNTracks: options.everyN ?? 4, volume: options.announcementVolume ?? 1 };
  const storage = options.storage ?? new MemoryStorage();
  const session = new FakeMediaSession();
  const onlineCallbacks = new Set<() => void>();
  const visibility = { visible: true };
  const logs: Array<{ event: string; detail?: Record<string, unknown> }> = [];

  const config: EngineConfig = {
    userId: "user-1",
    businessId: "biz-1",
    stationName: "EmeraldBar Radio",
    businessName: "EmeraldBar",
    logoUrl: null,
    initialGenreId: options.initialGenreId === undefined ? "g1" : options.initialGenreId,
    initialVolume: options.initialVolume ?? 0.8,
    initialMuted: false,
    announcementEveryNTracks: options.everyN ?? 4,
    announcementVolume: options.announcementVolume ?? 1,
  };

  const engine = new PlayerEngine(
    {
      api,
      createMediaElement: media.create,
      timers: clock,
      random: seededRandom(options.seed ?? 1),
      storage,
      mediaSession: session,
      createMediaMetadata: (init) => ({ ...init }),
      isPageVisible: () => visibility.visible,
      onOnline: (callback) => {
        onlineCallbacks.add(callback);
        return () => onlineCallbacks.delete(callback);
      },
      log: (event, detail) => logs.push({ event, detail }),
    },
    config,
    options.tuning,
  );
  // Let the asynchronous volume-writability probe finish.
  await clock.advance(0);

  const snapshot = (): PlayerSnapshot => engine.getSnapshot();

  const playingElement = (): FakeMediaElement => {
    const el = media.playing();
    if (!el) {
      throw new Error(`nothing audible (status ${snapshot().status}, active ${media.active().map((e) => e.describe()).join(", ")})`);
    }
    return el;
  };

  return {
    clock,
    media,
    api,
    storage,
    session,
    engine,
    logs,
    visibility,
    snapshot,
    playingElement,
    currentId: () => snapshot().current?.id ?? null,
    currentKind: () => snapshot().current?.kind ?? null,
    goOnline: () => {
      for (const callback of [...onlineCallbacks]) callback();
    },
    /** Natural end of whatever is audible, then let the transition complete. */
    async finish(): Promise<void> {
      playingElement().finish();
      await clock.advance(0);
      media.assertExclusive("after finish");
    },
    /** Start and wait until the first item is playing. */
    async start(): Promise<void> {
      engine.start();
      media.assertExclusive("after start()");
      await clock.advance(0);
    },
  };
}

/** Track id encoded in a fake signed URL (https://media.test/track/<id>?sig=n). */
export function idFromSrc(src: string): string | null {
  const match = /\/(?:track|announcement)\/([^?]+)\?/.exec(src);
  return match ? match[1] : null;
}
