"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { chunk, diffGenreAccess, genreConflictField } from "@/components/admin/catalog/genre-helpers";
import { actionError, actionSuccess, describeDbError, type ActionState } from "@/lib/actions/state";
import { requireAdminAction } from "@/lib/auth/session";
import { loadGenreAccessBusinessIds, nextGenreSortOrder } from "@/lib/data/admin/catalog";
import { idArray, idSchema } from "@/lib/validation/fields";
import { formDataToObject, summarizeValidationError, toFieldErrors } from "@/lib/validation/forms";
import { genreCreateSchema, genreReorderSchema, genreUpdateSchema, type GenreUpdateInput } from "@/lib/validation/genres";
import type { TablesUpdate } from "@/types/database";

/**
 * Server Actions for /admin/genres. Every action authenticates the admin first
 * (requireAdminAction redirects otherwise), validates its arguments with zod — action endpoints are
 * public, so a forged call may send anything — and writes with the admin's OWN Supabase client, so
 * the RLS admin policies decide. Expected failures are returned as ActionState, never thrown.
 */

const INVALID_FORM = "The form could not be read. Reload the page and try again.";
const INVALID_GENRE = "This genre could not be identified. Reload the page and try again.";
const GENRE_MISSING = "This genre no longer exists. It may have been deleted by another admin — reload the page.";
/** Businesses per insert statement / `in (...)` filter when changing access rows. */
const ACCESS_INSERT_CHUNK = 500;
const ACCESS_DELETE_CHUNK = 100;

const businessIdsSchema = idArray("Businesses", 5000);

type AdminClient = Awaited<ReturnType<typeof requireAdminAction>>["supabase"];

interface DbError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

function revalidateCatalog(): void {
  revalidatePath("/admin/genres");
  // Genre names and counts also appear in the music filters and on the overview.
  revalidatePath("/admin/music");
  revalidatePath("/admin");
}

function dbFailure(context: string, error: DbError, fallback: string): ActionState {
  console.error(`[admin/genres] ${context}`, error);
  return actionError(describeDbError(error, fallback));
}

/** 23505 on genres ⇒ a field error on the input that clashed. */
function conflictState(error: DbError): ActionState {
  switch (genreConflictField(error)) {
    case "slug":
      return actionError("Another genre already uses this slug.", {
        slug: "Another genre already uses this slug. Choose a different one.",
      });
    case "name":
      return actionError("A genre with this name already exists.", {
        name: "Another genre already has this name (upper and lower case count as the same).",
      });
    default:
      return actionError("A genre with the same name or slug already exists.");
  }
}

function parseGenreId(genreId: unknown): string | null {
  const parsed = idSchema.safeParse(genreId);
  return parsed.success ? parsed.data : null;
}

/** Inserts access rows (idempotent) and deletes removed ones; returns a failure state or null. */
async function applyAccessChanges(
  supabase: AdminClient,
  genreId: string,
  toAdd: readonly string[],
  toRemove: readonly string[],
): Promise<{ ok: true } | { ok: false; stage: "add" | "remove"; error: DbError }> {
  for (const businessIds of chunk(toAdd, ACCESS_INSERT_CHUNK)) {
    const { error } = await supabase
      .from("business_genre_access")
      .upsert(
        businessIds.map((businessId) => ({ business_id: businessId, genre_id: genreId })),
        { onConflict: "business_id,genre_id", ignoreDuplicates: true },
      );
    if (error) return { ok: false, stage: "add", error };
  }
  for (const businessIds of chunk(toRemove, ACCESS_DELETE_CHUNK)) {
    const { error } = await supabase.from("business_genre_access").delete().eq("genre_id", genreId).in("business_id", businessIds);
    if (error) return { ok: false, stage: "remove", error };
  }
  return { ok: true };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Create / edit / delete
// ---------------------------------------------------------------------------

/**
 * New genre. Fields: name, slug (blank ⇒ derived from the name), description, isEnabled,
 * availableToAll ("true"/"false"), and businessIds (repeated; only used when availableToAll is false).
 * When the genre was created but its access rows failed, the result is not ok and carries
 * `values.createdGenreId` so the form knows not to submit again.
 */
export async function createGenreAction(formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  if (!(formData instanceof FormData)) return actionError(INVALID_FORM);

  const raw = formDataToObject(formData, { arrays: ["businessIds"] });
  const { businessIds: rawBusinessIds, ...fields } = raw;
  const parsed = genreCreateSchema.safeParse(fields);
  const businessIds = businessIdsSchema.safeParse(rawBusinessIds ?? []);
  if (!parsed.success) return actionError(summarizeValidationError(parsed.error), toFieldErrors(parsed.error));
  if (!businessIds.success) {
    return actionError("The selected businesses could not be read. Reload the page and try again.", { businessIds: summarizeValidationError(businessIds.error) });
  }
  const input = parsed.data;

  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    try {
      sortOrder = await nextGenreSortOrder(supabase);
    } catch (error) {
      console.error("[admin/genres] create: could not read the current order", error);
      return actionError("The genre could not be created. Please try again.");
    }
  }

  const { data: genre, error } = await supabase
    .from("genres")
    .insert({
      name: input.name,
      slug: input.slug,
      description: input.description,
      is_enabled: input.isEnabled,
      available_to_all: input.availableToAll,
      sort_order: sortOrder,
    })
    .select("id, name")
    .single();
  if (error) {
    if (error.code === "23505") return conflictState(error);
    return dbFailure("create failed", error, "The genre could not be created. Please try again.");
  }

  const assigned = input.availableToAll ? [] : businessIds.data;
  if (assigned.length > 0) {
    const access = await applyAccessChanges(supabase, genre.id, assigned, []);
    revalidateCatalog();
    if (!access.ok) {
      console.error("[admin/genres] create: access rows failed", access.error);
      // Not ok (something failed), but the genre exists: `values.createdGenreId` tells the form to close.
      return actionError(
        `Genre “${genre.name}” was created, but business access could not be saved: ${describeDbError(access.error)} Choose the businesses again under Availability and save.`,
        {},
        { createdGenreId: genre.id },
      );
    }
    return created(`Genre “${genre.name}” created for ${plural(assigned.length, "business", "businesses")}.`, genre.id);
  }

  revalidateCatalog();
  return created(
    input.availableToAll
      ? `Genre “${genre.name}” created.`
      : `Genre “${genre.name}” created. No business has access yet — choose them under Availability.`,
    genre.id,
  );
}

/** Success state of a creation; `values.createdGenreId` lets the editor select the new genre. */
function created(message: string, genreId: string): ActionState {
  return { ...actionSuccess(message), values: { createdGenreId: genreId } };
}

/** Database patch for the fields a genre form submitted (omitted ⇒ unchanged). */
function genrePatch(input: GenreUpdateInput): TablesUpdate<"genres"> {
  const patch: TablesUpdate<"genres"> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.description !== undefined) patch.description = input.description;
  if (input.isEnabled !== undefined) patch.is_enabled = input.isEnabled;
  if (input.availableToAll !== undefined) patch.available_to_all = input.availableToAll;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  return patch;
}

/** Rename / change slug / description. Omitted fields are unchanged; a blank slug keeps the current one. */
export async function updateGenreAction(genreId: string, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseGenreId(genreId);
  if (!id) return actionError(INVALID_GENRE);
  if (!(formData instanceof FormData)) return actionError(INVALID_FORM);

  const parsed = genreUpdateSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return actionError(summarizeValidationError(parsed.error), toFieldErrors(parsed.error));
  const patch = genrePatch(parsed.data);
  if (Object.keys(patch).length === 0) return actionError("There is nothing to save.");

  const { data, error } = await supabase.from("genres").update(patch).eq("id", id).select("id, name").maybeSingle();
  if (error) {
    if (error.code === "23505") return conflictState(error);
    return dbFailure("update failed", error, "The genre could not be saved. Please try again.");
  }
  if (!data) return actionError(GENRE_MISSING);

  revalidateCatalog();
  return actionSuccess(`Saved “${data.name}”.`);
}

type GenreSummaryRow = { id: string; name: string; available_to_all: boolean };

/**
 * The genre editor's "Save changes": name, slug (blank ⇒ unchanged), description, active state and
 * availability in one step. When the form lists businesses (`accessListed=true`, sent while
 * Availability is "Selected businesses", with repeated `businessIds`), the genre's
 * business_genre_access rows become exactly that set, as setGenreAccessAction does. Switching to
 * "All businesses" keeps the rows (they only matter while the genre is limited), so switching back
 * restores the previous selection.
 */
export async function saveGenreAction(genreId: string, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseGenreId(genreId);
  if (!id) return actionError(INVALID_GENRE);
  if (!(formData instanceof FormData)) return actionError(INVALID_FORM);

  const { businessIds: rawBusinessIds, accessListed, ...fields } = formDataToObject(formData, { arrays: ["businessIds"] });
  const parsed = genreUpdateSchema.safeParse(fields);
  if (!parsed.success) return actionError(summarizeValidationError(parsed.error), toFieldErrors(parsed.error));
  const listsAccess = accessListed === "true";
  const businessIds = businessIdsSchema.safeParse(rawBusinessIds ?? []);
  if (listsAccess && !businessIds.success) {
    return actionError("The selected businesses could not be read. Reload the page and try again.", {
      businessIds: summarizeValidationError(businessIds.error),
    });
  }
  const patch = genrePatch(parsed.data);
  if (Object.keys(patch).length === 0 && !listsAccess) return actionError("There is nothing to save.");

  let genre: GenreSummaryRow | null;
  if (Object.keys(patch).length > 0) {
    const { data, error } = await supabase.from("genres").update(patch).eq("id", id).select("id, name, available_to_all").maybeSingle();
    if (error) {
      if (error.code === "23505") return conflictState(error);
      return dbFailure("save failed", error, "The genre could not be saved. Please try again.");
    }
    genre = data;
  } else {
    const { data, error } = await supabase.from("genres").select("id, name, available_to_all").eq("id", id).maybeSingle();
    if (error) return dbFailure("save: genre lookup failed", error, "The genre could not be saved. Please try again.");
    genre = data;
  }
  if (!genre) {
    revalidateCatalog();
    return actionError(GENRE_MISSING);
  }
  if (!listsAccess || !businessIds.success) {
    revalidateCatalog();
    return actionSuccess(`Saved “${genre.name}”.`);
  }

  let current: string[];
  try {
    current = await loadGenreAccessBusinessIds(supabase, genre.id);
  } catch (error) {
    console.error("[admin/genres] save: could not read current access rows", error);
    revalidateCatalog();
    return actionError(`“${genre.name}” was saved, but its business access could not be read, so it was not changed. Please save again.`);
  }

  const desired = businessIds.data;
  const { toAdd, toRemove } = diffGenreAccess(current, desired);
  const result = toAdd.length > 0 || toRemove.length > 0 ? await applyAccessChanges(supabase, genre.id, toAdd, toRemove) : ({ ok: true } as const);
  revalidateCatalog();
  if (!result.ok) {
    console.error(`[admin/genres] save: access ${result.stage} failed`, result.error);
    const detail =
      result.stage === "add" && result.error.code === "23503"
        ? "One of the selected businesses no longer exists. Reload the page and choose again."
        : describeDbError(result.error);
    return actionError(`“${genre.name}” was saved, but business access could not be updated: ${detail}`);
  }
  const summary =
    desired.length === 0
      ? "No business has access yet, so no venue can choose it."
      : `${plural(desired.length, "business has", "businesses have")} access.`;
  return actionSuccess(`Saved “${genre.name}”. ${summary}`);
}

/**
 * Deletes a genre. Its track links, business access rows and saved venue preferences go with it
 * (foreign keys cascade / set null); the tracks and their audio stay in the catalogue. The genre's
 * cover image is deleted from Storage afterwards (best effort, with the admin's own client).
 */
export async function deleteGenreAction(genreId: string): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseGenreId(genreId);
  if (!id) return actionError(INVALID_GENRE);

  const { data, error } = await supabase.from("genres").delete().eq("id", id).select("id, name, cover_path").maybeSingle();
  if (error) return dbFailure("delete failed", error, "The genre could not be deleted. Please try again.");
  if (!data) {
    revalidateCatalog();
    return actionError(GENRE_MISSING);
  }

  revalidateCatalog();
  if (data.cover_path) await removeCoverObject(supabase, data.cover_path, "delete");
  return actionSuccess(`Genre “${data.name}” deleted. Its tracks are still in the music catalogue.`);
}

// ---------------------------------------------------------------------------
// Cover image (uploads go through /api/admin/uploads/*, kind "genre-cover")
// ---------------------------------------------------------------------------

/**
 * Deletes a cover object from bucket `genre-covers` with the admin's own client (Storage policy
 * "genre-covers: admin delete"). Never throws; a failure only leaves an unreferenced file behind.
 */
async function removeCoverObject(supabase: AdminClient, path: string, context: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage.from("genre-covers").remove([path]);
    if (error) {
      console.error(`[admin/genres] ${context}: could not delete genre-covers/${path}`, error);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[admin/genres] ${context}: could not delete genre-covers/${path}`, error);
    return false;
  }
}

/**
 * "Remove cover": clears genres.cover_path (guarded on the current value) so the genre shows its
 * default artwork again, then deletes the image from Storage.
 */
export async function removeGenreCoverAction(genreId: string): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseGenreId(genreId);
  if (!id) return actionError(INVALID_GENRE);

  const { data: genre, error } = await supabase.from("genres").select("id, name, cover_path").eq("id", id).maybeSingle();
  if (error) return dbFailure("remove cover: lookup failed", error, "The cover could not be removed. Please try again.");
  if (!genre) {
    revalidateCatalog();
    return actionError(GENRE_MISSING);
  }
  if (genre.cover_path === null) return actionSuccess(`“${genre.name}” has no cover; it shows the default artwork.`);

  const cleared = await supabase
    .from("genres")
    .update({ cover_path: null })
    .eq("id", genre.id)
    .eq("cover_path", genre.cover_path)
    .select("id")
    .maybeSingle();
  if (cleared.error) return dbFailure("remove cover: update failed", cleared.error, "The cover could not be removed. Please try again.");
  revalidateCatalog();
  if (!cleared.data) return actionError("The cover changed while it was being removed. Reload the page and try again.");

  const deleted = await removeCoverObject(supabase, genre.cover_path, "remove cover");
  return actionSuccess(
    deleted
      ? `Cover removed. “${genre.name}” shows its default artwork again.`
      : `Cover removed from “${genre.name}”; it shows its default artwork again. The image file could not be deleted from storage, but it is no longer used anywhere.`,
  );
}

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------

const flagSchema = z.boolean({ error: "Choose on or off." });

/**
 * Activate or deactivate a genre (is_enabled). Deactivation hides it from venues and their future
 * queues; it never deletes tracks or audio.
 */
export async function setGenreEnabledAction(genreId: string, enabled: boolean): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseGenreId(genreId);
  const flag = flagSchema.safeParse(enabled);
  if (!id) return actionError(INVALID_GENRE);
  if (!flag.success) return actionError(summarizeValidationError(flag.error));

  const { data, error } = await supabase.from("genres").update({ is_enabled: flag.data }).eq("id", id).select("name").maybeSingle();
  if (error) return dbFailure("enable/disable failed", error, "The genre could not be updated. Please try again.");
  if (!data) {
    revalidateCatalog();
    return actionError(GENRE_MISSING);
  }

  revalidateCatalog();
  return actionSuccess(
    flag.data
      ? `“${data.name}” is active. Venues with access can choose it.`
      : `“${data.name}” is inactive. Venues can no longer choose it; players on it are asked to pick another genre. Its tracks stay in the music library.`,
  );
}

export async function setGenreAvailabilityAction(genreId: string, availableToAll: boolean): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseGenreId(genreId);
  const flag = flagSchema.safeParse(availableToAll);
  if (!id) return actionError(INVALID_GENRE);
  if (!flag.success) return actionError(summarizeValidationError(flag.error));

  const { data, error } = await supabase
    .from("genres")
    .update({ available_to_all: flag.data })
    .eq("id", id)
    .select("name, business_genre_access(count)")
    .maybeSingle();
  if (error) return dbFailure("availability change failed", error, "The genre could not be updated. Please try again.");
  if (!data) {
    revalidateCatalog();
    return actionError(GENRE_MISSING);
  }

  revalidateCatalog();
  if (flag.data) return actionSuccess(`“${data.name}” is now available to every business.`);
  const assigned = Array.isArray(data.business_genre_access) ? (data.business_genre_access[0]?.count ?? 0) : 0;
  return actionSuccess(
    assigned === 0
      ? `“${data.name}” is now limited to selected businesses, but none are selected yet. Choose them under Availability.`
      : `“${data.name}” is now limited to ${plural(assigned, "assigned business", "assigned businesses")}.`,
  );
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/** Saves the complete display order (reorder_genres: sort_order = 1-based position). */
export async function reorderGenresAction(genreIds: string[]): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const parsed = genreReorderSchema.safeParse({ genreIds });
  if (!parsed.success) return actionError(summarizeValidationError(parsed.error));

  const { error } = await supabase.rpc("reorder_genres", { p_genre_ids: parsed.data.genreIds });
  if (error) {
    revalidateCatalog();
    if (error.code === "23503") {
      return actionError("A genre in the list no longer exists. The list has been refreshed — please try again.");
    }
    return dbFailure("reorder failed", error, "The new order could not be saved. Please try again.");
  }

  revalidateCatalog();
  return actionSuccess("Order saved.");
}

// ---------------------------------------------------------------------------
// Business access
// ---------------------------------------------------------------------------

/**
 * Makes `businessIds` exactly the businesses with an access row for this genre (inserts the new
 * ones, deletes the others). The rows matter while Availability is "Selected businesses".
 */
export async function setGenreAccessAction(genreId: string, businessIds: string[]): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseGenreId(genreId);
  if (!id) return actionError(INVALID_GENRE);
  const desired = businessIdsSchema.safeParse(businessIds);
  if (!desired.success) return actionError(summarizeValidationError(desired.error));

  const { data: genre, error: genreError } = await supabase.from("genres").select("id, name, available_to_all").eq("id", id).maybeSingle();
  if (genreError) return dbFailure("access: genre lookup failed", genreError, "Access could not be updated. Please try again.");
  if (!genre) {
    revalidateCatalog();
    return actionError(GENRE_MISSING);
  }

  let current: string[];
  try {
    current = await loadGenreAccessBusinessIds(supabase, genre.id);
  } catch (error) {
    console.error("[admin/genres] access: could not read current rows", error);
    return actionError("Access could not be updated. Please try again.");
  }

  const { toAdd, toRemove } = diffGenreAccess(current, desired.data);
  if (toAdd.length === 0 && toRemove.length === 0) return actionSuccess(`No changes to access for “${genre.name}”.`);

  const result = await applyAccessChanges(supabase, genre.id, toAdd, toRemove);
  revalidateCatalog();
  if (!result.ok) {
    console.error(`[admin/genres] access: ${result.stage} failed`, result.error);
    if (result.stage === "add") {
      return actionError(
        result.error.code === "23503"
          ? "One of the selected businesses no longer exists. The list has been refreshed — please choose again."
          : `Access could not be updated: ${describeDbError(result.error)}`,
      );
    }
    return actionError(
      toAdd.length > 0
        ? `New access was saved, but removing access failed: ${describeDbError(result.error)} Check the list and try again.`
        : `Access could not be removed: ${describeDbError(result.error)}`,
    );
  }

  const total = desired.data.length;
  const summary =
    total === 0
      ? `No business has access to “${genre.name}” now.`
      : `${plural(total, "business has", "businesses have")} access to “${genre.name}”.`;
  return actionSuccess(
    genre.available_to_all ? `${summary} This list applies when Availability is set to “Selected businesses”.` : summary,
  );
}
