import type { GenreTracksResponse } from "@/lib/api/contracts";
import { jsonError, jsonOk, jsonServerError } from "@/lib/api/http";
import { requireBusinessUserApi } from "@/lib/auth/session";
import { isGenreVisible, listGenreTracks } from "@/lib/data/player";
import { idSchema } from "@/lib/validation/fields";

export const dynamic = "force-dynamic";

/**
 * GET /api/player/genres/[genreId]/tracks — playable tracks of a genre the caller's venue may use.
 * 404 not_found when the genre is not visible under RLS (disabled, unassigned or unknown).
 */
export async function GET(_request: Request, context: RouteContext<"/api/player/genres/[genreId]/tracks">) {
  try {
    const access = await requireBusinessUserApi();
    if (!access.ok) return access.response;
    const { supabase } = access;

    const { genreId: rawGenreId } = await context.params;
    const parsed = idSchema.safeParse(rawGenreId);
    if (!parsed.success) {
      return jsonError(400, "invalid_request", "The genre id is not valid.", { genreId: "Invalid id." });
    }
    const genreId = parsed.data;

    const [visible, tracks] = await Promise.all([isGenreVisible(supabase, genreId), listGenreTracks(supabase, genreId)]);
    if (!visible) {
      return jsonError(404, "not_found", "This genre is not available to your venue.");
    }

    const body: GenreTracksResponse = { genreId, tracks, fetchedAt: new Date().toISOString() };
    return jsonOk(body);
  } catch (error) {
    return jsonServerError("player genre tracks failed", error);
  }
}
