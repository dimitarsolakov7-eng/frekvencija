import { describe, expect, it } from "vitest";
import { normalizeKey, pickByKey, seededRandom, stableHash } from "@/lib/utils";

describe("stableHash", () => {
  it("is the 32-bit FNV-1a hash", () => {
    // Reference values of FNV-1a/32.
    expect(stableHash("")).toBe(0x811c9dc5);
    expect(stableHash("a")).toBe(0xe40c292c);
    expect(stableHash("foobar")).toBe(0xbf9cf968);
  });

  it("is deterministic and unsigned", () => {
    for (const key of ["house", "Deep House", "балкан", "😀"]) {
      const value = stableHash(key);
      expect(value).toBe(stableHash(key));
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
  });
});

describe("normalizeKey / pickByKey", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(normalizeKey("  House ")).toBe("house");
    expect(normalizeKey(null)).toBe("");
    const options = ["a", "b", "c", "d", "e"] as const;
    expect(pickByKey("House", options)).toBe(pickByKey(" house  ", options));
    expect(pickByKey(undefined, options)).toBe(pickByKey("", options));
  });

  it("spreads keys over every option", () => {
    const options = [0, 1, 2, 3, 4, 5, 6, 7] as const;
    const seen = new Set(Array.from({ length: 200 }, (_, index) => pickByKey(`genre-${index}`, options)));
    expect(seen.size).toBe(options.length);
  });

  it("rejects an empty option list", () => {
    expect(() => pickByKey("x", [])).toThrow(RangeError);
  });
});

describe("seededRandom", () => {
  it("repeats the same sequence for the same seed", () => {
    const first = seededRandom("waveform");
    const second = seededRandom("waveform");
    const a = Array.from({ length: 20 }, () => first());
    const b = Array.from({ length: 20 }, () => second());
    expect(a).toEqual(b);
  });

  it("differs between seeds and stays within [0, 1)", () => {
    const a = Array.from({ length: 50 }, seededRandom(1));
    const b = Array.from({ length: 50 }, seededRandom(2));
    expect(a).not.toEqual(b);
    for (const value of [...a, ...b]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
