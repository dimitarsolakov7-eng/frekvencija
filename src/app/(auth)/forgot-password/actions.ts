"use server";

import { headers } from "next/headers";
import type { ActionState } from "@/lib/actions/state";
import { EnvError, getSiteUrl, isSupabaseConfigured } from "@/lib/env";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/forms";
import {
  authRateLimit,
  clientIpFromHeaders,
  globalAuthRateLimit,
  RESET_EMAIL_LIMIT,
  RESET_GLOBAL_LIMIT,
  RESET_IP_LIMIT,
} from "../_lib/request";
import { echoEmail, passwordResetRequestSchema } from "../_lib/schemas";

export type ResetRequestValues = { email: string };
export type ResetRequestState = ActionState<ResetRequestValues>;

/**
 * The same confirmation is shown whether or not an account exists (and whether or not Supabase
 * reported an error for it), so this form cannot be used to discover accounts.
 */
function neutralConfirmation(email: string): ResetRequestState {
  return {
    ok: true,
    message:
      `If an account exists for ${email}, we’ve emailed it a link to choose a new password. ` +
      "The link works once and expires after about an hour. If nothing arrives within a few minutes, " +
      "check your spam folder or ask your administrator for help.",
    fieldErrors: {},
    values: { email },
    nonce: Date.now(),
  };
}

function failure(message: string, values: ResetRequestValues, fieldErrors: Record<string, string> = {}): ResetRequestState {
  return { ok: false, message, fieldErrors, values, nonce: Date.now() };
}

export async function requestPasswordReset(
  _previous: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const values: ResetRequestValues = { email: echoEmail(formData.get("email")) };
  const parsed = passwordResetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return failure("Enter the email address you sign in with.", values, toFieldErrors(parsed.error));
  }
  const { email } = parsed.data;

  // Resolved before any account-specific work: a configuration problem is the same for every email.
  if (!isSupabaseConfigured()) {
    return failure("Password reset isn’t available yet: the service is not configured.", values);
  }
  let redirectTo: string;
  try {
    redirectTo = getSiteUrl();
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    console.error("[auth] password reset unavailable:", error.message);
    return failure("Password reset isn’t available right now. Please contact your administrator.", values);
  }

  const ip = clientIpFromHeaders(await headers());
  const byIp = await consumeRateLimit(authRateLimit(RESET_IP_LIMIT, ip));
  if (!byIp.allowed) {
    return failure("Too many reset requests from this network. Please wait a while and try again.", values);
  }
  const byEmail = await consumeRateLimit(authRateLimit(RESET_EMAIL_LIMIT, email));
  // Per-address limit reached: send nothing, but answer exactly as usual (no account enumeration).
  if (!byEmail.allowed) return neutralConfirmation(email);
  // Cap across all visitors, independent of the (possibly forged) client IP. It says nothing about any
  // one account, so it can be reported honestly.
  const overall = await consumeRateLimit(globalAuthRateLimit(RESET_GLOBAL_LIMIT));
  if (!overall.allowed) {
    return failure(
      "We’re receiving an unusually large number of reset requests. Please try again in an hour, or ask your administrator for help.",
      values,
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      // Supabase only errors for existing accounts (e.g. email quota), so the reply stays neutral.
      console.warn("[auth] password reset email not sent", { code: error.code, status: error.status });
    }
  } catch (error) {
    console.error("[auth] password reset request failed", error);
  }
  return neutralConfirmation(email);
}
