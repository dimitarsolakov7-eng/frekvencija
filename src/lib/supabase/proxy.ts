import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/env";
import type { Database } from "@/types/database";

export interface SessionRefreshResult {
  /** Response carrying any refreshed auth cookies. Return it (or copy it with `redirectPreservingSession`). */
  response: NextResponse;
  /** true/false when known; null when the auth service could not be reached to decide. */
  authenticated: boolean | null;
}

const SESSION_CACHE_HEADERS = ["cache-control", "expires", "pragma"] as const;

/**
 * Refreshes the Supabase session for `src/proxy.ts` (docs/research/supabase.md §2.3).
 * Server Components cannot write cookies, so this is the one place a rotated refresh token is persisted.
 */
export async function updateSession(request: NextRequest): Promise<SessionRefreshResult> {
  const { url, publishableKey } = getSupabasePublicConfig();
  let response = NextResponse.next({ request });

  // setAll may run more than once per request, and @supabase/ssr only passes the anti-caching headers on
  // the first write, so accumulate both and re-apply them whenever the response object is rebuilt.
  const pendingCookies = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const pendingHeaders: Record<string, string> = {};

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
          pendingCookies.set(cookie.name, cookie);
        }
        Object.assign(pendingHeaders, headers);
        // Rebuild so Server Components of THIS request see the refreshed cookies…
        response = NextResponse.next({ request });
        // …and send them (plus the no-store headers) to the browser.
        for (const { name, value, options } of pendingCookies.values()) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(pendingHeaders)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Nothing may run between createServerClient and getClaims(), or sessions get dropped at random.
  let result: Awaited<ReturnType<typeof supabase.auth.getClaims>>;
  try {
    result = await supabase.auth.getClaims();
  } catch (error) {
    // Unexpected failure: don't take every page down with it; pages and handlers re-check the session.
    console.error("[proxy] session refresh failed", error);
    return { response, authenticated: null };
  }

  const { data, error } = result;
  let authenticated: boolean | null;
  if (data?.claims) {
    authenticated = true;
  } else if (error && isAuthRetryableFetchError(error)) {
    // Auth service unreachable: do not bounce a possibly signed-in user to /login; pages decide.
    authenticated = null;
  } else {
    authenticated = false;
  }

  return { response, authenticated };
}

/**
 * Redirect that keeps whatever `updateSession` wrote (refreshed or cleared cookies and the
 * anti-caching headers). Uses 307 for GET/HEAD and 303 otherwise so a Server Action POST is never
 * replayed against the redirect target.
 */
export function redirectPreservingSession(source: NextResponse, url: URL, method: string): NextResponse {
  const status = method === "GET" || method === "HEAD" ? 307 : 303;
  const redirect = NextResponse.redirect(url, status);
  for (const cookie of source.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  for (const header of SESSION_CACHE_HEADERS) {
    const value = source.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}
