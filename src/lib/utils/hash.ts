/**
 * Small deterministic helpers for picking stable visual variations (genre chip tones, avatar colours,
 * decorative waveforms). Not cryptographic. They never use Math.random or the clock, so server and
 * client render the same markup.
 */

/** 32-bit FNV-1a hash of a string (UTF-16 code units), as an unsigned integer. */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Normalises a key so "House", " house " and "HOUSE" pick the same variation. */
export function normalizeKey(key: string | null | undefined): string {
  return (key ?? "").trim().toLowerCase();
}

/** Deterministically picks one entry of a non-empty list for a key. */
export function pickByKey<T>(key: string | null | undefined, options: readonly T[]): T {
  if (options.length === 0) throw new RangeError("pickByKey needs at least one option");
  return options[stableHash(normalizeKey(key)) % options.length];
}

/**
 * Seeded pseudo-random generator (mulberry32) returning floats in [0, 1). The same seed always
 * yields the same sequence.
 */
export function seededRandom(seed: number | string): () => number {
  let state = (typeof seed === "string" ? stableHash(seed) : seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
