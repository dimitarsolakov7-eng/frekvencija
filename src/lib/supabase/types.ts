import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** Any Supabase client typed with our schema (server, browser and admin clients all satisfy it). */
export type TypedSupabaseClient = SupabaseClient<Database>;

/** Private Storage buckets (docs/ARCHITECTURE.md §5.6). */
export type StorageBucket = "music" | "announcements" | "logos" | "genre-covers";
