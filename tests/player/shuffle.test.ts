import { describe, expect, it } from "vitest";
import { ShuffleBag } from "@/lib/player/shuffle";
import { seededRandom } from "./fakes";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

describe("ShuffleBag", () => {
  it("plays every id exactly once per cycle (property loop over seeds and pool sizes)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const size = 1 + (seed % 12);
      const bag = new ShuffleBag(seededRandom(seed), ids(size));
      for (let cycle = 0; cycle < 5; cycle++) {
        const seen = new Set<string>();
        for (let i = 0; i < size; i++) {
          const id = bag.next();
          expect(id).not.toBeNull();
          expect(seen.has(id as string)).toBe(false);
          seen.add(id as string);
        }
        expect(seen.size).toBe(size);
        expect(bag.remainingInCycle).toBe(0);
      }
    }
  });

  it("never repeats an id back to back across cycle boundaries when the pool has >1 id", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const size = 2 + (seed % 6);
      const bag = new ShuffleBag(seededRandom(seed), ids(size));
      let previous: string | null = null;
      for (let i = 0; i < size * 20; i++) {
        const id = bag.next();
        expect(id).not.toBe(previous);
        previous = id;
      }
    }
  });

  it("repeats the only id of a single-item pool and reports isSingleTrack", () => {
    const bag = new ShuffleBag(seededRandom(7), ["only"]);
    expect(bag.isSingleTrack).toBe(true);
    expect([bag.next(), bag.next(), bag.next()]).toEqual(["only", "only", "only"]);
    expect(bag.cycleCount).toBe(3);
  });

  it("returns null for an empty pool", () => {
    const bag = new ShuffleBag(seededRandom(1));
    expect(bag.isEmpty).toBe(true);
    expect(bag.next()).toBeNull();
    bag.setPool([]);
    expect(bag.next()).toBeNull();
  });

  it("setPool removes ineligible ids from the remaining cycle immediately", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const bag = new ShuffleBag(seededRandom(seed), ids(8));
      const played = [bag.next(), bag.next()];
      const removed = ids(8).filter((id) => !played.includes(id)).slice(0, 3);
      bag.setPool(ids(8).filter((id) => !removed.includes(id)));
      const rest: string[] = [];
      while (bag.remainingInCycle > 0) rest.push(bag.next() as string);
      for (const id of removed) expect(rest).not.toContain(id);
      // Every remaining eligible, not-yet-played id is still played in this cycle.
      expect(new Set([...played, ...rest]).size).toBe(8 - removed.length);
    }
  });

  it("setPool inserts new ids into the remaining cycle (at varying positions)", () => {
    const positions = new Set<number>();
    for (let seed = 1; seed <= 100; seed++) {
      const bag = new ShuffleBag(seededRandom(seed), ids(6));
      bag.next();
      bag.setPool([...ids(6), "new"]);
      expect(bag.remainingInCycle).toBe(6);
      const rest: string[] = [];
      while (bag.remainingInCycle > 0) rest.push(bag.next() as string);
      expect(rest).toContain("new");
      positions.add(rest.indexOf("new"));
    }
    expect(positions.size).toBeGreaterThan(3);
  });

  it("new ids join the next cycle when no cycle is in progress", () => {
    const bag = new ShuffleBag(seededRandom(3), ["a", "b"]);
    bag.next();
    bag.next();
    bag.setPool(["a", "b", "c"]);
    const cycle = [bag.next(), bag.next(), bag.next()];
    expect(new Set(cycle)).toEqual(new Set(["a", "b", "c"]));
  });

  it("exclude() removes an id for the session, even across setPool()", () => {
    const bag = new ShuffleBag(seededRandom(9), ids(4));
    bag.exclude("t2");
    bag.setPool(ids(4));
    expect(bag.size).toBe(3);
    expect(bag.has("t2")).toBe(false);
    for (let i = 0; i < 30; i++) expect(bag.next()).not.toBe("t2");
    bag.clearExclusions();
    expect(bag.has("t2")).toBe(true);
    expect(bag.size).toBe(4);
  });

  it("excluding every id empties the bag", () => {
    const bag = new ShuffleBag(seededRandom(2), ["a", "b"]);
    bag.exclude("a");
    bag.exclude("b");
    expect(bag.isEmpty).toBe(true);
    expect(bag.next()).toBeNull();
  });

  it("is deterministic for a given random source", () => {
    const run = () => {
      const bag = new ShuffleBag(seededRandom(42), ids(10));
      return Array.from({ length: 25 }, () => bag.next());
    };
    expect(run()).toEqual(run());
  });
});

describe("ShuffleBag.peek", () => {
  /** A seeded random source that counts how often it was used. */
  function countingRandom(seed: number) {
    const source = seededRandom(seed);
    const counter = { calls: 0 };
    const random = () => {
      counter.calls += 1;
      return source();
    };
    return { random, counter };
  }

  it("previews exactly what next() returns, across cycle boundaries (property loop)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const size = 1 + (seed % 12);
      const bag = new ShuffleBag(seededRandom(seed), ids(size));
      for (let step = 0; step < size * 5; step++) {
        const preview = bag.peek(3);
        expect(preview.length).toBe(Math.min(3, bag.remainingInCycle + size));
        const played = preview.map(() => bag.next());
        expect(played).toEqual(preview);
      }
    }
  });

  it("never consumes, reorders or draws randomness", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { random, counter } = countingRandom(seed);
      const bag = new ShuffleBag(random, ids(7));
      bag.next();
      bag.next();
      const calls = counter.calls;
      const remaining = bag.remainingInCycle;
      const cycles = bag.cycleCount;
      const last = bag.last;
      const first = bag.peek(20);
      for (let i = 0; i < 10; i++) expect(bag.peek(1 + (i % 5))).toEqual(first.slice(0, 1 + (i % 5)));
      expect(counter.calls).toBe(calls);
      expect(bag.remainingInCycle).toBe(remaining);
      expect(bag.cycleCount).toBe(cycles);
      expect(bag.last).toBe(last);
      expect(Array.from({ length: first.length }, () => bag.next())).toEqual(first);
    }
  });

  it("looks into the planned next cycle, which still never repeats an id back to back", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const size = 2 + (seed % 5);
      const bag = new ShuffleBag(seededRandom(seed), ids(size));
      for (let i = 0; i < size - 1; i++) bag.next();
      expect(bag.remainingInCycle).toBe(1);
      const preview = bag.peek(size + 1);
      expect(preview).toHaveLength(size + 1);
      expect(new Set(preview.slice(1)).size).toBe(size); // the whole next cycle
      expect(preview[1]).not.toBe(preview[0]);
      expect(preview[0]).not.toBe(bag.last);
      expect(preview.map(() => bag.next())).toEqual(preview);
    }
  });

  it("covers at most the rest of this cycle plus the next one", () => {
    const bag = new ShuffleBag(seededRandom(3), ids(4));
    expect(bag.peek(100)).toHaveLength(4); // nothing started yet: the planned first cycle
    bag.next();
    expect(bag.peek(100)).toHaveLength(3 + 4);
    expect(bag.peek(Number.POSITIVE_INFINITY)).toEqual(bag.peek(7));
  });

  it("returns [] for an empty bag and for a non-positive or invalid count", () => {
    expect(new ShuffleBag(seededRandom(1)).peek(3)).toEqual([]);
    const bag = new ShuffleBag(seededRandom(1), ids(3));
    expect(bag.peek(0)).toEqual([]);
    expect(bag.peek(-2)).toEqual([]);
    expect(bag.peek(Number.NaN)).toEqual([]);
    expect(bag.peek(1.9)).toHaveLength(1);
    bag.exclude("t0");
    bag.exclude("t1");
    bag.exclude("t2");
    expect(bag.peek(3)).toEqual([]);
  });

  it("shows a single-track pool repeating", () => {
    const bag = new ShuffleBag(seededRandom(7), ["only"]);
    expect(bag.peek(3)).toEqual(["only"]);
    bag.next();
    expect(bag.peek(3)).toEqual(["only"]);
    expect(bag.next()).toBe("only");
  });

  it("keeps the preview when the same list is set again (a refresh with no changes)", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { random, counter } = countingRandom(seed);
      const bag = new ShuffleBag(random, ids(8));
      bag.next();
      bag.next();
      const preview = bag.peek(20);
      const calls = counter.calls;
      bag.setPool([...ids(8)].reverse());
      expect(bag.peek(20)).toEqual(preview);
      expect(counter.calls).toBe(calls);
    }
  });

  it("drops removed and excluded ids from the preview without reordering the rest", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const bag = new ShuffleBag(seededRandom(seed), ids(8));
      bag.next();
      bag.next();
      const preview = bag.peek(20); // 6 left in this cycle + the planned 8
      // Neither the current cycle's last id nor the plan's first id, so the cycle boundary is
      // untouched (that case is covered below).
      const removed = preview.slice(0, 5).find((id) => id !== preview[6]) as string;
      bag.setPool(ids(8).filter((id) => id !== removed));
      const reduced = bag.peek(20);
      expect(reduced).toEqual(preview.filter((id) => id !== removed));

      const excluded = reduced.slice(0, 4).find((id) => id !== reduced[5]) as string;
      bag.exclude(excluded);
      const after = bag.peek(20);
      expect(after).not.toContain(excluded);
      expect(after).not.toContain(removed);
      expect(after).toEqual(preview.filter((id) => id !== removed && id !== excluded));
      expect(after.map(() => bag.next())).toEqual(after);
    }
  });

  it("keeps the no-back-to-back rule when a removal changes the end of the current cycle", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const bag = new ShuffleBag(seededRandom(seed), ids(4));
      bag.next();
      const preview = bag.peek(3 + 4);
      // Remove the current cycle's last id: the id before the planned cycle changes.
      bag.setPool(ids(4).filter((id) => id !== preview[2]));
      const after = bag.peek(10);
      for (let i = 1; i < after.length; i++) expect(after[i]).not.toBe(after[i - 1]);
      expect(after[0]).not.toBe(bag.last);
      expect(after.map(() => bag.next())).toEqual(after);
    }
  });

  it("adds new ids to both the current cycle and the planned one", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const bag = new ShuffleBag(seededRandom(seed), ids(5));
      bag.next();
      bag.setPool([...ids(5), "new"]);
      const preview = bag.peek(100);
      expect(preview).toHaveLength(5 + 6);
      expect(preview.slice(0, 5)).toContain("new");
      expect(preview.slice(5)).toContain("new");
      expect(preview.map(() => bag.next())).toEqual(preview);
    }
  });

  it("re-admits cleared exclusions into the preview", () => {
    const bag = new ShuffleBag(seededRandom(11), ids(5));
    bag.next();
    bag.exclude("t3");
    expect(bag.peek(100)).not.toContain("t3");
    bag.clearExclusions();
    expect(bag.peek(100)).toContain("t3");
  });
});
