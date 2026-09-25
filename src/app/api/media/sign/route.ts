import type { SignedMedia } from "@/lib/api/contracts";
import { jsonError, jsonOk, jsonServerError, readJson } from "@/lib/api/http";
import { requireBusinessUserApi } from "@/lib/auth/session";
import { findSignableAnnouncement, findSignableTrack } from "@/lib/data/player";
import { MediaSigningError, signAudioObject } from "@/lib/media/signing";
import { consumeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { signMediaRequestSchema } from "@/lib/validation/media";

export const dynamic = "force-dynamic";

/** Generous for one venue (≈1 sign per item plus retries), low enough to stop URL harvesting. */
const SIGN_RATE_LIMIT = { max: 900, windowSeconds: 600 } as const;

const TRACK_UNAVAILABLE = "This track is no longer available.";
const ANNOUNCEMENT_UNAVAILABLE = "This announcement is no longer available.";

/**
 * POST /api/media/sign — short-lived URL for one track or announcement. Eligibility is re-checked on
 * every call (the player relies on it before promoting a preloaded item), and the URL is signed with
 * the user's own client so Storage RLS applies a second time. 404 unavailable ⇒ the player skips it.
 */
export async function POST(request: Request) {
  try {
    const access = await requireBusinessUserApi();
    if (!access.ok) return access.response;
    const { ctx, supabase } = access;

    const parsed = await readJson(request, signMediaRequestSchema);
    if (!parsed.ok) return parsed.response;
    const item = parsed.data;

    const limit = await consumeRateLimit({
      key: `media-sign:${ctx.userId}`,
      max: SIGN_RATE_LIMIT.max,
      windowSeconds: SIGN_RATE_LIMIT.windowSeconds,
      failClosed: false,
    });
    if (!limit.allowed) return rateLimitErrorResponse(limit);

    if (item.kind === "track") {
      const track = await findSignableTrack(supabase, item.id, item.genreId);
      if (!track) return jsonError(404, "unavailable", TRACK_UNAVAILABLE);
      const signed = await signOrUnavailable(() => signAudioObject(supabase, "music", track.storagePath, track.durationSeconds));
      if (!signed) return jsonError(404, "unavailable", TRACK_UNAVAILABLE);
      const body: SignedMedia = {
        kind: "track",
        id: track.id,
        url: signed.url,
        expiresAt: signed.expiresAt,
        durationSeconds: track.durationSeconds,
        title: track.title,
        artist: track.artist,
      };
      return jsonOk(body);
    }

    const announcement = await findSignableAnnouncement(supabase, ctx.business.id, item.id);
    if (!announcement) return jsonError(404, "unavailable", ANNOUNCEMENT_UNAVAILABLE);
    const signed = await signOrUnavailable(() =>
      signAudioObject(supabase, "announcements", announcement.audioPath, announcement.durationSeconds),
    );
    if (!signed) return jsonError(404, "unavailable", ANNOUNCEMENT_UNAVAILABLE);
    const body: SignedMedia = {
      kind: "announcement",
      id: announcement.id,
      url: signed.url,
      expiresAt: signed.expiresAt,
      durationSeconds: announcement.durationSeconds,
    };
    return jsonOk(body);
  } catch (error) {
    return jsonServerError("media signing failed", error);
  }
}

/**
 * Storage answering "not found / not visible" means the object is gone or RLS refused it: the item
 * is unavailable (null). Any other signing failure is re-thrown and becomes a 500.
 */
async function signOrUnavailable<T>(sign: () => Promise<T>): Promise<T | null> {
  try {
    return await sign();
  } catch (error) {
    if (error instanceof MediaSigningError && error.notFound) {
      console.warn(`[media] ${error.bucket} object not available for signing`, error.path);
      return null;
    }
    throw error;
  }
}
