import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "@/lib/env";
import type { Database } from "@/types/database";
import type { TypedSupabaseClient } from "./types";

/**
 * Cookie-bound Supabase client for Server Components, Server Actions and Route Handlers.
 * Create one per request; never keep it in a module-level variable.
 */
export async function createSupabaseServerClient(): Promise<TypedSupabaseClient> {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabasePublicConfig();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. That is safe to ignore because src/proxy.ts
          // refreshes the session (and writes the rotated cookies) before rendering starts.
        }
      },
    },
  });
}
