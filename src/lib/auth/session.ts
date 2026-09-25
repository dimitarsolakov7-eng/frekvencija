import "server-only";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { jsonError, jsonServerError } from "@/lib/api/http";
import { EnvError } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import {
  checkAdminAccess,
  checkBusinessUserAccess,
  isAdminContext,
  isVenueContext,
  type AccessDecision,
  type AdminSessionContext,
  type BusinessUserSessionContext,
  type SessionContext,
  type VenueSessionContext,
} from "./access";

export type {
  AdminSessionContext,
  BusinessUserSessionContext,
  SessionBusiness,
  SessionContext,
  VenueSessionContext,
} from "./access";

export type SessionLookupFailure = "auth_unreachable" | "profile_missing" | "query_failed";

/** The session could not be resolved for a reason other than "signed out". */
export class SessionLookupError extends Error {
  readonly reason: SessionLookupFailure;

  constructor(reason: SessionLookupFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SessionLookupError";
    this.reason = reason;
  }
}

/**
 * Resolves the signed-in user with the given (user-scoped) client: verified JWT claims, then the
 * profile role and business membership under RLS. Returns null when signed out; throws
 * SessionLookupError when the answer is unknown (never guesses a role).
 */
export async function loadSessionContext(supabase: TypedSupabaseClient): Promise<SessionContext | null> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims) {
    if (claimsError && isAuthRetryableFetchError(claimsError)) {
      throw new SessionLookupError("auth_unreachable", "The authentication service could not be reached.", {
        cause: claimsError,
      });
    }
    return null;
  }

  const userId = claims.sub;
  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("profiles").select("email, role").eq("id", userId).maybeSingle(),
    supabase
      .from("business_members")
      .select("business_id, businesses ( id, name, station_name, is_active )")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (profileResult.error) {
    throw new SessionLookupError("query_failed", "Could not load the user profile.", { cause: profileResult.error });
  }
  if (membershipResult.error) {
    throw new SessionLookupError("query_failed", "Could not load the venue membership.", {
      cause: membershipResult.error,
    });
  }
  const profile = profileResult.data;
  if (!profile) {
    // Valid JWT but no profile row (e.g. the user was deleted moments ago). Not "signed out": the
    // proxy would still see the cookie and bounce between /login and /, so surface it as an error.
    throw new SessionLookupError("profile_missing", "No profile exists for the signed-in user.");
  }

  const business = membershipResult.data?.businesses ?? null;
  return {
    userId,
    email: profile.email || (typeof claims.email === "string" ? claims.email : ""),
    role: profile.role,
    business: business
      ? { id: business.id, name: business.name, stationName: business.station_name, isActive: business.is_active }
      : null,
  };
}

/** Per-request (React cache) session for Server Components; layouts and pages share one lookup. */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  return loadSessionContext(await createSupabaseServerClient());
});

/** Admin pages: signed out ⇒ /login, venue users ⇒ /. */
export async function requireAdminPage(nextPath = "/admin"): Promise<AdminSessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!isAdminContext(ctx)) redirect("/");
  return ctx;
}

/**
 * Venue pages: signed out ⇒ /login, admins ⇒ /admin. Returns the context even when the business is
 * missing or inactive so the (venue) layout can explain that state instead of failing.
 */
export async function requireBusinessUserPage(nextPath = "/radio"): Promise<VenueSessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!isVenueContext(ctx)) redirect("/admin");
  return ctx;
}

/**
 * Server Actions for admins. Redirects when signed out / not an admin (an action invoked without the
 * right role is either an expired session or a forged request). Returns the user-scoped client.
 */
export async function requireAdminAction(): Promise<{ ctx: AdminSessionContext; supabase: TypedSupabaseClient }> {
  const supabase = await createSupabaseServerClient();
  const ctx = await loadSessionContext(supabase);
  if (!ctx) redirect("/login");
  if (!isAdminContext(ctx)) redirect("/");
  return { ctx, supabase };
}

export type ApiAccess<C> = { ok: true; ctx: C; supabase: TypedSupabaseClient } | { ok: false; response: Response };

async function resolveApiAccess<C>(
  check: (ctx: SessionContext | null) => AccessDecision<C>,
): Promise<ApiAccess<C>> {
  let supabase: TypedSupabaseClient;
  let ctx: SessionContext | null;
  try {
    supabase = await createSupabaseServerClient();
    ctx = await loadSessionContext(supabase);
  } catch (error) {
    if (error instanceof EnvError) {
      return { ok: false, response: jsonError(503, "unavailable", "The server is not configured yet.") };
    }
    if (error instanceof SessionLookupError) {
      if (error.reason === "profile_missing") {
        return { ok: false, response: jsonError(401, "unauthenticated", "Your account could not be found. Please sign in again.") };
      }
      if (error.reason === "auth_unreachable") {
        console.error("[auth] session lookup failed", error.cause);
        return { ok: false, response: jsonError(503, "unavailable", "Sign-in service is temporarily unavailable. Please try again.") };
      }
    }
    return { ok: false, response: jsonServerError("session lookup failed", error) };
  }

  const decision = check(ctx);
  if (!decision.ok) {
    const { status, code, message } = decision.denial;
    return { ok: false, response: jsonError(status, code, message) };
  }
  return { ok: true, ctx: decision.ctx, supabase };
}

/** Route Handlers for admins: 401 unauthenticated / 403 forbidden as JSON. */
export function requireAdminApi(): Promise<ApiAccess<AdminSessionContext>> {
  return resolveApiAccess(checkAdminAccess);
}

/**
 * Route Handlers for venue users: 401 unauthenticated, 403 forbidden (admins), 403 no_business,
 * 403 business_inactive. The business always comes from the session, never from the request.
 */
export function requireBusinessUserApi(): Promise<ApiAccess<BusinessUserSessionContext>> {
  return resolveApiAccess(checkBusinessUserAccess);
}
