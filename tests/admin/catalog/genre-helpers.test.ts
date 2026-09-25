import { describe, expect, it } from "vitest";
import {
  applyOrder,
  chunk,
  describeAvailability,
  describeTrackCounts,
  diffGenreAccess,
  effectiveSlug,
  genreConflictField,
  genreMatchesSearch,
  moveInOrder,
  moveToIndex,
  normalizeForSearch,
  normalizeSlugInput,
  sameOrder,
  slugProblem,
} from "@/components/admin/catalog/genre-helpers";
import { genreCreateSchema, MAX_SLUG_LENGTH, SLUG_PATTERN } from "@/lib/validation/genres";

describe("slug handling", () => {
  it("normalizes typing: lower-case, whitespace and underscores become hyphens", () => {
    expect(normalizeSlugInput("Chill Out")).toBe("chill-out");
    expect(normalizeSlugInput("LATE_night  Jazz")).toBe("late-night-jazz");
    // Other characters are kept so the admin sees why the slug is invalid.
    expect(normalizeSlugInput("r&b")).toBe("r&b");
    // A trailing hyphen stays while typing ("chill-" on the way to "chill-out").
    expect(normalizeSlugInput("chill-")).toBe("chill-");
  });

  it("uses the typed slug, or derives it from the name when blank", () => {
    expect(effectiveSlug("Café Lounge", "")).toBe("cafe-lounge");
    expect(effectiveSlug("Café Lounge", "   ")).toBe("cafe-lounge");
    expect(effectiveSlug("Café Lounge", " lounge ")).toBe("lounge");
    expect(effectiveSlug("Rock & Roll", "")).toBe("rock-and-roll");
    // Nothing usable in the name (e.g. only Cyrillic) and no slug typed.
    expect(effectiveSlug("Поп", "")).toBe("");
  });

  it("derives exactly what the server's create schema derives", () => {
    for (const name of ["Café Lounge", "Rock & Roll", "  Deep   House  ", "90s Hits!", "A".repeat(80)]) {
      const parsed = genreCreateSchema.safeParse({ name: name.slice(0, 60), slug: "" });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.slug).toBe(effectiveSlug(name.slice(0, 60), ""));
    }
  });

  it("reports problems only for typed, invalid slugs", () => {
    expect(slugProblem("")).toBeNull();
    expect(slugProblem("  ")).toBeNull();
    expect(slugProblem("chill-out")).toBeNull();
    expect(slugProblem("90s")).toBeNull();
    expect(slugProblem("chill-")).toMatch(/hyphen/);
    expect(slugProblem("-chill")).toMatch(/hyphen/);
    expect(slugProblem("chill--out")).toMatch(/single hyphens/);
    expect(slugProblem("r&b")).toMatch(/lowercase letters/);
    expect(slugProblem("Jazz")).toMatch(/lowercase letters/);
    expect(slugProblem("a".repeat(MAX_SLUG_LENGTH + 1))).toMatch(`at most ${MAX_SLUG_LENGTH}`);
    expect(SLUG_PATTERN.test("a".repeat(MAX_SLUG_LENGTH))).toBe(true);
    expect(slugProblem("a".repeat(MAX_SLUG_LENGTH))).toBeNull();
  });
});

describe("moveInOrder", () => {
  const ids = ["a", "b", "c", "d"];

  it("swaps with the neighbour and returns the complete new order", () => {
    expect(moveInOrder(ids, "c", "up")).toEqual(["a", "c", "b", "d"]);
    expect(moveInOrder(ids, "b", "down")).toEqual(["a", "c", "b", "d"]);
    expect(moveInOrder(ids, "a", "down")).toEqual(["b", "a", "c", "d"]);
    expect(moveInOrder(ids, "d", "up")).toEqual(["a", "b", "d", "c"]);
  });

  it("returns null at the edges and for unknown ids, and never mutates the input", () => {
    expect(moveInOrder(ids, "a", "up")).toBeNull();
    expect(moveInOrder(ids, "d", "down")).toBeNull();
    expect(moveInOrder(ids, "zz", "up")).toBeNull();
    expect(moveInOrder([], "a", "down")).toBeNull();
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("composes: moving to the top takes one step per position", () => {
    let order: string[] = ids;
    for (let step = 0; step < 3; step += 1) order = moveInOrder(order, "d", "up") ?? order;
    expect(order).toEqual(["d", "a", "b", "c"]);
    expect(moveInOrder(order, "d", "up")).toBeNull();
  });
});

describe("applyOrder", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("sorts items into the given order", () => {
    expect(applyOrder(items, ["c", "a", "d", "b"]).map((item) => item.id)).toEqual(["c", "a", "d", "b"]);
  });

  it("keeps unlisted items after the listed ones in their current order (like reorder_genres)", () => {
    expect(applyOrder(items, ["d", "b"]).map((item) => item.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("ignores unknown and duplicate ids", () => {
    expect(applyOrder(items, ["x", "b", "b", "a"]).map((item) => item.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("returns a new array and leaves the input untouched", () => {
    const result = applyOrder(items, ["d"]);
    expect(result).not.toBe(items);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("diffGenreAccess", () => {
  it("lists rows to insert and to delete", () => {
    expect(diffGenreAccess(["a", "b"], ["b", "c"])).toEqual({ toAdd: ["c"], toRemove: ["a"] });
  });

  it("is empty when nothing changed, whatever the order", () => {
    expect(diffGenreAccess(["a", "b"], ["b", "a"])).toEqual({ toAdd: [], toRemove: [] });
  });

  it("handles clearing and first assignment", () => {
    expect(diffGenreAccess(["a", "b"], [])).toEqual({ toAdd: [], toRemove: ["a", "b"] });
    expect(diffGenreAccess([], ["a", "b"])).toEqual({ toAdd: ["a", "b"], toRemove: [] });
  });

  it("ignores duplicates on either side", () => {
    expect(diffGenreAccess(["a", "a"], ["b", "b", "a"])).toEqual({ toAdd: ["b"], toRemove: [] });
  });
});

describe("chunk", () => {
  it("splits into fixed-size chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("treats a size below 1 as 1", () => {
    expect(chunk(["a", "b"], 0)).toEqual([["a"], ["b"]]);
  });
});

describe("describeAvailability", () => {
  const businesses = new Map([
    ["b1", { name: "Hotel Aurora", isActive: true }],
    ["b2", { name: "EmeraldBar", isActive: true }],
    ["b3", { name: "Closed Café", isActive: false }],
  ]);

  it("describes genres available to everyone", () => {
    expect(describeAvailability({ availableToAll: true, isEnabled: true, accessBusinessIds: ["b1"] }, businesses)).toEqual({
      label: "All businesses",
      businessNames: [],
      warning: null,
    });
  });

  it("lists assigned businesses by name, alphabetically, skipping unknown ids", () => {
    const summary = describeAvailability({ availableToAll: false, isEnabled: true, accessBusinessIds: ["b1", "zz", "b2"] }, businesses);
    expect(summary.label).toBe("Selected businesses · 2 businesses");
    expect(summary.businessNames).toEqual(["EmeraldBar", "Hotel Aurora"]);
    expect(summary.warning).toBeNull();
  });

  it("warns when nobody can play the genre", () => {
    expect(describeAvailability({ availableToAll: false, isEnabled: true, accessBusinessIds: [] }, businesses).warning).toMatch(/No business/);
    const inactiveOnly = describeAvailability({ availableToAll: false, isEnabled: true, accessBusinessIds: ["b3"] }, businesses);
    expect(inactiveOnly.label).toBe("Selected businesses · 1 business");
    expect(inactiveOnly.warning).toMatch(/inactive/);
  });
});

describe("describeTrackCounts", () => {
  it("summarises playable and total tracks", () => {
    expect(describeTrackCounts(0, 0)).toBe("No tracks yet");
    expect(describeTrackCounts(1, 1)).toBe("1 track");
    expect(describeTrackCounts(12, 12)).toBe("12 tracks");
    expect(describeTrackCounts(12, 14)).toBe("12 playable of 14 tracks");
    expect(describeTrackCounts(0, 1)).toBe("0 playable of 1 track");
  });
});

describe("genreConflictField", () => {
  it("maps the slug unique constraint to the slug field", () => {
    expect(
      genreConflictField({
        code: "23505",
        message: 'duplicate key value violates unique constraint "genres_slug_key"',
        details: "Key (slug)=(jazz) already exists.",
      }),
    ).toBe("slug");
  });

  it("maps the case-insensitive name index to the name field", () => {
    expect(
      genreConflictField({
        code: "23505",
        message: 'duplicate key value violates unique constraint "genres_name_lower_key"',
        details: "Key (lower(name))=(jazz) already exists.",
      }),
    ).toBe("name");
  });

  it("returns null for other errors or unknown constraints", () => {
    expect(genreConflictField({ code: "23503", message: "genres_slug_key" })).toBeNull();
    expect(genreConflictField({ code: "23505", message: "something else" })).toBeNull();
    expect(genreConflictField(null)).toBeNull();
  });
});

describe("drag-and-drop reordering", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves an id to a new position, shifting the ones in between", () => {
    expect(moveToIndex(ids, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveToIndex(ids, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveToIndex(ids, "b", 3)).toEqual(["a", "c", "d", "b"]);
  });

  it("clamps the target and ignores no-op or unknown moves", () => {
    expect(moveToIndex(ids, "a", 99)).toEqual(["b", "c", "d", "a"]);
    expect(moveToIndex(ids, "c", -5)).toEqual(["c", "a", "b", "d"]);
    expect(moveToIndex(ids, "b", 1)).toBeNull();
    expect(moveToIndex(ids, "x", 0)).toBeNull();
    expect(moveToIndex(ids, "a", Number.NaN)).toBeNull();
  });

  it("never mutates its input", () => {
    const input = [...ids];
    moveToIndex(input, "a", 3);
    expect(input).toEqual(ids);
  });

  it("compares orders", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOrder(["a"], ["a", "b"])).toBe(false);
  });
});

describe("genre search", () => {
  const house = { name: "Deep House", slug: "deep-house", description: "Deeper moods for longer evenings." };

  it("ignores case, accents and extra spaces", () => {
    expect(normalizeForSearch("  Café   LOUNGE ")).toBe("cafe lounge");
    expect(normalizeForSearch(null)).toBe("");
  });

  it("matches the name, the slug (as words) and the description", () => {
    expect(genreMatchesSearch(house, "deep")).toBe(true);
    expect(genreMatchesSearch(house, "DEEP house")).toBe(true);
    expect(genreMatchesSearch(house, "longer evenings")).toBe(true);
    expect(genreMatchesSearch({ ...house, description: null }, "evenings")).toBe(false);
    expect(genreMatchesSearch(house, "jazz")).toBe(false);
  });

  it("matches everything when the search is empty", () => {
    expect(genreMatchesSearch(house, "   ")).toBe(true);
  });
});
