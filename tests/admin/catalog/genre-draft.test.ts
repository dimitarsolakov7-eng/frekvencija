import { describe, expect, it } from "vitest";
import {
  EMPTY_GENRE_DRAFT,
  genreDraftFormData,
  genreDraftFromItem,
  genreDraftProblems,
  isGenreDraftDirty,
  orderBusinessIds,
  rebaseGenreDraft,
  type GenreDraft,
} from "@/components/admin/catalog/genre-draft";
import type { AdminGenreItem, BusinessOption } from "@/components/admin/catalog/types";
import { formDataToObject } from "@/lib/validation/forms";
import { genreCreateSchema, genreUpdateSchema } from "@/lib/validation/genres";

const B1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const B3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const BUSINESSES: BusinessOption[] = [
  { id: B1, name: "Café Central", isActive: true },
  { id: B2, name: "EmeraldBar", isActive: true },
  { id: B3, name: "Hotel Aurora", isActive: false },
];

const JAZZ: AdminGenreItem = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Jazz",
  slug: "jazz",
  description: null,
  sortOrder: 4,
  isEnabled: true,
  availableToAll: false,
  playableCount: 3,
  totalCount: 4,
  accessBusinessIds: [B3, "gone", B1],
  coverPath: null,
  coverUrl: null,
};

describe("genreDraftFromItem", () => {
  it("fills the editor from the genre; the slug field starts empty (= keep)", () => {
    expect(genreDraftFromItem(JAZZ, BUSINESSES)).toEqual({
      name: "Jazz",
      slug: "",
      description: "",
      isEnabled: true,
      availability: "selected",
      businessIds: [B1, B3],
    });
    expect(genreDraftFromItem({ ...JAZZ, availableToAll: true, description: "Classic" }, BUSINESSES)).toMatchObject({
      availability: "all",
      description: "Classic",
    });
  });

  it("orders businesses like the picker and drops unknown ids", () => {
    expect(orderBusinessIds([B3, "x", B2], BUSINESSES)).toEqual([B2, B3]);
  });
});

describe("isGenreDraftDirty", () => {
  const baseline = genreDraftFromItem(JAZZ, BUSINESSES);

  it("ignores surrounding spaces and business order", () => {
    expect(isGenreDraftDirty(baseline, baseline)).toBe(false);
    expect(isGenreDraftDirty({ ...baseline, name: " Jazz " }, baseline)).toBe(false);
    expect(isGenreDraftDirty({ ...baseline, businessIds: [B3, B1] }, baseline)).toBe(false);
  });

  it("notices every field", () => {
    expect(isGenreDraftDirty({ ...baseline, name: "Smooth Jazz" }, baseline)).toBe(true);
    expect(isGenreDraftDirty({ ...baseline, slug: "smooth-jazz" }, baseline)).toBe(true);
    expect(isGenreDraftDirty({ ...baseline, description: "New" }, baseline)).toBe(true);
    expect(isGenreDraftDirty({ ...baseline, isEnabled: false }, baseline)).toBe(true);
    expect(isGenreDraftDirty({ ...baseline, availability: "all" }, baseline)).toBe(true);
    expect(isGenreDraftDirty({ ...baseline, businessIds: [B1] }, baseline)).toBe(true);
  });

  it("ignores the business list while All businesses is chosen (it is not submitted)", () => {
    const all = { ...baseline, availability: "all" as const };
    expect(isGenreDraftDirty({ ...all, businessIds: [] }, all)).toBe(false);
  });

  it("treats a new genre as dirty once something is typed", () => {
    expect(isGenreDraftDirty(EMPTY_GENRE_DRAFT, EMPTY_GENRE_DRAFT)).toBe(false);
    expect(isGenreDraftDirty({ ...EMPTY_GENRE_DRAFT, name: "Pop" }, EMPTY_GENRE_DRAFT)).toBe(true);
  });
});

describe("genreDraftFormData", () => {
  it("sends the business list only for Selected businesses, marked with accessListed", () => {
    const selected = genreDraftFormData({ ...genreDraftFromItem(JAZZ, BUSINESSES), businessIds: [] });
    expect(selected.get("availableToAll")).toBe("false");
    expect(selected.get("accessListed")).toBe("true");
    expect(selected.getAll("businessIds")).toEqual([]);

    const all = genreDraftFormData({ ...genreDraftFromItem(JAZZ, BUSINESSES), availability: "all" });
    expect(all.get("availableToAll")).toBe("true");
    expect(all.has("accessListed")).toBe(false);
    expect(all.has("businessIds")).toBe(false);
  });

  it("produces values the create and update schemas accept", () => {
    const draft = { ...EMPTY_GENRE_DRAFT, name: " Chill Out ", description: "  ", availability: "selected" as const, businessIds: [B1, B2] };
    const raw = formDataToObject(genreDraftFormData(draft), { arrays: ["businessIds"] });
    expect(raw.businessIds).toEqual([B1, B2]);
    expect(genreCreateSchema.parse(raw)).toMatchObject({
      name: "Chill Out",
      slug: "chill-out",
      description: null,
      isEnabled: true,
      availableToAll: false,
    });
    // A blank slug keeps the current one on update.
    expect(genreUpdateSchema.parse(raw)).toMatchObject({ name: "Chill Out", slug: undefined, isEnabled: true, availableToAll: false });
  });
});

/** The keys a FormData carries, in order, with repeated keys once. */
function keysOf(data: FormData): string[] {
  return [...new Set([...data.keys()])];
}

describe("genreDraftFormData with a baseline (saving an existing genre)", () => {
  const baseline = genreDraftFromItem(JAZZ, BUSINESSES);

  it("sends only the fields the admin edited (GEN-01: the status is not sent back)", () => {
    const data = genreDraftFormData({ ...baseline, description: "Classic vibes." }, baseline);
    expect(keysOf(data)).toEqual(["description"]);
    expect(data.get("description")).toBe("Classic vibes.");
  });

  it("sends the status only when it was switched in the form", () => {
    const data = genreDraftFormData({ ...baseline, isEnabled: false }, baseline);
    expect(keysOf(data)).toEqual(["isEnabled"]);
    expect(data.get("isEnabled")).toBe("false");
  });

  it("sends name and slug when edited, and ignores changes to surrounding spaces", () => {
    expect(keysOf(genreDraftFormData({ ...baseline, name: " Jazz ", description: "  " }, baseline))).toEqual([]);
    const data = genreDraftFormData({ ...baseline, name: "Smooth Jazz", slug: " smooth-jazz " }, baseline);
    expect(keysOf(data)).toEqual(["name", "slug"]);
    expect(data.get("slug")).toBe("smooth-jazz");
  });

  it("sends business access only when it changed", () => {
    // Another selection, availability unchanged: the list, but not availableToAll.
    const list = genreDraftFormData({ ...baseline, businessIds: [B1, B2] }, baseline);
    expect(keysOf(list)).toEqual(["accessListed", "businessIds"]);
    expect(list.getAll("businessIds")).toEqual([B1, B2]);

    // Switching to All businesses: the flag only (the rows are kept for switching back).
    const all = genreDraftFormData({ ...baseline, availability: "all" }, baseline);
    expect(keysOf(all)).toEqual(["availableToAll"]);
    expect(all.get("availableToAll")).toBe("true");

    // Switching to Selected businesses: the flag and the list, even when empty.
    const allBaseline: GenreDraft = { ...baseline, availability: "all", businessIds: [] };
    const selected = genreDraftFormData({ ...allBaseline, availability: "selected" }, allBaseline);
    expect(keysOf(selected)).toEqual(["availableToAll", "accessListed"]);
    expect(selected.get("availableToAll")).toBe("false");
  });

  it("leaves omitted fields unchanged in the update schema", () => {
    const raw = formDataToObject(genreDraftFormData({ ...baseline, description: "Classic vibes." }, baseline), { arrays: ["businessIds"] });
    const { businessIds, ...fields } = raw;
    expect(businessIds).toEqual([]);
    const parsed = genreUpdateSchema.parse(fields);
    expect(parsed).toEqual({ description: "Classic vibes." });
    expect(parsed.isEnabled).toBeUndefined();
  });
});

describe("rebaseGenreDraft", () => {
  const baseline = genreDraftFromItem(JAZZ, BUSINESSES);

  it("GEN-01: a deactivation while the description is being edited shows up, keeps the edit and is not undone by Save", () => {
    const edited = { ...baseline, description: "Classic vibes." };
    const fresh = genreDraftFromItem({ ...JAZZ, isEnabled: false }, BUSINESSES);

    const values = rebaseGenreDraft(edited, baseline, fresh);
    expect(values).toEqual({ ...fresh, description: "Classic vibes." });
    expect(values.isEnabled).toBe(false);
    expect(isGenreDraftDirty(values, fresh)).toBe(true);
    // Save sends the description only; Discard (values = baseline) shows the genre as it is now.
    expect(keysOf(genreDraftFormData(values, fresh))).toEqual(["description"]);
  });

  it("follows the server for every field the admin has not edited", () => {
    const edited = { ...baseline, description: "Classic vibes." };
    const fresh = genreDraftFromItem({ ...JAZZ, name: "Jazz Classics", availableToAll: true, accessBusinessIds: [B2] }, BUSINESSES);
    expect(rebaseGenreDraft(edited, baseline, fresh)).toEqual({
      name: "Jazz Classics",
      slug: "",
      description: "Classic vibes.",
      isEnabled: true,
      availability: "all",
      businessIds: [B2],
    });
  });

  it("keeps the admin's value for fields they edited, even when the server changed them too", () => {
    const edited: GenreDraft = { ...baseline, name: "Smooth Jazz", slug: "smooth", isEnabled: false };
    const fresh = genreDraftFromItem({ ...JAZZ, name: "Jazz Classics", slug: "jazz-classics" }, BUSINESSES);
    expect(rebaseGenreDraft(edited, baseline, fresh)).toMatchObject({ name: "Smooth Jazz", slug: "smooth", isEnabled: false });
  });

  it("settles a status edit that the server now matches", () => {
    // The admin switched Status off in the form, then deactivated the genre with the button.
    const edited = { ...baseline, isEnabled: false, description: "Classic vibes." };
    const fresh = genreDraftFromItem({ ...JAZZ, isEnabled: false }, BUSINESSES);
    const values = rebaseGenreDraft(edited, baseline, fresh);
    expect(values.isEnabled).toBe(false);
    expect(keysOf(genreDraftFormData(values, fresh))).toEqual(["description"]);
  });

  it("treats availability and the business list as one field", () => {
    const fresh = genreDraftFromItem({ ...JAZZ, availableToAll: true, accessBusinessIds: [B2] }, BUSINESSES);

    // An edited selection is kept whole.
    const editedList: GenreDraft = { ...baseline, businessIds: [B1] };
    expect(rebaseGenreDraft(editedList, baseline, fresh)).toMatchObject({ availability: "selected", businessIds: [B1] });

    // Switched to All businesses: the hidden list follows the server, for switching back later.
    const editedAll: GenreDraft = { ...baseline, availability: "all" };
    const freshSelected = genreDraftFromItem({ ...JAZZ, accessBusinessIds: [B2] }, BUSINESSES);
    expect(rebaseGenreDraft(editedAll, baseline, freshSelected)).toMatchObject({ availability: "all", businessIds: [B2] });
  });

  it("leaves a clean draft equal to the server's values", () => {
    const fresh = genreDraftFromItem({ ...JAZZ, isEnabled: false, name: "Jazz Classics" }, BUSINESSES);
    const values = rebaseGenreDraft(baseline, baseline, fresh);
    expect(values).toEqual(fresh);
    expect(isGenreDraftDirty(values, fresh)).toBe(false);
  });
});

describe("genreDraftProblems", () => {
  it("requires a name and caps name and description", () => {
    expect(genreDraftProblems(EMPTY_GENRE_DRAFT)).toEqual({ name: "Enter a genre name." });
    expect(genreDraftProblems({ ...EMPTY_GENRE_DRAFT, name: "x".repeat(61), description: "y".repeat(281) })).toEqual({
      name: "Use at most 60 characters.",
      description: "Use at most 280 characters.",
    });
    expect(genreDraftProblems({ ...EMPTY_GENRE_DRAFT, name: "House" })).toEqual({});
  });
});
