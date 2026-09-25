import type { AnnouncementsResponse } from "@/lib/api/contracts";
import { jsonError, jsonOk, jsonServerError } from "@/lib/api/http";
import { ACCESS_DENIALS } from "@/lib/auth/access";
import { requireBusinessUserApi } from "@/lib/auth/session";
import { loadAnnouncementPlayback } from "@/lib/data/player";

export const dynamic = "force-dynamic";

/**
 * GET /api/player/announcements — the venue's playable announcements (id, placement, duration and
 * display text) plus its playback settings. The venue is always the one from the session; only
 * announcements approved at the current branding version are returned, and audio paths or review
 * state never leave the server.
 */
export async function GET() {
  try {
    const access = await requireBusinessUserApi();
    if (!access.ok) return access.response;
    const { ctx, supabase } = access;

    const playback = await loadAnnouncementPlayback(supabase, ctx.business.id);
    if (!playback) {
      // The membership disappeared between the session lookup and this query.
      const { status, code, message } = ACCESS_DENIALS.noBusiness;
      return jsonError(status, code, message);
    }

    const body: AnnouncementsResponse = {
      announcements: playback.announcements,
      settings: playback.settings,
      brandingVersion: playback.brandingVersion,
      fetchedAt: new Date().toISOString(),
    };
    return jsonOk(body);
  } catch (error) {
    return jsonServerError("player announcements failed", error);
  }
}
