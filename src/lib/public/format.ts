import type { Locale } from "@/lib/i18n/locale";

/**
 * A whole number with thousands separators: "52.000" in Macedonian, "52,000" in English. Written by
 * hand (not Intl) so the server and every browser produce exactly the same text.
 */
export function formatStatNumber(value: number, locale: Locale): string {
  const rounded = Math.max(0, Math.round(value));
  const separator = locale === "mk" ? "." : ",";
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}
