"use server";

import { headers } from "next/headers";
import { connection } from "next/server";
import type { ActionState } from "@/lib/actions/state";
import { canStoreAccessRequests, insertAccessRequest } from "@/lib/data/public";
import { EnvError } from "@/lib/env";
import { consumeRateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { toFieldErrors } from "@/lib/validation/forms";
import { HONEYPOT_FIELD, type RequestAccessValues } from "@/components/public/request-access-options";
import { clientIpFromHeaders, rateLimitKey } from "@/app/(auth)/_lib/request";
import { accessRequestSchema, echoRequestAccessValues } from "./_lib/schema";

/**
 * `outcome` is set on success: "sent" (stored as a new request) or "duplicate" (an open request for
 * this email already exists — answered as friendly information, not as an error).
 */
export type RequestAccessState = ActionState<RequestAccessValues> & { outcome?: "sent" | "duplicate" };

const NOT_CONFIGURED_MESSAGE =
  "Requests can’t be sent yet: the service is not configured. Please try again later.";
const UNAVAILABLE_MESSAGE = "Your request couldn’t be sent right now. Please try again in a few minutes.";
const TOO_MANY_FROM_NETWORK_MESSAGE =
  "Too many requests have been sent from this network. Please try again in an hour.";
const TOO_MANY_FOR_EMAIL_MESSAGE =
  "We’ve already received several requests for this email address today. Please try again tomorrow.";
const TOO_MANY_OVERALL_MESSAGE =
  "We’re receiving an unusually large number of requests right now. Please try again in an hour.";

/**
 * Stored requests across ALL visitors. Unlike the per-network bucket it reads no client header, so
 * neither a forged X-Forwarded-For nor a pool of real addresses can flood the owner's list. Consumed
 * last, so a client the narrower buckets already stop cannot use up everyone's budget.
 */
const GLOBAL_LIMIT = { key: "access-request:global", max: 30, windowSeconds: 3600, failClosed: true } as const;

function failure(message: string, values: RequestAccessValues, fieldErrors: Record<string, string> = {}): RequestAccessState {
  return { ok: false, message, fieldErrors, values, nonce: Date.now() };
}

function success(outcome: "sent" | "duplicate", values: RequestAccessValues): RequestAccessState {
  return {
    ok: true,
    outcome,
    message: outcome === "sent" ? "Thanks — we’ll be in touch." : "We already have your request.",
    fieldErrors: {},
    values,
    nonce: Date.now(),
  };
}

function rateLimitMessage(result: Extract<RateLimitResult, { allowed: false }>, limitedMessage: string): string {
  return result.reason === "limited" ? limitedMessage : UNAVAILABLE_MESSAGE;
}

/**
 * Public "Request access" form. Validates, rate-limits (5 per network per hour, 3 per email per day,
 * 30 from all visitors together per hour — all failing closed so an unavailable limiter cannot be used
 * to flood the list), then stores the request with the secret-key client for the owner to review.
 * Nothing is ever approved automatically.
 */
export async function requestAccess(_previous: RequestAccessState, formData: FormData): Promise<RequestAccessState> {
  const values = echoRequestAccessValues(formData);
  const parsed = accessRequestSchema.safeParse({
    businessName: formData.get("businessName"),
    businessType: formData.get("businessType"),
    contactName: formData.get("contactName"),
    email: formData.get("email"),
    phone: formData.get("phone") ?? "",
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) {
    return failure("Please check the highlighted fields.", values, toFieldErrors(parsed.error));
  }
  const input = parsed.data;
  const echoed: RequestAccessValues = { ...values, email: input.email };

  const honeypot = formData.get(HONEYPOT_FIELD);
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    // Almost certainly an automated submission: answer like a real one, store nothing.
    console.info("[public] access request ignored (honeypot field filled)");
    return success("sent", echoed);
  }

  if (!canStoreAccessRequests()) return failure(NOT_CONFIGURED_MESSAGE, echoed);
  await connection();

  const ip = clientIpFromHeaders(await headers());
  const byIp = await consumeRateLimit({
    key: rateLimitKey("access-request:ip", ip),
    max: 5,
    windowSeconds: 3600,
    failClosed: true,
  });
  if (!byIp.allowed) return failure(rateLimitMessage(byIp, TOO_MANY_FROM_NETWORK_MESSAGE), echoed);

  const byEmail = await consumeRateLimit({
    key: rateLimitKey("access-request:email", input.email),
    max: 3,
    windowSeconds: 86_400,
    failClosed: true,
  });
  if (!byEmail.allowed) return failure(rateLimitMessage(byEmail, TOO_MANY_FOR_EMAIL_MESSAGE), echoed);

  const overall = await consumeRateLimit(GLOBAL_LIMIT);
  if (!overall.allowed) return failure(rateLimitMessage(overall, TOO_MANY_OVERALL_MESSAGE), echoed);

  let client: TypedSupabaseClient;
  try {
    client = createSupabaseAdminClient();
  } catch (error) {
    if (error instanceof EnvError) return failure(NOT_CONFIGURED_MESSAGE, echoed);
    console.error("[public] access request: secret-key client unavailable", error);
    return failure(UNAVAILABLE_MESSAGE, echoed);
  }

  const result = await insertAccessRequest(client, {
    businessName: input.businessName,
    businessType: input.businessType,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    message: input.message,
  });
  if (result.ok) return success("sent", echoed);
  if (result.reason === "duplicate") return success("duplicate", echoed);
  return failure(UNAVAILABLE_MESSAGE, echoed);
}
