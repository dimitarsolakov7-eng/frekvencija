/**
 * Typed access to environment variables (docs/ARCHITECTURE.md §3). Read env ONLY through this module.
 *
 * Public values are referenced as literal `process.env.NEXT_PUBLIC_*` expressions so Next.js inlines
 * them into client bundles at build time (dynamic lookups are not inlined). Everything is read at call
 * time, never at module load, so a missing variable surfaces where it is needed with a clear message.
 */
import { PLATFORM_NAME } from "@/config/platform";

/** Thrown when a required variable is missing or malformed. `variable` names the offending setting. */
export class EnvError extends Error {
  readonly variable: string;

  constructor(variable: string, message: string) {
    super(message);
    this.name = "EnvError";
    this.variable = variable;
  }
}

export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

export interface PublicEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
  /** Absolute origin used to build auth email links, without a trailing slash. */
  siteUrl: string;
  platformName: string;
}

export interface ServerEnv {
  /** Secret (service-role) key, or null when neither SUPABASE_SECRET_KEY nor SUPABASE_SERVICE_ROLE_KEY is set. */
  supabaseSecretKey: string | null;
  elevenLabsApiKey: string | null;
  elevenLabsDefaultModelId: string | null;
  /** Baseline signed media URL lifetime in seconds, clamped to 900–43200. */
  mediaUrlTtlSeconds: number;
  /** Dedicated HMAC secret for upload tokens, or null to derive one from the Supabase secret key. */
  uploadTokenSecret: string | null;
  /**
   * Lower-case name of a request header that the deployment's edge proxy OVERWRITES with the client IP
   * (CLIENT_IP_HEADER, e.g. "x-real-ip"). On Vercel (VERCEL is set) it defaults to
   * "x-vercel-forwarded-for". Null when neither applies. Used only to pick per-IP rate-limit buckets.
   */
  clientIpHeader: string | null;
  /**
   * TRUSTED_PROXY_HOPS: how many trusted proxies in front of the app APPEND to X-Forwarded-For. The
   * client IP is the entry that many positions from the right. Null when not set.
   */
  trustedProxyHops: number | null;
}

export const MEDIA_URL_TTL_DEFAULT_SECONDS = 7200;
export const MEDIA_URL_TTL_MIN_SECONDS = 900;
export const MEDIA_URL_TTL_MAX_SECONDS = 43_200;
export const UPLOAD_TOKEN_SECRET_MIN_LENGTH = 32;
/** Header Vercel sets to the client IP; unlike X-Forwarded-For, a proxy in front of Vercel cannot overwrite it. */
export const VERCEL_CLIENT_IP_HEADER = "x-vercel-forwarded-for";
export const TRUSTED_PROXY_HOPS_MAX = 10;

const DEV_SITE_URL = "http://localhost:3000";

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseHttpUrl(variable: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EnvError(variable, `${variable} must be an absolute http(s) URL (got "${value}").`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EnvError(variable, `${variable} must use http or https (got "${url.protocol}").`);
  }
  return url;
}

function readSupabasePublicValues(): { url: string | null; publishableKey: string | null } {
  return {
    url: clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey:
      clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
      clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
}

/**
 * Supabase URL + publishable key, or throws an EnvError naming the missing variable.
 * Used by every Supabase client factory; does not require NEXT_PUBLIC_SITE_URL.
 */
export function getSupabasePublicConfig(): SupabasePublicConfig {
  const { url, publishableKey } = readSupabasePublicValues();
  if (!url) {
    throw new EnvError(
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL is not set. Add your Supabase project URL to .env.local (see .env.example).",
    );
  }
  if (!publishableKey) {
    throw new EnvError(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set (legacy fallback: NEXT_PUBLIC_SUPABASE_ANON_KEY). " +
        "Add your Supabase publishable key to .env.local (see .env.example).",
    );
  }
  const parsed = parseHttpUrl("NEXT_PUBLIC_SUPABASE_URL", url);
  return { url: parsed.origin + parsed.pathname.replace(/\/+$/, ""), publishableKey };
}

/** True when the Supabase URL and publishable key are present and well-formed. Never throws. */
export function isSupabaseConfigured(): boolean {
  try {
    getSupabasePublicConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * NEXT_PUBLIC_SITE_URL as an origin without trailing slash. Outside production it falls back to
 * http://localhost:3000; in production a missing value is an error, because auth email links built
 * from a guessed origin would silently point at the wrong host.
 */
export function getSiteUrl(): string {
  const raw = clean(process.env.NEXT_PUBLIC_SITE_URL);
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new EnvError(
        "NEXT_PUBLIC_SITE_URL",
        "NEXT_PUBLIC_SITE_URL is not set. Set it to the public origin of this app (e.g. https://radio.example.com).",
      );
    }
    return DEV_SITE_URL;
  }
  const url = parseHttpUrl("NEXT_PUBLIC_SITE_URL", raw);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new EnvError(
      "NEXT_PUBLIC_SITE_URL",
      `NEXT_PUBLIC_SITE_URL must be an origin only, without a path (got "${raw}").`,
    );
  }
  return url.origin;
}

export function getPublicEnv(): PublicEnv {
  const supabase = getSupabasePublicConfig();
  return {
    supabaseUrl: supabase.url,
    supabasePublishableKey: supabase.publishableKey,
    siteUrl: getSiteUrl(),
    platformName: PLATFORM_NAME,
  };
}

function assertServer(caller: string): void {
  if (typeof window !== "undefined") {
    throw new Error(`${caller}() must only be called on the server.`);
  }
}

function parseMediaTtl(raw: string | null): number {
  if (raw === null) return MEDIA_URL_TTL_DEFAULT_SECONDS;
  if (!/^\d+$/.test(raw)) {
    throw new EnvError(
      "MEDIA_URL_TTL_SECONDS",
      `MEDIA_URL_TTL_SECONDS must be a whole number of seconds (got "${raw}").`,
    );
  }
  const value = Number(raw);
  return Math.min(MEDIA_URL_TTL_MAX_SECONDS, Math.max(MEDIA_URL_TTL_MIN_SECONDS, value));
}

const reportedProblems = new Set<string>();

/** Logs a configuration problem once per process (getServerEnv() runs on every request). */
function reportOnce(message: string): void {
  if (reportedProblems.has(message)) return;
  reportedProblems.add(message);
  console.error(`[env] ${message}`);
}

/** RFC 9110 token: the characters a header name may contain. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;

/*
 * The two client-IP settings only choose rate-limit buckets. A malformed value is logged and ignored
 * instead of throwing: every getServerEnv() caller (media signing, uploads, TTS, rate limiting) would
 * otherwise fail because of a typo here. Ignoring one leaves the client IP untrusted, which the global
 * caps on the public forms are designed for.
 */
function parseClientIpHeader(raw: string | null, onVercel: boolean): string | null {
  if (raw !== null) {
    if (HEADER_NAME_PATTERN.test(raw)) return raw.toLowerCase();
    reportOnce(`CLIENT_IP_HEADER must be one header name such as "x-real-ip" (got "${raw}"); it is ignored.`);
  }
  return onVercel ? VERCEL_CLIENT_IP_HEADER : null;
}

function parseTrustedProxyHops(raw: string | null): number | null {
  if (raw === null) return null;
  const hops = /^\d{1,2}$/.test(raw) ? Number(raw) : Number.NaN;
  if (hops >= 0 && hops <= TRUSTED_PROXY_HOPS_MAX) return hops;
  reportOnce(
    `TRUSTED_PROXY_HOPS must be a whole number from 0 to ${TRUSTED_PROXY_HOPS_MAX} (got "${raw}"); it is ignored.`,
  );
  return null;
}

export function getServerEnv(): ServerEnv {
  assertServer("getServerEnv");
  const uploadTokenSecret = clean(process.env.UPLOAD_TOKEN_SECRET);
  if (uploadTokenSecret !== null && uploadTokenSecret.length < UPLOAD_TOKEN_SECRET_MIN_LENGTH) {
    throw new EnvError(
      "UPLOAD_TOKEN_SECRET",
      `UPLOAD_TOKEN_SECRET must be at least ${UPLOAD_TOKEN_SECRET_MIN_LENGTH} characters long ` +
        "(generate one with `openssl rand -base64 48`), or remove it to derive the key from SUPABASE_SECRET_KEY.",
    );
  }
  return {
    supabaseSecretKey:
      clean(process.env.SUPABASE_SECRET_KEY) ?? clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    elevenLabsApiKey: clean(process.env.ELEVENLABS_API_KEY),
    elevenLabsDefaultModelId: clean(process.env.ELEVENLABS_DEFAULT_MODEL_ID),
    mediaUrlTtlSeconds: parseMediaTtl(clean(process.env.MEDIA_URL_TTL_SECONDS)),
    uploadTokenSecret,
    clientIpHeader: parseClientIpHeader(clean(process.env.CLIENT_IP_HEADER), clean(process.env.VERCEL) !== null),
    trustedProxyHops: parseTrustedProxyHops(clean(process.env.TRUSTED_PROXY_HOPS)),
  };
}

/** The Supabase secret key, or throws an EnvError naming the variable to set. Server only. */
export function getSupabaseSecretKey(): string {
  const key = getServerEnv().supabaseSecretKey;
  if (!key) {
    throw new EnvError(
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SECRET_KEY is not set (legacy fallback: SUPABASE_SERVICE_ROLE_KEY). " +
        "It is required for invites, upload validation and rate limiting.",
    );
  }
  return key;
}

/** True when an ElevenLabs API key is configured. Server only (throws if called in the browser). */
export function isTtsConfigured(): boolean {
  assertServer("isTtsConfigured");
  return clean(process.env.ELEVENLABS_API_KEY) !== null;
}
