/**
 * The genre editor's form state ("Edit genre" / "Add genre" panel on /admin/genres) as plain data:
 * built from a genre, compared with its baseline to warn about unsaved changes, re-based on fresh
 * server data without losing edits, and turned into the FormData the server actions read (only the
 * edited fields when saving). Pure and client-safe (unit-tested in tests/admin/catalog).
 */
import type { AdminGenreItem, BusinessOption } from "./types";

export const GENRE_NAME_MAX = 60;
export const GENRE_DESCRIPTION_MAX = 280;

export type GenreAvailability = "all" | "selected";

export const GENRE_AVAILABILITY_LABELS: Record<GenreAvailability, string> = {
  all: "All businesses",
  selected: "Selected businesses",
};

export interface GenreDraft {
  name: string;
  /** "" keeps the current slug (edit) or derives one from the name (create). */
  slug: string;
  description: string;
  isEnabled: boolean;
  availability: GenreAvailability;
  /** Businesses with access; only used while `availability` is "selected". */
  businessIds: string[];
}

export const EMPTY_GENRE_DRAFT: Readonly<GenreDraft> = Object.freeze({
  name: "",
  slug: "",
  description: "",
  isEnabled: true,
  availability: "all",
  businessIds: [],
});

/** Keeps known businesses only, in the picker's order (so comparisons ignore stale ids). */
export function orderBusinessIds(ids: Iterable<string>, businesses: readonly BusinessOption[]): string[] {
  const wanted = new Set(ids);
  return businesses.filter((business) => wanted.has(business.id)).map((business) => business.id);
}

/** Editor values for an existing genre. The slug field starts empty (= keep the current slug). */
export function genreDraftFromItem(genre: AdminGenreItem, businesses: readonly BusinessOption[]): GenreDraft {
  return {
    name: genre.name,
    slug: "",
    description: genre.description ?? "",
    isEnabled: genre.isEnabled,
    availability: genre.availableToAll ? "all" : "selected",
    businessIds: orderBusinessIds(genre.accessBusinessIds, businesses),
  };
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** Text fields are compared trimmed (that is what the server stores). */
function sameText(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/** Availability or, while "Selected businesses" is chosen, the business list differs. */
function accessChanged(draft: GenreDraft, baseline: GenreDraft): boolean {
  if (draft.availability !== baseline.availability) return true;
  return draft.availability === "selected" && !sameIdSet(draft.businessIds, baseline.businessIds);
}

/**
 * True when saving would change something: text is compared trimmed, and the business list only
 * counts while "Selected businesses" is chosen (it is not submitted otherwise).
 */
export function isGenreDraftDirty(draft: GenreDraft, baseline: GenreDraft): boolean {
  if (!sameText(draft.name, baseline.name)) return true;
  if (!sameText(draft.slug, baseline.slug)) return true;
  if (!sameText(draft.description, baseline.description)) return true;
  if (draft.isEnabled !== baseline.isEnabled) return true;
  return accessChanged(draft, baseline);
}

/**
 * Re-bases a draft that holds unsaved edits on fresh server values of the same genre (`fresh`,
 * from genreDraftFromItem), e.g. after "Deactivate genre", the card menu or another admin changed
 * it. Every field the admin has not edited takes the server's value, so the panel shows the genre
 * as it is now and a later Save cannot silently write an old value back; edited fields keep the
 * admin's value. `fresh` becomes the new baseline. Availability and the business list count as one
 * field.
 */
export function rebaseGenreDraft(values: GenreDraft, baseline: GenreDraft, fresh: GenreDraft): GenreDraft {
  const keepAccess = accessChanged(values, baseline);
  return {
    name: sameText(values.name, baseline.name) ? fresh.name : values.name,
    slug: sameText(values.slug, baseline.slug) ? fresh.slug : values.slug,
    description: sameText(values.description, baseline.description) ? fresh.description : values.description,
    isEnabled: values.isEnabled === baseline.isEnabled ? fresh.isEnabled : values.isEnabled,
    availability: keepAccess ? values.availability : fresh.availability,
    // The list only matters while "Selected businesses" is chosen; otherwise follow the server.
    businessIds: keepAccess && values.availability === "selected" ? values.businessIds : fresh.businessIds,
  };
}

/**
 * FormData for createGenreAction / saveGenreAction.
 *
 * - Without `baseline` (creating a genre) every field is sent; booleans as "true"/"false".
 * - With `baseline` (saving an existing genre) only the fields that differ from it are sent, and
 *   saveGenreAction leaves omitted fields unchanged. So Save writes what the admin edited and
 *   nothing else — it never re-activates a genre deactivated meanwhile ("Deactivate genre", the
 *   card menu, another admin), nor reverts any other change made elsewhere.
 *
 * The business list goes with "Selected businesses" (`accessListed=true` tells saveGenreAction to
 * replace the access rows, even with an empty list); with a baseline only when access changed.
 */
export function genreDraftFormData(draft: GenreDraft, baseline?: GenreDraft): FormData {
  const data = new FormData();
  const everything = baseline === undefined;
  if (everything || !sameText(draft.name, baseline.name)) data.set("name", draft.name);
  if (everything || !sameText(draft.slug, baseline.slug)) data.set("slug", draft.slug.trim());
  if (everything || !sameText(draft.description, baseline.description)) data.set("description", draft.description);
  if (everything || draft.isEnabled !== baseline.isEnabled) data.set("isEnabled", String(draft.isEnabled));
  if (everything || draft.availability !== baseline.availability) data.set("availableToAll", String(draft.availability === "all"));
  if (draft.availability === "selected" && (everything || accessChanged(draft, baseline))) {
    data.set("accessListed", "true");
    for (const id of draft.businessIds) data.append("businessIds", id);
  }
  return data;
}

/** Problems the browser can report before submitting (the server validates again). */
export function genreDraftProblems(draft: GenreDraft): { name?: string; description?: string } {
  const problems: { name?: string; description?: string } = {};
  const name = draft.name.trim();
  if (!name) problems.name = "Enter a genre name.";
  else if (name.length > GENRE_NAME_MAX) problems.name = `Use at most ${GENRE_NAME_MAX} characters.`;
  if (draft.description.trim().length > GENRE_DESCRIPTION_MAX) {
    problems.description = `Use at most ${GENRE_DESCRIPTION_MAX} characters.`;
  }
  return problems;
}
