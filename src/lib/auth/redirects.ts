const MAX_NEXT_LENGTH = 2048;
const PROBE_ORIGIN = "http://next-path.invalid";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * True for a string a browser can only read as a path on the current origin: it starts with a single
 * "/" and contains no "\" (browsers treat it as "/", so "/\host" means "//host") and no control
 * characters (browsers drop tabs/newlines, so "/\t/host" also becomes "//host").
 */
function isSameOriginPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !CONTROL_CHARACTERS.test(value);
}

/**
 * Sanitises a user-controlled `next` redirect target (query param, hidden form field).
 * Only same-origin relative paths survive; everything else becomes `fallback`. Rejected:
 * absolute URLs and schemes, protocol-relative `//host`, `/\host` (browsers treat `\` as `/`),
 * and control characters (browsers strip tabs/newlines, turning `/\t/host` into `//host`).
 *
 * The result is the normalised path (dot segments removed), and it is checked again AFTER
 * normalising: "/.//host", "/%2e%2e//host" and "/a/..//host" pass the raw checks but normalise to
 * "//host", which a browser would read as another site. So the result never starts with "//" or
 * contains "\", and safeNextPath(safeNextPath(x)) === safeNextPath(x).
 * Accepts the raw `searchParams` value shape (string | string[] | undefined) for convenience.
 */
export function safeNextPath(next: unknown, fallback = "/"): string {
  const candidate = Array.isArray(next) ? next[0] : next;
  if (typeof candidate !== "string") return fallback;
  if (candidate.length === 0 || candidate.length > MAX_NEXT_LENGTH) return fallback;
  if (!isSameOriginPath(candidate)) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(candidate, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (resolved.origin !== PROBE_ORIGIN) return fallback;
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  return isSameOriginPath(path) ? path : fallback;
}
