import "server-only";
import { jsonError } from "@/lib/api/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface RateLimitOptions {
  /** Bucket key, namespaced by the caller, e.g. `upload-sign:${userId}`. */
  key: string;
  /** Allowed calls per window. */
  max: number;
  windowSeconds: number;
  /**
   * What to do when the limiter itself fails (DB unreachable, secret key missing):
   * true ⇒ deny (use for paid/abusable operations such as TTS), false ⇒ allow and log a warning.
   */
  failClosed: boolean;
}

export type RateLimitResult =
  | { allowed: true; degraded: boolean }
  | { allowed: false; reason: "limited" | "unavailable" };

const MAX_KEY_LENGTH = 200;

/**
 * Consumes one unit from a fixed-window bucket via `public.consume_rate_limit` (service role only).
 * `degraded: true` means the limiter failed open and the call was allowed without being counted.
 */
export async function consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, max, windowSeconds, failClosed } = options;
  if (!key || key.length > MAX_KEY_LENGTH) {
    throw new RangeError(`Rate limit key must be 1–${MAX_KEY_LENGTH} characters.`);
  }
  if (!Number.isInteger(max) || max < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new RangeError("Rate limit max and windowSeconds must be positive integers.");
  }

  let failure: unknown;
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("consume_rate_limit", {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (!error && typeof data === "boolean") {
      return data ? { allowed: true, degraded: false } : { allowed: false, reason: "limited" };
    }
    failure = error ?? new Error(`consume_rate_limit returned ${JSON.stringify(data)}`);
  } catch (error) {
    failure = error;
  }

  if (failClosed) {
    console.error(`[rate-limit] limiter unavailable for "${key}"; denying (fail closed).`, failure);
    return { allowed: false, reason: "unavailable" };
  }
  console.warn(`[rate-limit] limiter unavailable for "${key}"; allowing (fail open).`, failure);
  return { allowed: true, degraded: true };
}

/** JSON error for a denied result: 429 rate_limited, or 503 unavailable when the limiter failed closed. */
export function rateLimitErrorResponse(result: { allowed: false; reason: "limited" | "unavailable" }, retryAfterSeconds?: number): Response {
  if (result.reason === "unavailable") {
    return jsonError(503, "unavailable", "This action is temporarily unavailable. Please try again shortly.");
  }
  const response = jsonError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
  if (retryAfterSeconds !== undefined) response.headers.set("Retry-After", String(Math.ceil(retryAfterSeconds)));
  return response;
}
