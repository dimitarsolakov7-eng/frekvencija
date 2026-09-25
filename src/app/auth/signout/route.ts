import { cookies } from "next/headers";
import { API_CACHE_CONTROL } from "@/lib/api/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Supabase SSR session cookies: `sb-<project-ref>-auth-token`, possibly chunked (`.0`, `.1`, …). */
const AUTH_COOKIE_PATTERN = /^sb-.+-auth-token(?:\.\d+)?$/;

function redirectToLogin(): Response {
  // Relative Location: correct behind any proxy/host name. 303 so the browser follows with GET.
  return new Response(null, {
    status: 303,
    headers: { Location: "/login", "Cache-Control": API_CACHE_CONTROL },
  });
}

/** True when the request comes from another site (cross-site form posts must not sign people out). */
function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  // Same comparison Next.js applies to Server Actions: Origin vs. the (forwarded) host.
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/**
 * Signs out THIS device only (`scope: "local"`) so other venue devices stay signed in, then sends the
 * browser to /login. The venue UI stops the player and clears its session state before posting here.
 */
export async function POST(request: Request): Promise<Response> {
  if (isCrossSite(request)) {
    return new Response("Cross-site sign-out requests are not allowed.", {
      status: 403,
      headers: { "Cache-Control": API_CACHE_CONTROL, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let signedOut = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) console.warn("[auth] sign-out reported an error", { code: error.code, status: error.status });
    else signedOut = true;
  } catch (error) {
    console.error("[auth] sign-out failed", error);
  }

  if (!signedOut) {
    // The user asked to leave: make sure this browser no longer carries the session either way.
    const cookieStore = await cookies();
    for (const { name } of cookieStore.getAll()) {
      if (AUTH_COOKIE_PATTERN.test(name)) cookieStore.delete(name);
    }
  }
  return redirectToLogin();
}

/** Signing out changes state, so it is POST-only (a GET could be triggered by a link or prefetch). */
export function GET(): Response {
  return new Response("Method Not Allowed. Sign out with a POST request.", {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": API_CACHE_CONTROL, "Content-Type": "text/plain; charset=utf-8" },
  });
}
