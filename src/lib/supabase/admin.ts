import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig, getSupabaseSecretKey } from "@/lib/env";
import type { Database } from "@/types/database";
import type { TypedSupabaseClient } from "./types";

/**
 * Secret-key client that BYPASSES RLS. Use only for Auth admin calls (invites), upload validation
 * downloads/cleanup, and rate limiting — always after the caller has been authorised.
 *
 * Deliberately a plain supabase-js client, never the SSR client: the SSR client would attach the
 * user's cookie session, and requests carrying a user token are subject to RLS again.
 * Callers in Server Components that do not otherwise read cookies must `await connection()` first.
 */
export function createSupabaseAdminClient(): TypedSupabaseClient {
  const { url } = getSupabasePublicConfig();
  return createClient<Database>(url, getSupabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
