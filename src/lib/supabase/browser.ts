import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/env";
import type { Database } from "@/types/database";
import type { TypedSupabaseClient } from "./types";

let browserClient: TypedSupabaseClient | undefined;

/**
 * Browser Supabase client (one per tab). It keeps the cookie session fresh for long-running
 * player tabs because `autoRefreshToken` defaults to true in the browser.
 */
export function createSupabaseBrowserClient(): TypedSupabaseClient {
  if (!browserClient) {
    const { url, publishableKey } = getSupabasePublicConfig();
    browserClient = createBrowserClient<Database>(url, publishableKey);
  }
  return browserClient;
}
