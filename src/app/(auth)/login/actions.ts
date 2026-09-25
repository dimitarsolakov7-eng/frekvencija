"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/actions/state";
import { loadSessionContext } from "@/lib/auth/session";
import { EnvError, isSupabaseConfigured } from "@/lib/env";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toFieldErrors } from "@/lib/validation/forms";
import {
  AUTH_UNAVAILABLE_MESSAGE,
  describeSignInError,
  TOO_MANY_SIGN_IN_ATTEMPTS_MESSAGE,
} from "../_lib/auth-errors";
import { resolvePostLoginPath } from "../_lib/redirects";
import { authRateLimit, clientIpFromHeaders, LOGIN_EMAIL_LIMIT, LOGIN_IP_LIMIT } from "../_lib/request";
import { echoEmail, signInSchema } from "../_lib/schemas";

export type SignInValues = { email: string };
export type SignInState = ActionState<SignInValues>;

function failure(message: string, values: SignInValues, fieldErrors: Record<string, string> = {}): SignInState {
  return { ok: false, message, fieldErrors, values, nonce: Date.now() };
}

const NOT_CONFIGURED_MESSAGE = "Signing in isn’t available yet: the service is not configured.";

/**
 * Email + password sign-in. Errors never reveal whether the email or the password was wrong; on
 * success the user goes to a sanitised `next` path or to their role's home page.
 */
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const values: SignInValues = { email: echoEmail(formData.get("email")) };
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) {
    return failure("Enter your email address and password.", values, toFieldErrors(parsed.error));
  }
  const { email, password } = parsed.data;
  // Setup mode: the page renders, but there is nothing to sign in against yet.
  if (!isSupabaseConfigured()) return failure(NOT_CONFIGURED_MESSAGE, values);

  const ip = clientIpFromHeaders(await headers());
  const [byEmail, byIp] = await Promise.all([
    consumeRateLimit(authRateLimit(LOGIN_EMAIL_LIMIT, email)),
    consumeRateLimit(authRateLimit(LOGIN_IP_LIMIT, ip)),
  ]);
  if (!byEmail.allowed || !byIp.allowed) {
    return failure(TOO_MANY_SIGN_IN_ATTEMPTS_MESSAGE, values);
  }

  let destination: string | null = null;
  let errorMessage: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const described = describeSignInError(error);
      if (described.unexpected) console.error("[auth] sign-in failed", error);
      errorMessage = described.message;
    } else {
      // The new session is already in this client's storage, so the role lookup runs as the user.
      let session: Awaited<ReturnType<typeof loadSessionContext>> = null;
      try {
        session = await loadSessionContext(supabase);
      } catch (lookupError) {
        console.error("[auth] role lookup after sign-in failed", lookupError);
      }
      // "/" resolves the role again (and explains a lookup failure) if it could not be read here.
      destination = session ? resolvePostLoginPath(formData.get("next"), session.role) : "/";
    }
  } catch (error) {
    if (error instanceof EnvError) {
      errorMessage = NOT_CONFIGURED_MESSAGE;
    } else {
      console.error("[auth] sign-in failed", error);
      errorMessage = AUTH_UNAVAILABLE_MESSAGE;
    }
  }

  if (errorMessage !== null || destination === null) {
    return failure(errorMessage ?? AUTH_UNAVAILABLE_MESSAGE, values);
  }
  redirect(destination);
}
