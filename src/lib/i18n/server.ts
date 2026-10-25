import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, parseLocale, type Locale } from "./locale";

/**
 * The visitor's language from the locale cookie (Macedonian by default). Reading the cookie makes the
 * rendering dynamic, which the public pages are anyway. Outside a request (unit tests rendering a
 * layout directly) it falls back to the default instead of throwing.
 */
export async function getLocale(): Promise<Locale> {
  try {
    const store = await cookies();
    return parseLocale(store.get(LOCALE_COOKIE)?.value);
  } catch {
    return DEFAULT_LOCALE;
  }
}
