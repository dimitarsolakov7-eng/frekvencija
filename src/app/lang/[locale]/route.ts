import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS, isLocale, safeReturnPath } from "@/lib/i18n/locale";

/**
 * GET /lang/<mk|en>?next=/path — the MK / EN switch. Remembers the language in a cookie and sends
 * the visitor back to the page they were on (same-origin paths only). Works without JavaScript.
 */
export async function GET(request: NextRequest, context: RouteContext<"/lang/[locale]">): Promise<Response> {
  const { locale } = await context.params;
  const next = safeReturnPath(request.nextUrl.searchParams.get("next"));
  const url = new URL(next, request.nextUrl.origin);
  const response = NextResponse.redirect(url, 303);
  if (isLocale(locale)) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}
