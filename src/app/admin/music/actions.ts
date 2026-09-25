"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, actionSuccess, describeDbError, type ActionState } from "@/lib/actions/state";
import { requireAdminAction } from "@/lib/auth/session";
import { removeTrackObjects } from "@/lib/data/admin/catalog";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { idSchema } from "@/lib/validation/fields";
import { formDataToObject, summarizeValidationError, toFieldErrors } from "@/lib/validation/forms";
import { trackBulkIdsSchema, trackMetadataUpdateSchema } from "@/lib/validation/tracks";

/**
 * Server Actions for /admin/music. Each one authenticates the admin first (requireAdminAction
 * redirects otherwise), validates its arguments with zod, and writes with the admin's OWN client
 * (RLS). The secret-key client is used only to delete Storage objects for a permanent deletion.
 * Uploads and file replacement go through /api/admin/uploads/* (signed upload URLs), not here.
 */

const INVALID_FORM = "The form could not be read. Reload the page and try again.";
const INVALID_TRACK = "This track could not be identified. Reload the page and try again.";
const TRACK_MISSING = "This track no longer exists. It may have been deleted by another admin — reload the page.";

interface DbError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

function revalidateMusic(): void {
  revalidatePath("/admin/music");
  // Genre track counts and the overview's library numbers change with every track edit.
  revalidatePath("/admin/genres");
  revalidatePath("/admin");
}

function dbFailure(context: string, error: DbError, fallback: string): ActionState {
  console.error(`[admin/music] ${context}`, error);
  return actionError(describeDbError(error, fallback));
}

function parseTrackId(trackId: unknown): string | null {
  const parsed = idSchema.safeParse(trackId);
  return parsed.success ? parsed.data : null;
}

/** Title, artist (blank ⇒ "Unknown Artist") and genres (repeated `genreIds`, replaced as a set). */
export async function updateTrackAction(trackId: string, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseTrackId(trackId);
  if (!id) return actionError(INVALID_TRACK);
  if (!(formData instanceof FormData)) return actionError(INVALID_FORM);

  const parsed = trackMetadataUpdateSchema.safeParse(formDataToObject(formData, { arrays: ["genreIds"] }));
  if (!parsed.success) return actionError(summarizeValidationError(parsed.error), toFieldErrors(parsed.error));
  const { title, artist, genreIds } = parsed.data;

  const updated = await supabase.from("tracks").update({ title, artist }).eq("id", id).select("id").maybeSingle();
  if (updated.error) return dbFailure("metadata update failed", updated.error, "The track could not be saved. Please try again.");
  if (!updated.data) {
    revalidateMusic();
    return actionError(TRACK_MISSING);
  }

  const assigned = await supabase.rpc("set_track_genres", { p_track_id: id, p_genre_ids: genreIds });
  revalidateMusic();
  if (assigned.error) {
    console.error("[admin/music] set_track_genres failed", assigned.error);
    if (assigned.error.code === "23503") {
      return actionError(
        "Title and artist were saved, but a selected genre no longer exists, so the genres were not changed. Choose the genres again.",
        { genreIds: "A selected genre no longer exists." },
      );
    }
    return actionError(`Title and artist were saved, but the genres could not be updated: ${describeDbError(assigned.error)}`);
  }

  return actionSuccess(
    genreIds.length === 0 ? `Saved “${title}”. It has no genre, so it won't play anywhere until you add one.` : `Saved “${title}”.`,
  );
}

const flagSchema = z.boolean({ error: "Choose active or inactive." });

/** Activate or deactivate a track (is_active). Venues' players re-check every track before playing it. */
export async function setTrackActiveAction(trackId: string, active: boolean): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseTrackId(trackId);
  const flag = flagSchema.safeParse(active);
  if (!id) return actionError(INVALID_TRACK);
  if (!flag.success) return actionError(summarizeValidationError(flag.error));

  const { data, error } = await supabase
    .from("tracks")
    .update({ is_active: flag.data })
    .eq("id", id)
    .select("title, removed_at")
    .maybeSingle();
  if (error) return dbFailure("enable/disable failed", error, "The track could not be updated. Please try again.");
  revalidateMusic();
  if (!data) return actionError(TRACK_MISSING);

  if (!flag.data) return actionSuccess(`“${data.title}” is inactive. Venues won't play it from their next track on.`);
  return actionSuccess(
    data.removed_at === null
      ? `“${data.title}” is active and back in rotation.`
      : `“${data.title}” is active, but it stays out of playback until you restore it.`,
  );
}

/**
 * Soft removal (removed_at = now): the track is excluded from all future playback, including tracks
 * that venues have already queued, because players re-validate each track before promoting it.
 */
export async function removeTrackAction(trackId: string): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseTrackId(trackId);
  if (!id) return actionError(INVALID_TRACK);

  const { data, error } = await supabase
    .from("tracks")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", id)
    .is("removed_at", null)
    .select("title")
    .maybeSingle();
  if (error) return dbFailure("remove failed", error, "The track could not be removed. Please try again.");
  revalidateMusic();
  if (!data) {
    const existing = await supabase.from("tracks").select("title, removed_at").eq("id", id).maybeSingle();
    if (existing.data?.removed_at) return actionSuccess(`“${existing.data.title}” was already removed from playback.`);
    return actionError(existing.error ? describeDbError(existing.error) : TRACK_MISSING);
  }
  return actionSuccess(`“${data.title}” was removed from playback. You can restore it from its “…” menu.`);
}

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Bulk activate/deactivate (is_active) for the selected tracks. Removed tracks keep their removal:
 * activating them only takes effect once they are restored.
 */
export async function setTracksActiveAction(trackIds: string[], active: boolean): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const ids = trackBulkIdsSchema.safeParse(trackIds);
  const flag = flagSchema.safeParse(active);
  if (!ids.success) return actionError(summarizeValidationError(ids.error));
  if (!flag.success) return actionError(summarizeValidationError(flag.error));

  const { data, error } = await supabase.from("tracks").update({ is_active: flag.data }).in("id", ids.data).select("id, removed_at");
  if (error) return dbFailure("bulk activate/deactivate failed", error, "The selected tracks could not be updated. Please try again.");
  revalidateMusic();

  const changed = data?.length ?? 0;
  if (changed === 0) return actionError("None of the selected tracks exist any more. Reload the page.");
  const parts = [
    flag.data
      ? `${countOf(changed, "track is", "tracks are")} active.`
      : `${countOf(changed, "track is", "tracks are")} inactive. Venues won't play ${changed === 1 ? "it" : "them"} from their next track on.`,
  ];
  const removed = flag.data ? (data ?? []).filter((row) => row.removed_at !== null).length : 0;
  if (removed > 0) {
    parts.push(`${countOf(removed, "of them is", "of them are")} still removed from playback until restored.`);
  }
  const missing = ids.data.length - changed;
  if (missing > 0) parts.push(`${countOf(missing, "selected track no longer exists", "selected tracks no longer exist")}.`);
  return actionSuccess(parts.join(" "));
}

/** Bulk soft removal (removed_at = now) of the selected tracks; already removed ones are left alone. */
export async function removeTracksAction(trackIds: string[]): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const ids = trackBulkIdsSchema.safeParse(trackIds);
  if (!ids.success) return actionError(summarizeValidationError(ids.error));

  const { data, error } = await supabase
    .from("tracks")
    .update({ removed_at: new Date().toISOString() })
    .in("id", ids.data)
    .is("removed_at", null)
    .select("id");
  if (error) return dbFailure("bulk remove failed", error, "The selected tracks could not be removed. Please try again.");
  revalidateMusic();

  const changed = data?.length ?? 0;
  const skipped = ids.data.length - changed;
  if (changed === 0) {
    return actionSuccess(
      ids.data.length === 1 ? "The selected track was already removed from playback." : "The selected tracks were already removed from playback.",
    );
  }
  const message = `${countOf(changed, "track was", "tracks were")} removed from playback. You can restore ${changed === 1 ? "it" : "them"} with the Removed filter.`;
  return actionSuccess(skipped > 0 ? `${message} ${countOf(skipped, "other was", "others were")} already removed or no longer exist.` : message);
}

/** Undo a removal (removed_at = null). An inactive track stays inactive. */
export async function restoreTrackAction(trackId: string): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseTrackId(trackId);
  if (!id) return actionError(INVALID_TRACK);

  const { data, error } = await supabase
    .from("tracks")
    .update({ removed_at: null })
    .eq("id", id)
    .not("removed_at", "is", null)
    .select("title, is_active")
    .maybeSingle();
  if (error) return dbFailure("restore failed", error, "The track could not be restored. Please try again.");
  revalidateMusic();
  if (!data) {
    const existing = await supabase.from("tracks").select("title, removed_at").eq("id", id).maybeSingle();
    if (existing.data && existing.data.removed_at === null) return actionSuccess(`“${existing.data.title}” is already in the catalogue.`);
    return actionError(existing.error ? describeDbError(existing.error) : TRACK_MISSING);
  }
  return actionSuccess(
    data.is_active
      ? `“${data.title}” was restored and is back in rotation.`
      : `“${data.title}” was restored. It is still inactive — activate it to play it again.`,
  );
}

/**
 * Permanent deletion, only for removed tracks. The audio is deleted from Storage first (secret-key
 * client), then the row (admin's own client). If the row delete fails the track stays in the Removed
 * list without audio and the admin can simply retry: removing an already missing object succeeds.
 */
export async function deleteTrackAction(trackId: string): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const id = parseTrackId(trackId);
  if (!id) return actionError(INVALID_TRACK);

  const { data: track, error } = await supabase.from("tracks").select("id, title, storage_path, removed_at").eq("id", id).maybeSingle();
  if (error) return dbFailure("delete: lookup failed", error, "The track could not be deleted. Please try again.");
  if (!track) {
    revalidateMusic();
    return actionError(TRACK_MISSING);
  }
  if (track.removed_at === null) {
    return actionError("Only tracks that were removed from playback can be deleted permanently. Remove it first.");
  }

  let removal: Awaited<ReturnType<typeof removeTrackObjects>>;
  try {
    removal = await removeTrackObjects(createSupabaseAdminClient(), track.id, track.storage_path);
  } catch (cause) {
    // createSupabaseAdminClient() throws when the secret key is not configured.
    console.error("[admin/music] delete: storage client unavailable", cause);
    return actionError("The audio file could not be deleted because file storage is not configured on this server. Nothing was deleted.");
  }
  if (!removal.ok) {
    console.error(`[admin/music] delete: could not remove the audio of track ${track.id}`, removal.cause);
    return actionError("The audio file could not be deleted from storage, so the track was kept. Please try again.");
  }

  const deleted = await supabase.from("tracks").delete().eq("id", track.id).not("removed_at", "is", null).select("id").maybeSingle();
  revalidateMusic();
  if (deleted.error) {
    console.error(`[admin/music] delete: audio removed but the row of track ${track.id} was not deleted`, deleted.error);
    return actionError(
      `The audio file was deleted, but the track entry could not be removed: ${describeDbError(deleted.error)} Try “Delete permanently” again.`,
    );
  }
  if (!deleted.data) {
    return actionError(
      "The track changed while it was being deleted (it may have been restored). Its audio file is gone — use “Replace file” to upload it again, or remove and delete it.",
    );
  }
  return actionSuccess(`“${track.title}” was deleted permanently.`);
}
