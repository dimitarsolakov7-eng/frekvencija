import { connection } from "next/server";
import { jsonError, jsonOk, jsonServerError } from "@/lib/api/http";
import { requireAdminApi } from "@/lib/auth/session";
import { EnvError } from "@/lib/env";
import { consumeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { ElevenLabsError, elevenLabsErrorToApi } from "@/lib/tts/elevenlabs";
import { getTtsOptions } from "@/lib/tts/options";

/**
 * GET /api/admin/tts/options → TtsOptionsResponse (admin only).
 *
 * - No ELEVENLABS_API_KEY, or a key ElevenLabs rejects ⇒ 200 `{ configured: false, reason }`, so the
 *   UI can explain that uploading MP3s still works.
 * - Transient provider problems (rate limit, outage, timeout) ⇒ the mapped error status
 *   (429 / 502 / 504) with an honest message; nothing is cached, so a retry tries again.
 * - `?refresh=1` bypasses the 10-minute cache (rate-limited, because it calls the provider).
 */
export const dynamic = "force-dynamic";

const REFRESH_RATE_LIMIT = { max: 10, windowSeconds: 600 } as const;

export async function GET(request: Request): Promise<Response> {
  const access = await requireAdminApi();
  if (!access.ok) return access.response;

  try {
    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
    if (forceRefresh) {
      // The limiter uses the secret-key client.
      await connection();
      const limit = await consumeRateLimit({ key: `tts-options-refresh:${access.ctx.userId}`, ...REFRESH_RATE_LIMIT, failClosed: false });
      if (!limit.allowed) return rateLimitErrorResponse(limit);
    }
    return jsonOk(await getTtsOptions({ forceRefresh }));
  } catch (error) {
    if (error instanceof ElevenLabsError) {
      const mapped = elevenLabsErrorToApi(error);
      console.warn(`[tts] options: ElevenLabs ${error.kind} (status ${error.status ?? "none"}, request ${error.requestId ?? "n/a"})`);
      return jsonError(mapped.status, mapped.code, mapped.message, mapped.fields);
    }
    if (error instanceof EnvError) {
      console.error("[tts] options: server configuration is incomplete", error);
      return jsonError(503, "unavailable", "Text-to-speech options are not available: the server configuration is incomplete.");
    }
    return jsonServerError("tts options failed", error);
  }
}
