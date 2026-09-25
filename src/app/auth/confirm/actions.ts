"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authLinkErrorCode, type AuthLinkErrorCode } from "@/app/(auth)/_lib/auth-errors";
import { defaultConfirmDestination, parseConfirmParams } from "@/app/(auth)/_lib/confirm";

function loginWithError(code: AuthLinkErrorCode): never {
  redirect(`/login?error=${code}`);
}

/**
 * Consumes a one-time email link (invite, recovery, email confirmation, magic link, or a PKCE code)
 * after the user pressed Continue, then continues to a sanitised relative path. Runs only on POST,
 * so link scanners that merely open the page never use up the token.
 */
export async function confirmEmailLink(formData: FormData): Promise<void> {
  const request = parseConfirmParams({
    token_hash: formData.get("token_hash"),
    type: formData.get("type"),
    next: formData.get("next"),
    code: formData.get("code"),
    sb_flow_id: formData.get("sb_flow_id"),
  });
  if (request.kind === "error") loginWithError(request.errorCode);
  if (request.kind === "invalid") loginWithError("link_invalid");

  let destination: string | null = null;
  let failure: AuthLinkErrorCode | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    if (request.kind === "otp") {
      const { error } = await supabase.auth.verifyOtp({ type: request.type, token_hash: request.tokenHash });
      if (error) {
        failure = authLinkErrorCode(error);
        console.warn("[auth] email link verification failed", { type: request.type, code: error.code, status: error.status });
      } else {
        destination = request.next;
      }
    } else {
      const { data, error } = await supabase.auth.exchangeCodeForSession(
        request.code,
        request.flowId ? { flowId: request.flowId } : undefined,
      );
      if (error) {
        failure = authLinkErrorCode(error);
        console.warn("[auth] auth code exchange failed", { code: error.code, status: error.status });
      } else {
        // auth-js adds `redirectType: "recovery"` for password-recovery codes (not in its types).
        const redirectType: unknown = (data as { redirectType?: unknown }).redirectType;
        destination = request.next ?? defaultConfirmDestination(redirectType === "recovery" ? "recovery-code" : null);
      }
    }
  } catch (error) {
    console.error("[auth] email link confirmation failed", error);
    failure = authLinkErrorCode(error);
  }

  if (failure !== null || destination === null) loginWithError(failure ?? "verify_failed");
  redirect(destination);
}
