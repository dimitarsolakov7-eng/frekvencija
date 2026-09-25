import "server-only";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { describeDbError, type ActionState } from "@/lib/actions/state";
import {
  BusinessDataError,
  createAuthAdminPort,
  createMemberDirectory,
  type MemberAccessDeps,
} from "@/lib/data/admin/businesses";
import { EnvError, getSiteUrl } from "@/lib/env";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

/** Shared plumbing of the business Server Actions (not itself a "use server" module). */

export const BUSINESSES_PATH = "/admin/businesses";

/** Invitations, one-time links and password resets per admin: invite:{adminId}, 30 per 10 minutes. */
export const INVITE_RATE_LIMIT = { max: 30, windowSeconds: 600 } as const;

export function done<V extends Record<string, string> = Record<string, string>>(message: string): ActionState<V> {
  return { ok: true, message, fieldErrors: {}, nonce: Date.now() };
}

export function failed<V extends Record<string, string> = Record<string, string>>(
  message: string,
  values?: V,
  fieldErrors: Record<string, string> = {},
): ActionState<V> {
  return { ok: false, message, fieldErrors, values, nonce: Date.now() };
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Refreshes everything under /admin/businesses (the list layout, detail, add form and requests) and
 * the pages that show venue data elsewhere in the admin.
 */
export function revalidateBusinesses(options: { announcements?: boolean } = {}): void {
  revalidatePath(BUSINESSES_PATH, "layout");
  if (options.announcements) revalidatePath("/admin/announcements");
}

/** User-facing message for an unexpected failure in a data helper (the cause is logged). */
export function dataFailureMessage(context: string, error: unknown, fallback: string): string {
  console.error(`[admin/businesses] ${context}`, error);
  if (error instanceof BusinessDataError) return describeDbError({ code: error.code }, fallback);
  return fallback;
}

export type DepsResult = { ok: true; deps: MemberAccessDeps } | { ok: false; message: string };

/** Everything the invite / reset flows need; explains honestly what is missing on the server. */
export async function memberAccessDeps(supabase: TypedSupabaseClient): Promise<DepsResult> {
  let siteUrl: string;
  try {
    siteUrl = getSiteUrl();
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    console.error("[admin/businesses] invites unavailable:", error.message);
    return { ok: false, message: "Invitations are unavailable: NEXT_PUBLIC_SITE_URL is not set on the server, so links would point nowhere." };
  }
  await connection();
  try {
    return {
      ok: true,
      deps: {
        directory: createMemberDirectory(supabase),
        auth: createAuthAdminPort(createSupabaseAdminClient()),
        siteUrl,
      },
    };
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    console.error("[admin/businesses] invites unavailable:", error.message);
    return { ok: false, message: "Invitations and password resets are unavailable: SUPABASE_SECRET_KEY is not set on the server." };
  }
}

/** null when allowed, otherwise the message to show. */
export async function checkInviteRateLimit(adminId: string): Promise<string | null> {
  const result = await consumeRateLimit({ key: `invite:${adminId}`, ...INVITE_RATE_LIMIT, failClosed: false });
  if (result.allowed) return null;
  return "You’ve sent many invitations and password resets in the last few minutes. Wait a few minutes and try again.";
}

export function submittedStrings(value: FormDataEntryValue | FormDataEntryValue[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.filter((entry): entry is string => typeof entry === "string");
}
