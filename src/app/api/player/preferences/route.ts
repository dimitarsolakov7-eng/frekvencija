import type { UpdatePreferencesResponse } from "@/lib/api/contracts";
import { jsonError, jsonOk, jsonServerError, readJson } from "@/lib/api/http";
import { requireBusinessUserApi } from "@/lib/auth/session";
import { isGenreVisible, savePlaybackPreferences } from "@/lib/data/player";
import { updatePreferencesRequestSchema } from "@/lib/validation/player";

export const dynamic = "force-dynamic";

const GENRE_UNAVAILABLE = "That genre is not available to your venue. Choose another genre.";

/**
 * PUT /api/player/preferences — saves the caller's genre/volume/mute for their venue. Omitted fields
 * stay unchanged. The user and venue come from the session; any ids in the body besides genreId are
 * ignored (the schema strips unknown keys).
 */
export async function PUT(request: Request) {
  try {
    const access = await requireBusinessUserApi();
    if (!access.ok) return access.response;
    const { ctx, supabase } = access;

    const parsed = await readJson(request, updatePreferencesRequestSchema);
    if (!parsed.ok) return parsed.response;
    const update = parsed.data;

    if (typeof update.genreId === "string" && !(await isGenreVisible(supabase, update.genreId))) {
      return jsonError(403, "forbidden", GENRE_UNAVAILABLE, { genreId: "This genre is not available." });
    }

    const result = await savePlaybackPreferences(supabase, ctx, update);
    if (!result.ok) {
      // RLS with-check backstop, e.g. the genre was unassigned between the check and the write.
      return jsonError(
        403,
        "forbidden",
        typeof update.genreId === "string" ? GENRE_UNAVAILABLE : "Your playback settings could not be saved for this venue.",
      );
    }

    const body: UpdatePreferencesResponse = { preferences: result.preferences };
    return jsonOk(body);
  } catch (error) {
    return jsonServerError("player preferences update failed", error);
  }
}
