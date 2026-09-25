/**
 * The Profile tab's form as data (review finding BIZ-01). The form stays mounted while its venue is
 * open, so saved data that changes meanwhile (a logo upload, Activate/Deactivate from the menu,
 * another save) is merged in instead of re-mounting the form: fields the admin has not touched take
 * the new saved values, edited fields keep what the admin typed, and an edited field that was also
 * changed elsewhere is reported as a conflict. So no unsaved edit is lost, and a stale value (such
 * as an old status) is never saved back over a newer one.
 *
 * Pure and client-safe.
 */
import type { AdminBusinessRecord, GenreAccessOption } from "@/lib/data/admin/businesses";
import { lastFormString } from "./business-form";

export const PROFILE_FIELDS = [
  "name",
  "businessType",
  "stationName",
  "contactEmail",
  "announcementLanguage",
  "isActive",
  "namePronunciation",
  "stationNamePronunciation",
  "genreIds",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Every field as the form holds it: text as typed, isActive "true"/"false", genreIds sorted and comma-joined. */
export type ProfileValues = Record<ProfileField, string>;

export const PROFILE_FIELD_LABELS: Readonly<Record<ProfileField, string>> = {
  name: "Business name",
  businessType: "Business type",
  stationName: "Station name",
  contactEmail: "Contact email",
  announcementLanguage: "Announcement language",
  isActive: "Business status",
  namePronunciation: "Name pronunciation",
  stationNamePronunciation: "Station name pronunciation",
  genreIds: "Genre access",
};

type ProfileSource = Pick<
  AdminBusinessRecord,
  | "name"
  | "businessType"
  | "stationName"
  | "contactEmail"
  | "announcementLanguage"
  | "isActive"
  | "namePronunciation"
  | "stationNamePronunciation"
>;

/** "a,b" for a set of genre ids (sorted, without duplicates), so equal sets compare equal. */
export function joinGenreIds(ids: Iterable<string>): string {
  return [...new Set(ids)].sort().join(",");
}

export function splitGenreIds(value: string): string[] {
  return value ? value.split(",") : [];
}

/** The saved values of a venue, as the form shows them. Only exclusive (editable) genres are the form's. */
export function profileValuesOf(business: ProfileSource, genres: readonly GenreAccessOption[]): ProfileValues {
  return {
    name: business.name,
    businessType: business.businessType,
    stationName: business.stationName,
    contactEmail: business.contactEmail ?? "",
    announcementLanguage: business.announcementLanguage,
    isActive: business.isActive ? "true" : "false",
    namePronunciation: business.namePronunciation ?? "",
    stationNamePronunciation: business.stationNamePronunciation ?? "",
    genreIds: joinGenreIds(genres.filter((genre) => genre.editable && genre.assigned).map((genre) => genre.id)),
  };
}

/** The server trims text before saving, so "EmeraldBar " and "EmeraldBar" are the same value. */
function sameValue(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

export function sameProfileValues(a: ProfileValues, b: ProfileValues): boolean {
  return PROFILE_FIELDS.every((field) => sameValue(a[field], b[field]));
}

export interface ProfileDraft {
  /** The saved values the admin's edits are compared with. */
  baseline: ProfileValues;
  /** What the form shows and saves. */
  values: ProfileValues;
  /** The saved values last merged in from the page (they change when the venue changes elsewhere). */
  server: ProfileValues;
  /** Fields the admin edited that were also changed elsewhere since (their edits were kept). */
  conflicts: readonly ProfileField[];
}

export function newProfileDraft(saved: ProfileValues): ProfileDraft {
  return { baseline: saved, values: saved, server: saved, conflicts: [] };
}

/** Fields whose value differs from the saved one. */
export function editedProfileFields(draft: Pick<ProfileDraft, "baseline" | "values">): ProfileField[] {
  return PROFILE_FIELDS.filter((field) => !sameValue(draft.values[field], draft.baseline[field]));
}

export function isProfileDirty(draft: Pick<ProfileDraft, "baseline" | "values">): boolean {
  return editedProfileFields(draft).length > 0;
}

export function setProfileValue(draft: ProfileDraft, field: ProfileField, value: string): ProfileDraft {
  const values = { ...draft.values, [field]: value };
  // Typing the saved value back resolves the conflict for that field.
  const conflicts = draft.conflicts.filter((entry) => entry !== field || !sameValue(values[entry], draft.server[entry]));
  return { ...draft, values, conflicts };
}

/**
 * Merges newer saved values into the draft: untouched fields follow them, edited fields keep the
 * admin's value (a conflict when the saved value changed too and differs from the edit).
 */
export function rebaseProfileDraft(draft: ProfileDraft, saved: ProfileValues): ProfileDraft {
  const values: ProfileValues = { ...draft.values };
  const conflicts = new Set(draft.conflicts);
  for (const field of PROFILE_FIELDS) {
    const edited = !sameValue(draft.values[field], draft.baseline[field]);
    if (!edited) {
      values[field] = saved[field];
      conflicts.delete(field);
    } else if (!sameValue(saved[field], draft.server[field]) && !sameValue(saved[field], draft.values[field])) {
      conflicts.add(field);
    }
  }
  return {
    baseline: saved,
    values,
    server: saved,
    conflicts: PROFILE_FIELDS.filter((field) => conflicts.has(field) && !sameValue(values[field], saved[field])),
  };
}

/** The values a submitted Profile form carried. */
export function profileValuesFromForm(formData: FormData): ProfileValues {
  const genreIds = formData.getAll("genreIds").filter((entry): entry is string => typeof entry === "string");
  return {
    name: lastFormString(formData, "name"),
    businessType: lastFormString(formData, "businessType"),
    stationName: lastFormString(formData, "stationName"),
    contactEmail: lastFormString(formData, "contactEmail"),
    announcementLanguage: lastFormString(formData, "announcementLanguage"),
    isActive: lastFormString(formData, "isActive"),
    namePronunciation: lastFormString(formData, "namePronunciation"),
    stationNamePronunciation: lastFormString(formData, "stationNamePronunciation"),
    genreIds: joinGenreIds(genreIds),
  };
}

/**
 * After a successful save: the submitted values are saved. Edits made while the save was running
 * stay unsaved; the refreshed page then brings the stored (trimmed) values for everything else.
 */
export function markProfileSaved(draft: ProfileDraft, submitted: ProfileValues): ProfileDraft {
  return { ...draft, baseline: submitted, conflicts: [] };
}

/** Undo the admin's edits: back to the latest saved values. */
export function discardProfileEdits(draft: ProfileDraft): ProfileDraft {
  return { ...draft, baseline: draft.server, values: draft.server, conflicts: [] };
}

/** Resolves every conflict in favour of the saved value (the admin's other edits stay). */
export function takeSavedValuesForConflicts(draft: ProfileDraft): ProfileDraft {
  const values = { ...draft.values };
  for (const field of draft.conflicts) values[field] = draft.server[field];
  return { ...draft, values, conflicts: [] };
}
