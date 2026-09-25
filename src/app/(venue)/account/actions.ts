"use server";

import { headers } from "next/headers";
import { authRateLimit, clientIpFromHeaders, RESET_EMAIL_LIMIT, RESET_IP_LIMIT } from "@/app/(auth)/_lib/request";
import type { ActionState } from "@/lib/actions/state";
import { requireBusinessUserPage } from "@/lib/auth/session";
import { EnvError, getSiteUrl, isSupabaseConfigured } from "@/lib/env";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function result(ok: boolean, message: string): ActionState {
  return { ok, message, fieldErrors: {}, nonce: Date.now() };
}

/**
 * /account "Send password reset email": asks Supabase Auth to email a reset link to the signed-in
 * user's OWN address (taken from the session, never from the form), returning to the site origin
 * (the email template leads to /auth/confirm → /reset-password). Rate-limited with the same buckets
 * as Forgot password; the confirmation is neutral because delivery can't be confirmed here.
 *
 * Used with useActionState: the previous state and the (empty) form data it passes are not needed.
 */
export async function sendAccountPasswordReset(): Promise<ActionState> {
  const ctx = await requireBusinessUserPage("/account");
  const email = ctx.email.trim().toLowerCase();
  if (!email) {
    return result(false, "This account has no email address, so a reset link can’t be sent. Ask your administrator for help.");
  }

  if (!isSupabaseConfigured()) {
    return result(false, "Password reset isn’t available yet: the service is not configured.");
  }
  let redirectTo: string;
  try {
    redirectTo = getSiteUrl();
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    console.error("[venue] password reset unavailable:", error.message);
    return result(false, "Password reset isn’t available right now. Please contact your administrator.");
  }

  const ip = clientIpFromHeaders(await headers());
  const byIp = await consumeRateLimit(authRateLimit(RESET_IP_LIMIT, ip));
  if (!byIp.allowed) {
    return result(false, "Too many reset requests from this network. Please wait a while and try again.");
  }
  const byEmail = await consumeRateLimit(authRateLimit(RESET_EMAIL_LIMIT, email));
  if (!byEmail.allowed) {
    return result(false, "Several reset emails were requested recently. Please wait up to an hour, and check your inbox and spam folder.");
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) console.warn("[venue] password reset email not sent", { code: error.code, status: error.status });
  } catch (error) {
    console.error("[venue] password reset request failed", error);
  }
  return result(
    true,
    `We’ve asked for a reset link to be sent to ${email}. It works once and expires after about an hour. ` +
      "If nothing arrives within a few minutes, check your spam folder or ask your administrator.",
  );
}
