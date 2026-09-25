/**
 * Where a user goes after signing in / setting a password. Pure (no I/O) so the rules are unit-tested.
 * Page guards and RLS still enforce access; these rules only avoid pointless redirect hops.
 */
import { ADMIN_AREA_PREFIX, BUSINESS_AREA_PREFIXES, matchesPrefix } from "@/lib/auth/proxy-rules";
import { safeNextPath } from "@/lib/auth/redirects";
import type { AppRole } from "@/types/database";

export type HomePath = "/login" | "/admin" | "/radio";

/** The landing page for a role; signed out (null) goes to /login. */
export function homePathForRole(role: AppRole | null | undefined): HomePath {
  if (role === "platform_admin") return "/admin";
  if (role === "business_user") return "/radio";
  return "/login";
}

/** Pages that make no sense as a post-sign-in destination (guest pages, auth plumbing, APIs). */
const NEVER_AFTER_SIGN_IN = ["/login", "/forgot-password", "/request-access", "/auth", "/setup", "/api"] as const;

/**
 * Sanitises a user-controlled `next` value and falls back to the role's home page when the target
 * is missing, unsafe, the root, a guest/auth page, or an area of the other role.
 */
export function resolvePostLoginPath(next: unknown, role: AppRole): string {
  const home = homePathForRole(role);
  const target = safeNextPath(next, "");
  if (!target) return home;

  const pathname = target.split(/[?#]/, 1)[0] ?? "";
  if (pathname === "" || pathname === "/") return home;
  if (NEVER_AFTER_SIGN_IN.some((prefix) => matchesPrefix(pathname, prefix))) return home;
  if (role !== "platform_admin" && matchesPrefix(pathname, ADMIN_AREA_PREFIX)) return home;
  if (role === "platform_admin" && BUSINESS_AREA_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) return home;
  return target;
}
