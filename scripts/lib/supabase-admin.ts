// Secret-key Supabase client + auth/profile helpers for the local scripts (seed:dev, admin:create).
// src/lib/supabase/admin.ts cannot be used here: it imports "server-only", which throws under tsx.
// Same construction rules: a plain supabase-js client, never the SSR client, no session persistence.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppRole, Database } from "../../src/types/database";
import type { SupabaseAdminConfig } from "./env";

export type AdminClient = SupabaseClient<Database>;

export function createScriptAdminClient(config: SupabaseAdminConfig): AdminClient {
  return createClient<Database>(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** One-line description of a Supabase (Postgrest/Auth/Storage) or other error. Never includes keys. */
export function describeError(error: unknown): string {
  if (error instanceof Error || (typeof error === "object" && error !== null)) {
    const { message, code, status, statusCode, details, hint } = error as {
      message?: unknown;
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const text = typeof message === "string" && message ? message : "Unknown error";
    const parts = [text];
    const codes = [code, statusCode ?? status].filter((value) => (typeof value === "string" && value !== "") || typeof value === "number");
    if (codes.length > 0) parts.push(`(${codes.join(", ")})`);
    // postgrest-js puts the network cause (with a stack trace) into `details`: keep only the message lines.
    const detailLines = typeof details === "string" ? details.split(/\r?\n/).map((line) => line.trim()) : [];
    const detail = detailLines.filter((line) => line && !line.startsWith("at ") && line !== text).join(" ").slice(0, 300);
    if (detail) parts.push(`- ${detail}`);
    if (typeof hint === "string" && hint) parts.push(`Hint: ${hint}`);
    return parts.join(" ");
  }
  return String(error);
}

/** True when a request never reached Supabase (DNS, refused connection, offline). */
export function isNetworkFailure(error: unknown): boolean {
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/.test(describeError(error));
}

/**
 * Printed when Supabase cannot be reached. The repository ships no supabase/config.toml, so a local
 * stack needs `supabase init` before `supabase start`.
 */
export const UNREACHABLE_HINT =
  "Supabase could not be reached: check NEXT_PUBLIC_SUPABASE_URL. For a local stack, run `supabase init` once " +
  "(this repository has no supabase/config.toml), then `supabase start` (docs/SEEDING.md §2).";

/** An error from a named script step, e.g. "upload track …". */
export class ScriptStepError extends Error {
  constructor(step: string, cause: unknown) {
    super(`${step}: ${describeError(cause)}`);
    this.name = "ScriptStepError";
  }
}

/**
 * Postgres / PostgREST codes for a table or column that does not exist: undefined column (42703) or
 * table (42P01), and PostgREST's "not in the schema cache" for columns (PGRST204) and tables (PGRST205).
 */
const MISSING_SCHEMA_CODES = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);

/** True when a query failed because the database lacks a table or column (a migration was not applied). */
export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && MISSING_SCHEMA_CODES.has(code);
}

/** The database lacks a table or column the seed (and the app) needs. Raised before anything is written. */
export class MissingMigrationError extends Error {
  constructor(step: string, cause: unknown) {
    super(
      `The database schema is incomplete (reading ${step}: ${describeError(cause)}). Apply every file in ` +
        "supabase/migrations/ in filename order (docs/SETUP.md §4), including 20260926000100_frekvencija.sql " +
        "(business types, genre covers, access requests, platform settings), then re-run. Nothing was written.",
    );
    this.name = "MissingMigrationError";
  }
}

export interface ProfileSummary {
  id: string;
  email: string;
  role: AppRole;
}

/** The profile row for an email (profiles.email mirrors auth.users.email, which auth stores lowercase). */
export async function findProfileByEmail(client: AdminClient, email: string): Promise<ProfileSummary | null> {
  const { data, error } = await client.from("profiles").select("id, email, role").eq("email", email.toLowerCase()).limit(1).maybeSingle();
  if (error) throw new ScriptStepError(`look up profile for ${email}`, error);
  return data;
}

/** Finds an auth user id by email by paging through auth.admin.listUsers (only needed when no profile row exists). */
export async function findAuthUserIdByEmail(client: AdminClient, email: string): Promise<string | null> {
  const wanted = email.toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 1000; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw new ScriptStepError("list auth users", error);
    const match = data.users.find((user) => user.email?.toLowerCase() === wanted);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }
  return null;
}

/**
 * Sets profiles.role = 'platform_admin' (allowed for the service role by the role guard trigger).
 * Creates the profile row when it is missing (a user created before the migrations installed the trigger).
 */
export async function promoteToPlatformAdmin(client: AdminClient, userId: string, email: string): Promise<"promoted" | "created-profile"> {
  const { data, error } = await client.from("profiles").update({ role: "platform_admin" }).eq("id", userId).select("id");
  if (error) throw new ScriptStepError(`promote ${email} to platform_admin`, error);
  if (data.length > 0) return "promoted";
  const { error: insertError } = await client.from("profiles").insert({ id: userId, email: email.toLowerCase(), role: "platform_admin" });
  if (insertError) throw new ScriptStepError(`create the platform_admin profile for ${email}`, insertError);
  return "created-profile";
}

/** True for the auth error Supabase returns when an email is already registered. */
export function isEmailExistsError(error: { code?: string | null; status?: number } | null): boolean {
  return Boolean(error && (error.code === "email_exists" || error.code === "user_already_exists"));
}
