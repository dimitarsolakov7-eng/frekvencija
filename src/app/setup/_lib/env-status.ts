/**
 * Environment checklist for the /setup page. Reports variable NAMES and a status only — values are
 * never returned, so nothing secret can reach the page.
 *
 * Why this reads process.env directly: src/lib/env.ts validates on use and reports only the FIRST
 * missing Supabase variable, while setup needs the whole list at once. Validation rules match env.ts.
 */

export type EnvVarStatus = "set" | "missing" | "invalid";
export type EnvVarNeed = "required" | "recommended" | "optional";

export interface EnvVarCheck {
  name: string;
  /** Alternative variable accepted in place of `name`, if any. */
  alternative?: string;
  status: EnvVarStatus;
  need: EnvVarNeed;
  purpose: string;
  /** Short explanation for `invalid` (never includes the value). */
  problem?: string;
}

/** Only presence and shape matter; the snapshot is discarded after the checks run. */
export interface SetupEnvSnapshot {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  NODE_ENV?: string;
}

export function readSetupEnvSnapshot(): SetupEnvSnapshot {
  // Literal property reads so Next.js resolves the public values the same way env.ts does.
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    NODE_ENV: process.env.NODE_ENV,
  };
}

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function httpUrlProblem(value: string, originOnly: boolean): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "Not an absolute URL (it should start with https:// or http://).";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "The URL must use https:// or http://.";
  if (originOnly && (url.pathname !== "/" || url.search || url.hash)) {
    return "Use the origin only, without a path or trailing segment (e.g. https://radio.example.com).";
  }
  return null;
}

export interface SetupEnvReport {
  checks: EnvVarCheck[];
  /** Names of required variables that are missing or invalid (what blocks the app from starting). */
  blocking: string[];
  supabaseConfigured: boolean;
}

export function describeSetupEnv(env: SetupEnvSnapshot): SetupEnvReport {
  const production = env.NODE_ENV === "production";
  const checks: EnvVarCheck[] = [];

  const urlProblem = present(env.NEXT_PUBLIC_SUPABASE_URL) ? httpUrlProblem(env.NEXT_PUBLIC_SUPABASE_URL, false) : null;
  checks.push({
    name: "NEXT_PUBLIC_SUPABASE_URL",
    need: "required",
    status: !present(env.NEXT_PUBLIC_SUPABASE_URL) ? "missing" : urlProblem ? "invalid" : "set",
    problem: urlProblem ?? undefined,
    purpose: "Your Supabase project URL (Project Settings → API).",
  });

  checks.push({
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    alternative: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    need: "required",
    status:
      present(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) || present(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ? "set" : "missing",
    purpose: "The publishable key (sb_publishable_…). Safe for browsers; Row Level Security protects the data.",
  });

  checks.push({
    name: "SUPABASE_SECRET_KEY",
    alternative: "SUPABASE_SERVICE_ROLE_KEY",
    need: "recommended",
    status: present(env.SUPABASE_SECRET_KEY) || present(env.SUPABASE_SERVICE_ROLE_KEY) ? "set" : "missing",
    purpose: "Server-only secret key for invites, upload validation and rate limiting. Never prefix it with NEXT_PUBLIC_.",
  });

  const siteProblem = present(env.NEXT_PUBLIC_SITE_URL) ? httpUrlProblem(env.NEXT_PUBLIC_SITE_URL, true) : null;
  checks.push({
    name: "NEXT_PUBLIC_SITE_URL",
    need: production ? "required" : "recommended",
    status: !present(env.NEXT_PUBLIC_SITE_URL) ? "missing" : siteProblem ? "invalid" : "set",
    problem: siteProblem ?? undefined,
    purpose: production
      ? "The public address of this app, used in invite and password-reset emails."
      : "The public address of this app, used in invite and password-reset emails (defaults to http://localhost:3000 in development).",
  });

  checks.push({
    name: "ELEVENLABS_API_KEY",
    need: "optional",
    status: present(env.ELEVENLABS_API_KEY) ? "set" : "missing",
    purpose: "Optional: generate announcements with ElevenLabs. Uploaded MP3 announcements work without it.",
  });

  const blocking = checks.filter((check) => check.need === "required" && check.status !== "set").map((check) => check.name);
  const supabaseConfigured = checks
    .filter((check) => check.name.startsWith("NEXT_PUBLIC_SUPABASE_"))
    .every((check) => check.status === "set");
  return { checks, blocking, supabaseConfigured };
}
