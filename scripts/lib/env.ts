// Environment handling for the local scripts. The app reads env only through src/lib/env.ts; the
// scripts cannot import it together with the Supabase admin factory (server-only throws under tsx),
// so this module mirrors the few rules they need (legacy key fallbacks, site-URL shape).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "./paths";

/** Thrown for a missing or malformed setting; the message names the variable and how to fix it. */
export class ScriptEnvError extends Error {
  readonly variable: string;

  constructor(variable: string, message: string) {
    super(message);
    this.name = "ScriptEnvError";
    this.variable = variable;
  }
}

/** The supported Node.js versions from package.json "engines", or null when they cannot be read. */
function supportedNodeVersions(): string | null {
  try {
    const range = (JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")) as { engines?: { node?: unknown } }).engines?.node;
    return typeof range === "string" ? range : null;
  } catch {
    return null;
  }
}

/**
 * Loads `.env.local`, then `.env`, from the project root when present. `process.loadEnvFile` never
 * overrides a variable that is already set, so the precedence matches Next.js:
 * shell environment > .env.local > .env. Returns the files that were loaded.
 * `process.loadEnvFile` exists from Node.js 20.12 / 21.7; an older runtime gets a clear error instead
 * of a TypeError (the project itself needs a newer Node.js, see package.json "engines").
 */
export function loadLocalEnv(root: string = PROJECT_ROOT): string[] {
  const loaded: string[] = [];
  for (const name of [".env.local", ".env"]) {
    const file = join(root, name);
    if (existsSync(file)) {
      if (typeof process.loadEnvFile !== "function") {
        const supported = supportedNodeVersions();
        throw new ScriptEnvError(
          "node",
          `Node.js ${process.versions.node} cannot read ${name}: process.loadEnvFile needs Node.js 20.12 or newer. ` +
            `Switch to a supported Node.js version${supported ? ` (package.json "engines": ${supported})` : ""} and run the command again.`,
        );
      }
      process.loadEnvFile(file);
      loaded.push(name);
    }
  }
  return loaded;
}

/** Any environment-like map (process.env, or a plain object in tests). */
export type EnvSource = Readonly<Record<string, string | undefined>>;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** NEXT_PUBLIC_SUPABASE_URL as a normalised http(s) URL string, or null when unset. Throws when malformed. */
export function readSupabaseUrl(env: EnvSource = process.env): string | null {
  const raw = clean(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ScriptEnvError("NEXT_PUBLIC_SUPABASE_URL", `NEXT_PUBLIC_SUPABASE_URL must be an absolute http(s) URL (got "${raw}").`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScriptEnvError("NEXT_PUBLIC_SUPABASE_URL", `NEXT_PUBLIC_SUPABASE_URL must use http or https (got "${url.protocol}").`);
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export interface SupabaseAdminConfig {
  url: string;
  /** Secret (service-role) key. Never print it. */
  secretKey: string;
}

/** URL + secret key for the admin client, or throws naming the missing variable. */
export function getSupabaseAdminConfig(env: EnvSource = process.env): SupabaseAdminConfig {
  const url = readSupabaseUrl(env);
  if (!url) {
    throw new ScriptEnvError(
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local (see .env.example).",
    );
  }
  const secretKey = clean(env.SUPABASE_SECRET_KEY) ?? clean(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!secretKey) {
    throw new ScriptEnvError(
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SECRET_KEY is not set (legacy fallback: SUPABASE_SERVICE_ROLE_KEY). Add the project's secret key to .env.local.",
    );
  }
  return { url, secretKey };
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when the URL points at this machine (a local Supabase stack). */
export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export const DEV_SITE_URL = "http://localhost:3000";

/**
 * NEXT_PUBLIC_SITE_URL as an origin (no trailing slash). Missing ⇒ http://localhost:3000, but only when
 * `allowDefault` is true: auth links built from a guessed origin would point at the wrong host.
 */
export function getSiteUrl(options: { allowDefault: boolean }, env: EnvSource = process.env): string {
  const raw = clean(env.NEXT_PUBLIC_SITE_URL);
  if (!raw) {
    if (options.allowDefault) return DEV_SITE_URL;
    throw new ScriptEnvError(
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_SITE_URL is not set. Set it to the public origin of the app (e.g. https://radio.example.com) so invite links point at it.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ScriptEnvError("NEXT_PUBLIC_SITE_URL", `NEXT_PUBLIC_SITE_URL must be an absolute http(s) URL (got "${raw}").`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/" || url.search || url.hash) {
    throw new ScriptEnvError("NEXT_PUBLIC_SITE_URL", `NEXT_PUBLIC_SITE_URL must be an http(s) origin without a path (got "${raw}").`);
  }
  return url.origin;
}
