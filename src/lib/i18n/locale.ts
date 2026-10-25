/**
 * Public-website languages. Macedonian is the default; English is a complete second version. The
 * choice is remembered in a cookie (set by /lang/<locale>), so every existing URL keeps working.
 * Client-safe: no server imports.
 */
export const LOCALES = ["mk", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "mk";

/** Cookie that remembers the visitor's language (one year, same-site). */
export const LOCALE_COOKIE = "frekvencija_lang";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** BCP-47 tags for <html lang> and Open Graph. */
export const LOCALE_TAGS: Record<Locale, { html: string; openGraph: string }> = {
  mk: { html: "mk", openGraph: "mk_MK" },
  en: { html: "en", openGraph: "en_US" },
};

/** Native-language names for the MK / EN switch. */
export const LOCALE_NAMES: Record<Locale, { short: string; long: string }> = {
  mk: { short: "MK", long: "Македонски" },
  en: { short: "EN", long: "English" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** A locale from a cookie or URL segment, or the default when it is missing or unknown. */
export function parseLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** The other language of a two-language switch. */
export function otherLocale(locale: Locale): Locale {
  return locale === "mk" ? "en" : "mk";
}

/**
 * Where /lang/<locale> may send the visitor back to: a same-origin path ("/", "/#trial",
 * "/request-access?x=1"). Anything else (absolute URLs, protocol-relative "//evil", backslashes) is
 * replaced by the homepage so the switch can never become an open redirect.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (typeof value !== "string" || value === "") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\s]/.test(value)) return "/";
  return value.length <= 2048 ? value : "/";
}

/** Replaces `{name}`-style placeholders in a copy string. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
