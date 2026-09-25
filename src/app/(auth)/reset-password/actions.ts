"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/actions/state";
import { loadSessionContext, type SessionContext } from "@/lib/auth/session";
import { EnvError, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { describePasswordUpdateError, type PasswordUpdateFailure } from "../_lib/auth-errors";
import { validateNewPassword } from "../_lib/password";
import { homePathForRole } from "../_lib/redirects";

/** Password forms never echo values back. `sessionEnded` lets the form offer a way back in. */
export type ResetPasswordState = ActionState<Record<string, never>> & { sessionEnded?: boolean };

const RESET_PASSWORD_LOGIN = "/login?next=%2Freset-password";
const NOT_CONFIGURED_MESSAGE = "Passwords can’t be changed yet: the service is not configured.";

function failure(message: string, fieldErrors: Record<string, string> = {}, sessionEnded = false): ResetPasswordState {
  return { ok: false, message, fieldErrors, sessionEnded, nonce: Date.now() };
}

/**
 * Sets the signed-in user's own password (invite acceptance, recovery link, or a voluntary change).
 * Administrators never see or set passwords: this only ever acts on the caller's session.
 */
export async function resetPassword(_previous: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  if (!isSupabaseConfigured()) return failure(NOT_CONFIGURED_MESSAGE);

  let supabase: TypedSupabaseClient;
  let ctx: SessionContext | null;
  try {
    supabase = await createSupabaseServerClient();
    ctx = await loadSessionContext(supabase);
  } catch (error) {
    if (error instanceof EnvError) return failure(NOT_CONFIGURED_MESSAGE);
    console.error("[auth] session lookup before password update failed", error);
    return failure("We couldn’t confirm your session, so your password was not changed. Please try again.");
  }
  if (!ctx) redirect(RESET_PASSWORD_LOGIN);

  const check = validateNewPassword(formData.get("password"), formData.get("confirmPassword"));
  if (!check.ok) return failure("Please fix the highlighted fields.", check.fieldErrors);

  let problem: PasswordUpdateFailure | null = null;
  let cause: unknown = null;
  try {
    const { error } = await supabase.auth.updateUser({ password: check.password });
    if (error) {
      cause = error;
      problem = describePasswordUpdateError(error);
    }
  } catch (error) {
    cause = error;
    problem = { ...describePasswordUpdateError(error), unexpected: true };
  }
  if (problem) {
    if (problem.unexpected) console.error("[auth] password update failed", cause);
    return failure(problem.message, problem.fieldErrors, problem.sessionEnded);
  }

  redirect(homePathForRole(ctx.role));
}
