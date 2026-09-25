import { describe, expect, it } from "vitest";
import type { AnnouncementSummary } from "@/lib/api/contracts";
import { AnnouncementScheduler, welcomeStorageKey } from "@/lib/player/announcements";
import { MemoryStorage, seededRandom } from "./fakes";

const ann = (id: string, placement: AnnouncementSummary["placement"]): AnnouncementSummary => ({
  id,
  placement,
  durationSeconds: 8,
  text: `Announcement ${id}`,
});

function makeScheduler(everyNTracks = 4, storage = new MemoryStorage(), seed = 1) {
  const scheduler = new AnnouncementScheduler({
    everyNTracks,
    storage,
    welcomeKey: welcomeStorageKey("user-1", "biz-1"),
    random: seededRandom(seed),
  });
  return { scheduler, storage };
}

describe("AnnouncementScheduler", () => {
  it("offers a welcome (welcome|both) until it is marked played in this session", () => {
    const { scheduler, storage } = makeScheduler();
    scheduler.setAnnouncements([ann("w", "welcome"), ann("r", "rotation")]);
    expect(scheduler.takeWelcome()?.id).toBe("w");
    expect(scheduler.takeWelcome()?.id).toBe("w");
    scheduler.markWelcomePlayed();
    expect(storage.get(welcomeStorageKey("user-1", "biz-1"))).toBe("1");
    expect(scheduler.takeWelcome()).toBeNull();

    // A new engine in the same browser session shares the key.
    const second = makeScheduler(4, storage).scheduler;
    second.setAnnouncements([ann("w", "welcome")]);
    expect(second.takeWelcome()).toBeNull();

    scheduler.clearWelcome();
    expect(scheduler.takeWelcome()?.id).toBe("w");
  });

  it("uses placement 'both' for welcome and rotation, never 'rotation' for welcome", () => {
    const { scheduler } = makeScheduler();
    scheduler.setAnnouncements([ann("b", "both"), ann("r", "rotation")]);
    expect(scheduler.takeWelcome()?.id).toBe("b");
    const rotation = new Set([scheduler.nextRotation()?.id, scheduler.nextRotation()?.id]);
    expect(rotation).toEqual(new Set(["b", "r"]));

    const onlyRotation = makeScheduler().scheduler;
    onlyRotation.setAnnouncements([ann("r", "rotation")]);
    expect(onlyRotation.takeWelcome()).toBeNull();
  });

  it("is due after every N completed tracks and resets after an announcement", () => {
    const { scheduler } = makeScheduler(3);
    scheduler.setAnnouncements([ann("r", "rotation")]);
    expect(scheduler.tracksUntilAnnouncement).toBe(3);
    scheduler.onTrackCompleted();
    scheduler.onTrackCompleted();
    expect(scheduler.isDue()).toBe(false);
    expect(scheduler.wouldBeDueAfterNextCompletion()).toBe(true);
    scheduler.onTrackCompleted();
    expect(scheduler.isDue()).toBe(true);
    expect(scheduler.tracksUntilAnnouncement).toBe(0);
    scheduler.onAnnouncementPlayed();
    expect(scheduler.isDue()).toBe(false);
    expect(scheduler.completedTracks).toBe(0);
  });

  it("applies an updated everyN immediately (clamped to 1–50)", () => {
    const { scheduler } = makeScheduler(4);
    scheduler.setAnnouncements([ann("r", "rotation")]);
    scheduler.onTrackCompleted();
    scheduler.onTrackCompleted();
    scheduler.setEveryNTracks(2);
    expect(scheduler.isDue()).toBe(true);
    scheduler.setEveryNTracks(0);
    expect(scheduler.everyNTracks).toBe(1);
    scheduler.setEveryNTracks(500);
    expect(scheduler.everyNTracks).toBe(50);
  });

  it("rotation never plays the same announcement twice in a row", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { scheduler } = makeScheduler(1, new MemoryStorage(), seed);
      scheduler.setAnnouncements([ann("a", "rotation"), ann("b", "rotation"), ann("c", "both")]);
      let previous: string | undefined;
      for (let i = 0; i < 60; i++) {
        const id = scheduler.nextRotation()?.id;
        expect(id).toBeDefined();
        expect(id).not.toBe(previous);
        previous = id;
      }
    }
  });

  it("stays due and reports null countdown when no rotation announcement exists", () => {
    const { scheduler } = makeScheduler(2);
    scheduler.setAnnouncements([ann("w", "welcome")]);
    scheduler.onTrackCompleted();
    scheduler.onTrackCompleted();
    expect(scheduler.isDue()).toBe(true);
    expect(scheduler.nextRotation()).toBeNull();
    expect(scheduler.tracksUntilAnnouncement).toBeNull();
    expect(scheduler.wouldBeDueAfterNextCompletion()).toBe(false);
  });

  it("markFailed excludes an announcement until the list is refreshed", () => {
    const { scheduler } = makeScheduler(1);
    const list = [ann("a", "rotation"), ann("b", "both")];
    scheduler.setAnnouncements(list);
    scheduler.markFailed("a");
    for (let i = 0; i < 5; i++) expect(scheduler.nextRotation()?.id).toBe("b");
    scheduler.markFailed("b");
    expect(scheduler.nextRotation()).toBeNull();
    expect(scheduler.takeWelcome()).toBeNull();
    expect(scheduler.isAvailable("a")).toBe(false);
    scheduler.setAnnouncements(list);
    expect(scheduler.isAvailable("a")).toBe(true);
    expect(scheduler.hasRotation).toBe(true);
  });

  it("survives a storage that throws", () => {
    const throwing = {
      get: () => {
        throw new Error("blocked");
      },
      set: () => {
        throw new Error("blocked");
      },
      remove: () => {
        throw new Error("blocked");
      },
    };
    const scheduler = new AnnouncementScheduler({ everyNTracks: 4, storage: throwing, welcomeKey: "k" });
    scheduler.setAnnouncements([ann("w", "welcome")]);
    expect(scheduler.takeWelcome()?.id).toBe("w");
    expect(() => scheduler.markWelcomePlayed()).not.toThrow();
    expect(() => scheduler.clearWelcome()).not.toThrow();
  });
});
