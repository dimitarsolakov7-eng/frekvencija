/**
 * Pure helpers for /admin/genres (client-safe; unit-tested in tests/admin/catalog).
 */
import { MAX_SLUG_LENGTH, SLUG_PATTERN, slugify } from "@/lib/validation/genres";

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/**
 * Light clean-up while the admin types a slug: lower-case, and whitespace/underscores become a
 * hyphen. Anything else is left alone so a wrong character is reported instead of silently dropped.
 */
export function normalizeSlugInput(raw: string): string {
  return raw.toLowerCase().replace(/[\s_]+/g, "-");
}

/** The slug the server will store: the typed one, or one derived from the name when left blank. */
export function effectiveSlug(name: string, slugInput: string): string {
  const typed = slugInput.trim();
  return typed || slugify(name);
}

/** A user-facing problem with a typed slug, or null when it is blank (automatic) or valid. */
export function slugProblem(slugInput: string): string | null {
  const slug = slugInput.trim();
  if (!slug) return null;
  if (slug.length > MAX_SLUG_LENGTH) return `Use at most ${MAX_SLUG_LENGTH} characters.`;
  if (!SLUG_PATTERN.test(slug)) {
    return "Use lowercase letters a–z, digits and single hyphens, without a hyphen at the start or end.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

export type MoveDirection = "up" | "down";

/**
 * The full order after moving `id` one place up or down, or null when it cannot move (unknown id,
 * already first/last). The input is never mutated.
 */
export function moveInOrder(ids: readonly string[], id: string, direction: MoveDirection): string[] | null {
  const index = ids.indexOf(id);
  if (index === -1) return null;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return null;
  const next = [...ids];
  next[index] = ids[target];
  next[target] = id;
  return next;
}

/**
 * Sorts `items` into the order of `ids`. Items missing from `ids` keep their relative order after
 * the listed ones (same rule as the reorder_genres RPC); ids without an item are ignored.
 */
export function applyOrder<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const position = new Map<string, number>();
  ids.forEach((id, index) => {
    if (!position.has(id)) position.set(id, index);
  });
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const pa = position.get(a.item.id);
      const pb = position.get(b.item.id);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * The full order after moving `id` to `targetIndex` (clamped to the list), shifting the items in
 * between — the drag-and-drop move. Null when the id is unknown or already at that position.
 */
export function moveToIndex(ids: readonly string[], id: string, targetIndex: number): string[] | null {
  const index = ids.indexOf(id);
  if (index === -1 || !Number.isFinite(targetIndex)) return null;
  const target = Math.min(ids.length - 1, Math.max(0, Math.trunc(targetIndex)));
  if (target === index) return null;
  const next = ids.filter((candidate) => candidate !== id);
  next.splice(target, 0, id);
  return next;
}

/** True when both lists hold the same ids in the same order. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Lower-case, accents removed and whitespace collapsed, so "Café  Lounge" matches "cafe lounge". */
export function normalizeForSearch(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Client-side genre search over name, slug and description. An empty search matches everything. */
export function genreMatchesSearch(genre: { name: string; slug: string; description: string | null }, search: string): boolean {
  const needle = normalizeForSearch(search);
  if (!needle) return true;
  return [genre.name, genre.slug.replace(/-/g, " "), genre.description].some((text) => normalizeForSearch(text).includes(needle));
}

// ---------------------------------------------------------------------------
// Business access
// ---------------------------------------------------------------------------

export interface AccessDiff {
  /** Business ids to insert access rows for (in the order they were chosen). */
  toAdd: string[];
  /** Business ids whose access rows must be deleted (in their current order). */
  toRemove: string[];
}

/** Rows to insert and delete to turn the current access set into the desired one. */
export function diffGenreAccess(current: Iterable<string>, desired: Iterable<string>): AccessDiff {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  return {
    toAdd: [...desiredSet].filter((id) => !currentSet.has(id)),
    toRemove: [...currentSet].filter((id) => !desiredSet.has(id)),
  };
}

/** Splits a list into chunks (keeps PostgREST `in (...)` filters well under URL length limits). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += step) {
    chunks.push(items.slice(index, index + step));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export interface AvailabilitySummary {
  label: string;
  /** Businesses with access, by name (only for "Selected businesses"). */
  businessNames: string[];
  /** A warning when nobody can actually play the genre. */
  warning: string | null;
}

export function describeAvailability(
  genre: { availableToAll: boolean; isEnabled: boolean; accessBusinessIds: readonly string[] },
  businessesById: ReadonlyMap<string, { name: string; isActive: boolean }>,
): AvailabilitySummary {
  if (genre.availableToAll) {
    return { label: "All businesses", businessNames: [], warning: null };
  }
  const businesses = genre.accessBusinessIds
    .map((id) => businessesById.get(id))
    .filter((business): business is { name: string; isActive: boolean } => business !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  const count = businesses.length;
  let warning: string | null = null;
  if (count === 0) {
    warning = "No business has access yet, so no venue can choose this genre.";
  } else if (genre.isEnabled && businesses.every((business) => !business.isActive)) {
    warning = count === 1 ? "The only business with access is inactive." : "Every business with access is inactive.";
  }
  return {
    label: count === 1 ? "Selected businesses · 1 business" : `Selected businesses · ${count} businesses`,
    businessNames: businesses.map((business) => business.name),
    warning,
  };
}

/** "12 playable of 14 tracks", "No tracks yet", "3 tracks". */
export function describeTrackCounts(playable: number, total: number): string {
  if (total === 0) return "No tracks yet";
  if (playable === total) return total === 1 ? "1 track" : `${total} tracks`;
  return `${playable} playable of ${total} ${total === 1 ? "track" : "tracks"}`;
}

// ---------------------------------------------------------------------------
// Database errors
// ---------------------------------------------------------------------------

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/**
 * Which form field a unique violation (23505) on `genres` belongs to: the unique index on
 * lower(name) (`genres_name_lower_key`) or the slug constraint (`genres_slug_key`).
 */
export function genreConflictField(error: PostgrestLikeError | null | undefined): "name" | "slug" | null {
  if (error?.code !== "23505") return null;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  if (text.includes("genres_slug_key") || text.includes("(slug)")) return "slug";
  if (text.includes("genres_name_lower_key") || text.includes("lower(name)") || text.includes("(name)")) return "name";
  return null;
}
