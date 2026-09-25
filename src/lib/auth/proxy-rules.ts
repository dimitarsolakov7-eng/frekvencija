/**
 * Pure routing decisions for src/proxy.ts. Proxy redirects are optimistic UX only: every page, action
 * and route handler still authorises itself (see src/lib/auth/session.ts) and RLS enforces it again.
 */

export interface ProxyDecisionInput {
  pathname: string;
  /** Query string including the leading "?", or "" (kept in `next` so the user returns to the same view). */
  search?: string;
  /** Whether the Supabase public env vars are present (false ⇒ setup mode). */
  configured: boolean;
  /** Session state; null when it could not be determined (auth service unreachable). */
  authenticated: boolean | null;
}

export type ProxyAction =
  | { type: "next" }
  | { type: "redirect"; pathname: string; searchParams?: Record<string, string> }
  /** Setup mode for JSON endpoints: answer 503 instead of redirecting an API client to an HTML page. */
  | { type: "setup-required-json" };

export const SETUP_PATH = "/setup";
export const LOGIN_PATH = "/login";
export const HOME_PATH = "/";
export const RESET_PASSWORD_PATH = "/reset-password";

/** The platform admin workspace. */
export const ADMIN_AREA_PREFIX = "/admin";
/** Areas for signed-in venue (business) users. */
export const BUSINESS_AREA_PREFIXES = ["/radio", "/account", "/help"] as const;

/**
 * Pages that need a signed-in user. `/reset-password` needs the session created by an invite or
 * recovery link (or an ordinary sign-in when a user changes their password).
 */
export const PROTECTED_PREFIXES = [ADMIN_AREA_PREFIX, ...BUSINESS_AREA_PREFIXES, RESET_PASSWORD_PATH] as const;

/**
 * Pages that make no sense for a signed-in user. The proxy only knows THAT someone is signed in (the
 * role lives in `profiles`, not in the JWT), so these pages send signed-in users to their role's home
 * page themselves (see `getPublicViewer()` in src/lib/data/public.ts).
 */
export const GUEST_ONLY_PREFIXES = ["/login", "/forgot-password"] as const;

/**
 * Public pages that render in setup mode (Supabase env missing). Their server actions answer with a
 * friendly "not configured" message instead of failing. `/` is matched exactly.
 */
export const SETUP_MODE_PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  "/request-access",
  "/privacy",
  "/terms",
  RESET_PASSWORD_PATH,
] as const;

/**
 * Always reachable in setup mode: the setup page, static brand assets, and development-only tooling
 * that works without Supabase (those routes 404 in production themselves).
 */
const SETUP_EXEMPT_PREFIXES = [SETUP_PATH, "/brand", "/dev", "/api/dev"] as const;

const STATIC_FILE_PATTERN =
  /\.(?:svg|png|jpe?g|gif|webp|avif|ico|mp3|wav|ogg|m4a|aac|flac|css|js|map|txt|xml|webmanifest|woff2?|ttf)$/i;

export function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function matchesAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => matchesPrefix(pathname, prefix));
}

/** Defensive twin of the proxy matcher: framework assets and public files are never redirected. */
export function isStaticAssetPath(pathname: string): boolean {
  return pathname.startsWith("/_next/") || STATIC_FILE_PATTERN.test(pathname);
}

/** True for pages that render without Supabase (the marketing site, the auth forms, the policies). */
export function isSetupModePublicPath(pathname: string): boolean {
  return pathname === HOME_PATH || matchesAny(pathname, SETUP_MODE_PUBLIC_PREFIXES);
}

export function decideProxyAction(input: ProxyDecisionInput): ProxyAction {
  const { pathname, configured, authenticated } = input;

  if (isStaticAssetPath(pathname)) return { type: "next" };

  if (!configured) {
    if (matchesAny(pathname, SETUP_EXEMPT_PREFIXES) || isSetupModePublicPath(pathname)) return { type: "next" };
    if (matchesPrefix(pathname, "/api")) return { type: "setup-required-json" };
    return { type: "redirect", pathname: SETUP_PATH };
  }

  // Route handlers answer 401/403 JSON themselves, and /auth/* (confirm, sign-out) manages sessions.
  if (matchesPrefix(pathname, "/api") || matchesPrefix(pathname, "/auth")) return { type: "next" };

  if (authenticated === false && matchesAny(pathname, PROTECTED_PREFIXES)) {
    return {
      type: "redirect",
      pathname: LOGIN_PATH,
      searchParams: { next: `${pathname}${input.search ?? ""}` },
    };
  }

  // Everything else — the homepage, the public pages and the guest-only pages (which redirect a signed-in
  // user to their role's home page themselves) — renders for everyone.
  return { type: "next" };
}
