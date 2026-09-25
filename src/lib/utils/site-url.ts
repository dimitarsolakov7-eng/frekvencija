/** Origin used when NEXT_PUBLIC_SITE_URL is missing or unusable (local development). */
export const DEV_SITE_ORIGIN = "http://localhost:3000";

/**
 * Lenient site origin for metadata (metadataBase, Open Graph URLs). Unlike `getSiteUrl()` in
 * `@/lib/env`, it never throws: an absent or malformed value falls back to `fallback`, because a
 * missing variable must not take the whole app down while rendering <head>. Only http(s) origins
 * are accepted; any path, query or hash is dropped.
 */
export function resolveSiteOrigin(raw: string | null | undefined, fallback: string = DEV_SITE_ORIGIN): string {
  const value = raw?.trim();
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}
