/**
 * BIZ-01: the Profile tab keeps its form mounted and merges newer saved data into it. A logo upload
 * or Activate/Deactivate from the menu (both refresh the venue row) must not throw away unsaved
 * edits, and must not leave a stale value (such as the old status) to be saved back.
 */
import { describe, expect, it } from "vitest";
import {
  discardProfileEdits,
  editedProfileFields,
  isProfileDirty,
  joinGenreIds,
  markProfileSaved,
  newProfileDraft,
  profileValuesFromForm,
  profileValuesOf,
  rebaseProfileDraft,
  sameProfileValues,
  setProfileValue,
  takeSavedValuesForConflicts,
  type ProfileValues,
} from "@/components/admin/businesses/profile-draft";
import type { AdminBusinessRecord, GenreAccessOption } from "@/lib/data/admin/businesses";

const JAZZ = "22222222-2222-4222-8222-222222222222";
const VIP = "33333333-3333-4333-8333-333333333333";
const LOUNGE = "11111111-1111-4111-8111-111111111111";

const business = {
  name: "EmeraldBar",
  businessType: "bar",
  stationName: "EmeraldBar Radio",
  contactEmail: "manager@emeraldbar.example",
  announcementLanguage: "en",
  isActive: true,
  namePronunciation: "Emerald Bar",
  stationNamePronunciation: null,
} satisfies Partial<AdminBusinessRecord>;

function genre(id: string, overrides: Partial<GenreAccessOption> = {}): GenreAccessOption {
  return {
    id,
    name: id,
    isEnabled: true,
    availableToAll: false,
    assigned: false,
    accessible: false,
    editable: true,
    playableTrackCount: 0,
    ...overrides,
  };
}

const genres = [genre(LOUNGE, { availableToAll: true, editable: false, assigned: true }), genre(JAZZ, { assigned: true }), genre(VIP)];
const saved: ProfileValues = profileValuesOf(business as AdminBusinessRecord, genres);

describe("profile values", () => {
  it("are the venue's saved values, with only its exclusive genres", () => {
    expect(saved).toEqual({
      name: "EmeraldBar",
      businessType: "bar",
      stationName: "EmeraldBar Radio",
      contactEmail: "manager@emeraldbar.example",
      announcementLanguage: "en",
      isActive: "true",
      namePronunciation: "Emerald Bar",
      stationNamePronunciation: "",
      genreIds: JAZZ,
    });
    expect(joinGenreIds([VIP, JAZZ, VIP])).toBe(`${JAZZ},${VIP}`);
  });

  it("read back from a submitted form", () => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ ...saved, genreIds: "" })) if (key !== "genreIds") data.append(key, value);
    data.append("isActive", "false");
    data.append("genreIds", VIP);
    data.append("genreIds", JAZZ);
    expect(profileValuesFromForm(data)).toEqual({ ...saved, isActive: "false", genreIds: `${JAZZ},${VIP}` });
  });

  it("compare like the server stores them (trimmed)", () => {
    expect(sameProfileValues(saved, { ...saved, name: " EmeraldBar " })).toBe(true);
    expect(sameProfileValues(saved, { ...saved, name: "Emerald" })).toBe(false);
  });
});

describe("a draft merging newer saved data (BIZ-01)", () => {
  it("keeps unsaved edits when only an unrelated column changed (a logo upload)", () => {
    const editing = setProfileValue(setProfileValue(newProfileDraft(saved), "stationName", "Emerald Nights"), "namePronunciation", "Emmerald Bar");
    // The logo lives outside the form: the refreshed venue has the same form values.
    const merged = rebaseProfileDraft(editing, { ...saved });
    expect(merged.values).toMatchObject({ stationName: "Emerald Nights", namePronunciation: "Emmerald Bar" });
    expect(editedProfileFields(merged)).toEqual(["stationName", "namePronunciation"]);
    expect(merged.conflicts).toEqual([]);
  });

  it("takes the new status from the menu's Deactivate while keeping the edits, so saving never reactivates", () => {
    const editing = setProfileValue(newProfileDraft(saved), "stationName", "Emerald Nights");
    const merged = rebaseProfileDraft(editing, { ...saved, isActive: "false" });
    expect(merged.values).toMatchObject({ stationName: "Emerald Nights", isActive: "false" });
    expect(merged.baseline.isActive).toBe("false");
    expect(editedProfileFields(merged)).toEqual(["stationName"]);
    expect(merged.conflicts).toEqual([]);
  });

  it("reports a field changed both here and elsewhere, keeps the admin's value, and can take the saved one", () => {
    const editing = setProfileValue(newProfileDraft(saved), "stationName", "Emerald Nights");
    const merged = rebaseProfileDraft(editing, { ...saved, stationName: "EmeraldBar FM", contactEmail: "new@emeraldbar.example" });
    expect(merged.values).toMatchObject({ stationName: "Emerald Nights", contactEmail: "new@emeraldbar.example" });
    expect(merged.conflicts).toEqual(["stationName"]);

    const resolved = takeSavedValuesForConflicts(merged);
    expect(resolved.values.stationName).toBe("EmeraldBar FM");
    expect(resolved.conflicts).toEqual([]);
    expect(isProfileDirty(resolved)).toBe(false);
  });

  it("drops an edit that the saved data now matches", () => {
    const editing = setProfileValue(newProfileDraft(saved), "isActive", "false");
    const merged = rebaseProfileDraft(editing, { ...saved, isActive: "false" });
    expect(isProfileDirty(merged)).toBe(false);
    expect(merged.conflicts).toEqual([]);
  });

  it("clears a conflict when the admin types the saved value back", () => {
    const editing = setProfileValue(newProfileDraft(saved), "name", "Emerald");
    const merged = rebaseProfileDraft(editing, { ...saved, name: "Emerald Bar & Grill" });
    expect(merged.conflicts).toEqual(["name"]);
    expect(setProfileValue(merged, "name", "Emerald Bar & Grill").conflicts).toEqual([]);
  });

  it("follows genre access changed elsewhere unless the admin ticked genres too", () => {
    const untouched = rebaseProfileDraft(newProfileDraft(saved), { ...saved, genreIds: `${JAZZ},${VIP}` });
    expect(untouched.values.genreIds).toBe(`${JAZZ},${VIP}`);
    const ticked = setProfileValue(newProfileDraft(saved), "genreIds", "");
    expect(rebaseProfileDraft(ticked, { ...saved, genreIds: `${JAZZ},${VIP}` }).conflicts).toEqual(["genreIds"]);
  });
});

describe("saving and discarding", () => {
  it("marks what was submitted as saved; edits made during the save stay unsaved", () => {
    const editing = setProfileValue(newProfileDraft(saved), "stationName", "Emerald Nights");
    const submitted = editing.values;
    const typedMeanwhile = setProfileValue(editing, "contactEmail", "owner@emeraldbar.example");
    const afterSave = markProfileSaved(typedMeanwhile, submitted);
    expect(editedProfileFields(afterSave)).toEqual(["contactEmail"]);
  });

  it("then shows the stored values once the refreshed page arrives, in either order", () => {
    const editing = setProfileValue(newProfileDraft(saved), "stationName", "Emerald Nights ");
    const stored = { ...saved, stationName: "Emerald Nights" };

    const resultFirst = rebaseProfileDraft(markProfileSaved(editing, editing.values), stored);
    expect(resultFirst.values.stationName).toBe("Emerald Nights");
    expect(isProfileDirty(resultFirst)).toBe(false);

    const refreshFirst = markProfileSaved(rebaseProfileDraft(editing, stored), editing.values);
    expect(isProfileDirty(refreshFirst)).toBe(false);
    expect(refreshFirst.conflicts).toEqual([]);
  });

  it("stays saved when no refreshed data arrives (the development preview)", () => {
    const editing = setProfileValue(newProfileDraft(saved), "stationName", "Emerald Nights");
    const afterSave = markProfileSaved(editing, editing.values);
    expect(isProfileDirty(afterSave)).toBe(false);
    expect(afterSave.values.stationName).toBe("Emerald Nights");
  });

  it("discards every edit back to the latest saved values", () => {
    const merged = rebaseProfileDraft(setProfileValue(newProfileDraft(saved), "name", "X"), { ...saved, isActive: "false" });
    expect(discardProfileEdits(merged).values).toEqual({ ...saved, isActive: "false" });
  });
});
