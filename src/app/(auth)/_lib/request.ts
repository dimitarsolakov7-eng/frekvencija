/**
 * Request helpers for the auth Server Actions: client IP for rate limiting and bounded bucket keys.
 * Our limits sit in front of Supabase's own per-IP limits, which only ever see the server's IP.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { getServerEnv } from "@/lib/env";

interface HeaderReader {
  get(name: string): string | null;
}

/** Where the client IP may be read from: CLIENT_IP_HEADER / TRUSTED_PROXY_HOPS (see .env.example). */
export interface ClientIpSettings {
  /** Header that the deployment's edge overwrites with the client IP (lower-case), or null. */
  clientIpHeader: string | null;
  /** Trusted proxies that append to X-Forwarded-For, or null when not configured. */
  trustedProxyHops: number | null;
}

export interface ClientIp {
  /** Rate-limit bucket: an IPv4 address, an IPv6 /64 prefix ("2001:db8:0:1::/64"), or "unknown". */
  ip: string;
  /**
   * False when no setting says which X-Forwarded-For entry our own infrastructure wrote. The value is
   * then a best guess that a client can forge, so per-IP limits are best-effort only; the global caps
   * on the public forms (access requests, reset emails) do not depend on it.
   */
  trusted: boolean;
}

export const UNKNOWN_CLIENT_IP = "unknown";

const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d{1,5})?$/;
const MAX_ENTRY_LENGTH = 64;

/** Splits a comma-separated header (X-Forwarded-For style) into trimmed, non-empty entries. */
function headerEntries(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** Expands a valid IPv6 address (no zone) to its eight 16-bit groups. */
function ipv6Groups(address: string): number[] {
  const parse = (part: string): number[] => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (group.includes(".")) {
        // Embedded IPv4 in the last 32 bits, e.g. "::ffff:203.0.113.7".
        const [a, b, c, d] = group.split(".").map(Number);
        groups.push(a * 256 + b, c * 256 + d);
      } else {
        groups.push(Number.parseInt(group, 16));
      }
    }
    return groups;
  };
  const gap = address.indexOf("::");
  if (gap < 0) return parse(address);
  const head = parse(address.slice(0, gap));
  const tail = parse(address.slice(gap + 2));
  const zeros = 8 - head.length - tail.length;
  // "::" stands for at least one zero group; anything else is not a valid address.
  return zeros < 1 ? [] : [...head, ...new Array<number>(zeros).fill(0), ...tail];
}

/**
 * Normalises one header entry to a bucket value, or null when it is not an IP address (so a forged
 * header cannot create unbounded keys). Strips ports and brackets, maps IPv4-mapped IPv6 to IPv4, and
 * buckets other IPv6 addresses by /64: one subscriber usually controls a whole /64.
 */
export function normaliseClientIp(entry: string | null | undefined): string | null {
  let value = entry?.trim() ?? "";
  if (value === "" || value.length > MAX_ENTRY_LENGTH) return null;
  const bracketed = BRACKETED_IPV6.exec(value);
  if (bracketed) value = bracketed[1];
  else value = IPV4_WITH_PORT.exec(value)?.[1] ?? value;
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);

  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return null;
  const groups = ipv6Groups(value);
  if (groups.length !== 8) return null;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/**
 * The client IP for rate limiting, by this policy:
 * 1. CLIENT_IP_HEADER (or x-vercel-forwarded-for on Vercel): a header the edge overwrites, so a
 *    client cannot choose its value. If it holds a list, the right-most entry is the edge's own.
 * 2. TRUSTED_PROXY_HOPS = N ≥ 1: every trusted proxy appends the address it received the request
 *    from, so the client is the Nth entry from the right; everything further left came from the
 *    client itself and is ignored.
 * A configured source that is missing from a request (the request bypassed the edge, or came from
 * inside the proxy chain) yields the shared "unknown" bucket, never a client-supplied value.
 * 3. Nothing configured (or TRUSTED_PROXY_HOPS=0): the right-most X-Forwarded-For entry, which is the
 *    real client behind one appending proxy and Next.js's own socket address when the header was
 *    absent — but a client talking to `next start` directly can write it, so it is untrusted.
 */
export function resolveClientIp(headers: HeaderReader, settings: ClientIpSettings): ClientIp {
  const { clientIpHeader, trustedProxyHops } = settings;
  const hops = trustedProxyHops !== null && trustedProxyHops > 0 ? trustedProxyHops : null;

  if (clientIpHeader !== null) {
    const fromHeader = normaliseClientIp(headerEntries(headers.get(clientIpHeader)).pop());
    if (fromHeader !== null) return { ip: fromHeader, trusted: true };
    if (hops === null) return { ip: UNKNOWN_CLIENT_IP, trusted: true };
  }

  const forwarded = headerEntries(headers.get("x-forwarded-for"));
  if (hops !== null) {
    const entry = forwarded.length >= hops ? forwarded[forwarded.length - hops] : undefined;
    return { ip: normaliseClientIp(entry) ?? UNKNOWN_CLIENT_IP, trusted: true };
  }
  return { ip: normaliseClientIp(forwarded[forwarded.length - 1]) ?? UNKNOWN_CLIENT_IP, trusted: false };
}

const reportedOnce = new Set<string>();

function logOnce(key: string, log: () => void): void {
  if (reportedOnce.has(key)) return;
  reportedOnce.add(key);
  log();
}

function clientIpSettings(): ClientIpSettings {
  try {
    const { clientIpHeader, trustedProxyHops } = getServerEnv();
    return { clientIpHeader, trustedProxyHops };
  } catch (error) {
    // getServerEnv() validates every server variable. A problem with another one must not break
    // sign-in: fall back to the untrusted policy (the error itself surfaces where that variable is used).
    logOnce("settings", () => console.error("[rate-limit] could not read the client IP settings", error));
    return { clientIpHeader: null, trustedProxyHops: null };
  }
}

/**
 * The client IP bucket for per-IP rate limits, or "unknown" (see resolveClientIp for the policy).
 * In production an untrusted setup is reported once, so a self-hosted deployment learns to set
 * CLIENT_IP_HEADER or TRUSTED_PROXY_HOPS.
 */
export function clientIpFromHeaders(headers: HeaderReader): string {
  const { ip, trusted } = resolveClientIp(headers, clientIpSettings());
  if (!trusted && process.env.NODE_ENV === "production") {
    logOnce("untrusted", () =>
      console.warn(
        "[rate-limit] Per-IP limits use the last X-Forwarded-For entry, which clients can forge unless a proxy " +
          "in front of the app sets it. Set CLIENT_IP_HEADER or TRUSTED_PROXY_HOPS (see .env.example). " +
          "Global caps on access requests and reset emails still apply.",
      ),
    );
  }
  return ip;
}

/** Rate-limit keys are at most 200 characters; longer values are replaced by their SHA-256 digest. */
export const MAX_RATE_LIMIT_KEY_LENGTH = 200;

export function rateLimitKey(prefix: string, value: string): string {
  const key = `${prefix}:${value}`;
  if (key.length <= MAX_RATE_LIMIT_KEY_LENGTH) return key;
  return `${prefix}:sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export interface AuthRateLimit {
  prefix: string;
  max: number;
  windowSeconds: number;
}

/**
 * Options for consumeRateLimit(). Auth limits fail OPEN: if the limiter itself is down, people can
 * still sign in (Supabase keeps its own per-IP limits as a backstop).
 */
export function authRateLimit(
  limit: AuthRateLimit,
  value: string,
): { key: string; max: number; windowSeconds: number; failClosed: false } {
  return { key: rateLimitKey(limit.prefix, value), max: limit.max, windowSeconds: limit.windowSeconds, failClosed: false };
}

/**
 * Options for a cap shared by ALL visitors (the key is the prefix itself). It reads no client header,
 * so neither a forged X-Forwarded-For nor many real addresses can lift it. Consume it only after the
 * per-IP and per-email buckets allowed the request, so one client they stop cannot use up everyone's
 * budget. Fails open like the other auth limits.
 */
export function globalAuthRateLimit(limit: AuthRateLimit): { key: string; max: number; windowSeconds: number; failClosed: false } {
  return { key: limit.prefix, max: limit.max, windowSeconds: limit.windowSeconds, failClosed: false };
}

/** Password sign-in: 10 attempts per email and 50 per client IP every 10 minutes. */
export const LOGIN_EMAIL_LIMIT: AuthRateLimit = { prefix: "login:email", max: 10, windowSeconds: 600 };
export const LOGIN_IP_LIMIT: AuthRateLimit = { prefix: "login:ip", max: 50, windowSeconds: 600 };

/** Reset emails: 5 per address and 20 per client IP every hour. */
export const RESET_EMAIL_LIMIT: AuthRateLimit = { prefix: "reset:email", max: 5, windowSeconds: 3600 };
export const RESET_IP_LIMIT: AuthRateLimit = { prefix: "reset:ip", max: 20, windowSeconds: 3600 };
/**
 * Forgot-password emails across all visitors: 60 per hour. Failing open is safe here because Supabase
 * Auth's own project-wide email rate limit stays in place behind it.
 */
export const RESET_GLOBAL_LIMIT: AuthRateLimit = { prefix: "reset:global", max: 60, windowSeconds: 3600 };
