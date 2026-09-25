import "server-only";
import { connection } from "next/server";
import { createAuthAdminPort, createAuthUserDirectory, type AuthAdminPort, type AuthUserDirectory } from "@/lib/data/admin/businesses";
import { EnvError, getServerEnv, getSiteUrl } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Explanations shown when the server lacks what invitations and sign-in statuses need. */
export const SECRET_KEY_MISSING_REASON =
  "SUPABASE_SECRET_KEY is not set on the server, so staff sign-in statuses can’t be read and invitations and password resets can’t be sent.";

/**
 * Why invitations / password resets can't be sent at all (secret key or site address missing), or
 * null when they can. Never throws.
 */
export function invitesUnavailableReason(): string | null {
  try {
    if (!getServerEnv().supabaseSecretKey) return SECRET_KEY_MISSING_REASON;
    getSiteUrl();
    return null;
  } catch (error) {
    if (error instanceof EnvError) {
      return error.variable === "NEXT_PUBLIC_SITE_URL"
        ? "NEXT_PUBLIC_SITE_URL is not set on the server, so invitation and reset links would point nowhere."
        : `The server configuration is incomplete (${error.variable}).`;
    }
    console.error("[admin/businesses] reading the server environment failed", error);
    return "The server configuration could not be read, so invitations can’t be sent.";
  }
}

/** Secret-key Auth access for member statuses (after `connection()`), or null without the key. */
export async function authAdminPortOrNull(): Promise<AuthAdminPort | null> {
  await connection();
  try {
    return createAuthAdminPort(createSupabaseAdminClient());
  } catch (error) {
    if (error instanceof EnvError) return null;
    throw error;
  }
}

/** Secret-key account listing for the list's Active/Invited statuses, or null without the key. */
export async function authUserDirectoryOrNull(): Promise<AuthUserDirectory | null> {
  await connection();
  try {
    return createAuthUserDirectory(createSupabaseAdminClient());
  } catch (error) {
    if (error instanceof EnvError) return null;
    throw error;
  }
}
