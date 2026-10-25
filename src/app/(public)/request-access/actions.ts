"use server";

import { headers } from "next/headers";
import { connection } from "next/server";
import { getSiteCopy } from "@/content/site";
import type { TrialFormMessages } from "@/content/site/types";
import type { ActionState } from "@/lib/actions/state";
import { canStoreAccessRequests, insertAccessRequest, loadPublicGenres } from "@/lib/data/public";
import { EnvError } from "@/lib/env";
import { parseLocale } from "@/lib/i18n/locale";
import { GENRE_RECOMMENDATION, HONEYPOT_FIELD, type TrialRequestValues } from "@/lib/public/trial-request";
import { consumeRateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { toFieldErrors } from "@/lib/validation/forms";
import { clientIpFromHeaders, rateLimitKey } from "@/app/(auth)/_lib/request";
import { buildTrialRequestSchema, echoTrialRequestValues } from "./_lib/trial-schema";

/**
 * `outcome` is set on success: "sent" (stored as a new request) or "duplicate" (an open request for
 * this email already exists — answered as friendly information, not as an error).
 */
export type TrialRequestState = ActionState<TrialRequestValues> & { outcome?: "sent" | "duplicate" };

/**
 * Stored requests across ALL visitors. Unlike the per-network bucket it reads no client header, so
 * neither a forged X-Forwarded-For nor a pool of real addresses can flood the owner's list. Consumed
 * last, so a client the narrower buckets already stop cannot use up everyone's budget.
 */
const GLOBAL_LIMIT = { key: "access-request:global", max: 30, windowSeconds: 3600, failClosed: true } as const;

function failure(message: string, values: TrialRequestValues, fieldErrors: Record<string, string> = {}): TrialRequestState {
  return { ok: false, message, fieldErrors, values, nonce: Date.now() };
}

function success(outcome: "sent" | "duplicate", values: TrialRequestValues, messages: TrialFormMessages): TrialRequestState {
  return {
    ok: true,
    outcome,
    message: outcome === "sent" ? messages.sent : messages.duplicate,
    fieldErrors: {},
    values,
    nonce: Date.now(),
  };
}

function rateLimitMessage(result: Extract<RateLimitResult, { allowed: false }>, limited: string, unavailable: string): string {
  return result.reason === "limited" ? limited : unavailable;
}

/**
 * Public "Request a 3-day free trial" form. Validates in the visitor's language, rate-limits (5 per
 * network per hour, 3 per email per day, 30 from all visitors together per hour — all failing closed
 * so an unavailable limiter cannot be used to flood the list), then stores the request with the
 * secret-key client for the owner to review. Nothing is activated, approved or charged automatically.
 */
export async function requestTrial(_previous: TrialRequestState, formData: FormData): Promise<TrialRequestState> {
  const locale = parseLocale(typeof formData.get("locale") === "string" ? (formData.get("locale") as string) : null);
  const messages = getSiteCopy(locale).trial.messages;
  const values = echoTrialRequestValues(formData);

  // The genre list the visitor saw (the catalogue, or the default list before setup): a submitted
  // genre must be one of them, and its catalogue name is what the owner reads in the admin.
  const { genres } = await loadPublicGenres();
  const schema = buildTrialRequestSchema(
    messages,
    genres.map((genre) => genre.slug),
  );
  const parsed = schema.safeParse({
    venueName: formData.get("venueName"),
    venueType: formData.get("venueType"),
    city: formData.get("city"),
    contactName: formData.get("contactName"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? "",
    preferredGenre: formData.get("preferredGenre") ?? "",
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) {
    return failure(messages.checkFields, values, toFieldErrors(parsed.error));
  }
  const input = parsed.data;
  const echoed: TrialRequestValues = { ...values, email: input.email };

  const honeypot = formData.get(HONEYPOT_FIELD);
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    // Almost certainly an automated submission: answer like a real one, store nothing.
    console.info("[public] trial request ignored (honeypot field filled)");
    return success("sent", echoed, messages);
  }

  if (!canStoreAccessRequests()) return failure(messages.notConfigured, echoed);
  await connection();

  const ip = clientIpFromHeaders(await headers());
  const byIp = await consumeRateLimit({ key: rateLimitKey("access-request:ip", ip), max: 5, windowSeconds: 3600, failClosed: true });
  if (!byIp.allowed) return failure(rateLimitMessage(byIp, messages.tooManyFromNetwork, messages.unavailable), echoed);

  const byEmail = await consumeRateLimit({
    key: rateLimitKey("access-request:email", input.email),
    max: 3,
    windowSeconds: 86_400,
    failClosed: true,
  });
  if (!byEmail.allowed) return failure(rateLimitMessage(byEmail, messages.tooManyForEmail, messages.unavailable), echoed);

  const overall = await consumeRateLimit(GLOBAL_LIMIT);
  if (!overall.allowed) return failure(rateLimitMessage(overall, messages.tooManyOverall, messages.unavailable), echoed);

  let client: TypedSupabaseClient;
  try {
    client = createSupabaseAdminClient();
  } catch (error) {
    if (error instanceof EnvError) return failure(messages.notConfigured, echoed);
    console.error("[public] trial request: secret-key client unavailable", error);
    return failure(messages.unavailable, echoed);
  }

  const preferredGenre =
    input.preferredGenre === GENRE_RECOMMENDATION
      ? GENRE_RECOMMENDATION
      : (genres.find((genre) => genre.slug === input.preferredGenre)?.name ?? input.preferredGenre);

  const result = await insertAccessRequest(client, {
    businessName: input.venueName,
    businessType: input.venueType,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    message: input.message,
    city: input.city,
    preferredGenre,
  });
  if (result.ok) return success("sent", echoed, messages);
  if (result.reason === "duplicate") return success("duplicate", echoed, messages);
  return failure(messages.unavailable, echoed);
}
