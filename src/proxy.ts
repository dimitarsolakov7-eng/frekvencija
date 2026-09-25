import { NextResponse, type NextRequest } from "next/server";
import { jsonError } from "@/lib/api/http";
import { decideProxyAction } from "@/lib/auth/proxy-rules";
import { isSupabaseConfigured } from "@/lib/env";
import { redirectPreservingSession, updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const configured = isSupabaseConfigured();

  let response = NextResponse.next({ request });
  let authenticated: boolean | null = null;
  if (configured) {
    ({ response, authenticated } = await updateSession(request));
  }

  const action = decideProxyAction({ pathname, search, configured, authenticated });
  switch (action.type) {
    case "next":
      return response;
    case "setup-required-json":
      return jsonError(
        503,
        "unavailable",
        "The server is not configured yet: Supabase environment variables are missing.",
      );
    case "redirect": {
      const url = request.nextUrl.clone();
      url.pathname = action.pathname;
      url.search = "";
      for (const [key, value] of Object.entries(action.searchParams ?? {})) {
        url.searchParams.set(key, value);
      }
      return redirectPreservingSession(response, url, request.method);
    }
  }
}

export const config = {
  matcher: [
    // Everything except framework assets and static image/audio files. /api/* and /auth/* stay
    // matched so the session is refreshed for them too.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp3|wav|ogg|m4a|aac|flac)$).*)",
  ],
};
