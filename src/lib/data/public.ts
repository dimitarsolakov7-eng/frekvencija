import "server-only";
import { connection } from "next/server";
import type { BusinessType } from "@/lib/api/contracts";
import { getSessionContext } from "@/lib/auth/session";
import { defaultGenreArtwork } from "@/lib/brand/genre-artwork";
import { EnvError, getServerEnv, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { AppRole } from "@/types/database";

/**
 * Server-only data for the public website (homepage, request-access form, policy pages). Everything
 * here degrades gracefully: in setup mode (no Supabase) or when a query fails, the public pages still
 * render honest fallbacks instead of an error page.
 */

// ---------------------------------------------------------------------------
// Viewer (who is looking at a public page)
// ---------------------------------------------------------------------------

export interface PublicViewer {
  role: AppRole;
}

/**
 * The signed-in user's role for public pages (header "Open radio" / "Admin workspace", and guest-only
 * pages that send signed-in users home), or null when signed out. Never throws: setup mode, an
 * unreachable auth service or a missing profile all count as "not signed in" here — the protected
 * areas re-check the session themselves.
 */
export async function getPublicViewer(): Promise<PublicViewer | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const ctx = await getSessionContext();
    return ctx ? { role: ctx.role } : null;
  } catch (error) {
    if (!(error instanceof EnvError)) console.warn("[public] session lookup failed; treating the visitor as signed out", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Genre collection (homepage)
// ---------------------------------------------------------------------------

export interface PublicGenre {
  /** Stable React key (the genre id, or the slug for the default list). */
  key: string;
  slug: string;
  name: string;
  description: string | null;
  /** Owner-uploaded cover (short-lived signed URL) or the deterministic default artwork. */
  artworkUrl: string;
}

export interface PublicGenreCollection {
  genres: PublicGenre[];
  /** "catalogue" = the owner's real genres; "default" = the illustrative list shown before setup. */
  source: "catalogue" | "default";
}

/** At most this many genres are shown on the homepage (the section expands to show all of them). */
export const PUBLIC_GENRE_LIMIT = 24;

/** Lifetime of the signed cover URLs rendered into the homepage. */
export const PUBLIC_COVER_URL_TTL_SECONDS = 3600;

function defaultGenre(slug: string, name: string, description: string): PublicGenre {
  return { key: `default-${slug}`, slug, name, description, artworkUrl: defaultGenreArtwork(slug) };
}

/**
 * Shown when Supabase is not configured or the catalogue has no public genres yet (the genre names
 * and descriptions of the approved homepage design).
 */
export const DEFAULT_PUBLIC_GENRES: readonly PublicGenre[] = Object.freeze([
  defaultGenre("house", "House", "Uplifting, rhythmic, timeless."),
  defaultGenre("lounge", "Lounge", "Stylish, relaxed, sophisticated."),
  defaultGenre("jazz", "Jazz", "Classic vibes, modern spaces."),
  defaultGenre("deep-house", "Deep House", "Deeper moods for longer evenings."),
  defaultGenre("balkan-hits", "Balkan Hits", "Modern Balkan sounds for great energy."),
  defaultGenre("chillout", "Chillout", "Laid-back sounds for any time."),
]);

function defaultCollection(): PublicGenreCollection {
  return { genres: DEFAULT_PUBLIC_GENRES.map((genre) => ({ ...genre })), source: "default" };
}

export interface LoadPublicGenresOptions {
  /** Injected secret-key client (tests). Defaults to createSupabaseAdminClient(). */
  client?: TypedSupabaseClient;
}

/**
 * Enabled genres offered to every venue (`is_enabled and available_to_all`), in the owner's order,
 * with name, description and cover only — never tracks or per-venue access. `genres` has no anon read
 * policy, so this reads with the secret-key client and signs the covers for public display.
 */
export async function loadPublicGenres(options: LoadPublicGenresOptions = {}): Promise<PublicGenreCollection> {
  if (!options.client && !canUseSecretKey()) return defaultCollection();

  let client: TypedSupabaseClient;
  try {
    if (options.client) {
      client = options.client;
    } else {
      await connection();
      client = createSupabaseAdminClient();
    }
  } catch (error) {
    console.warn("[public] genre catalogue unavailable; showing the default genres", error);
    return defaultCollection();
  }

  let rows: { id: string; slug: string; name: string; description: string | null; cover_path: string | null }[];
  try {
    const { data, error } = await client
      .from("genres")
      .select("id, slug, name, description, cover_path")
      .eq("is_enabled", true)
      .eq("available_to_all", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .limit(PUBLIC_GENRE_LIMIT);
    if (error) throw error;
    rows = data ?? [];
  } catch (error) {
    console.error("[public] loading the public genres failed; showing the default genres", error);
    return defaultCollection();
  }

  if (rows.length === 0) return defaultCollection();

  const coverUrls = await signCovers(
    client,
    rows.map((row) => row.cover_path).filter((path): path is string => typeof path === "string" && path !== ""),
  );

  return {
    source: "catalogue",
    genres: rows.map((row) => ({
      key: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description?.trim() ? row.description.trim() : null,
      artworkUrl: (row.cover_path && coverUrls.get(row.cover_path)) || defaultGenreArtwork(row.slug),
    })),
  };
}

/** Signs cover objects in one request; any failure falls back to the default artwork (never throws). */
async function signCovers(client: TypedSupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  try {
    const { data, error } = await client.storage
      .from("genre-covers")
      .createSignedUrls([...new Set(paths)], PUBLIC_COVER_URL_TTL_SECONDS);
    if (error) throw error;
    for (const entry of data ?? []) {
      if (!entry.error && entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
    }
  } catch (error) {
    console.warn("[public] signing genre covers failed; using the default artwork", error);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Platform settings (contact details, privacy policy, terms)
// ---------------------------------------------------------------------------

export interface PublicSettings {
  contactEmail: string | null;
  contactPhone: string | null;
  privacyPolicy: string | null;
  termsOfService: string | null;
}

export type PublicSettingsResult =
  /** Loaded (or setup mode, where nothing is configured yet). */
  | { status: "ok"; settings: PublicSettings }
  /** The settings exist but could not be read right now. */
  | { status: "unavailable" };

export const EMPTY_PUBLIC_SETTINGS: PublicSettings = Object.freeze({
  contactEmail: null,
  contactPhone: null,
  privacyPolicy: null,
  termsOfService: null,
});

function blankToNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export interface LoadPublicSettingsOptions {
  /** Injected client (tests). Defaults to the visitor's own server client (platform_settings is readable by anon). */
  client?: TypedSupabaseClient;
}

/** Owner-supplied public content from the `platform_settings` singleton. Never throws. */
export async function loadPublicSettings(options: LoadPublicSettingsOptions = {}): Promise<PublicSettingsResult> {
  if (!options.client && !isSupabaseConfigured()) return { status: "ok", settings: { ...EMPTY_PUBLIC_SETTINGS } };
  try {
    const client = options.client ?? (await createSupabaseServerClient());
    const { data, error } = await client
      .from("platform_settings")
      .select("contact_email, contact_phone, privacy_policy, terms_of_service")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    return {
      status: "ok",
      settings: {
        contactEmail: blankToNull(data?.contact_email),
        contactPhone: blankToNull(data?.contact_phone),
        privacyPolicy: blankToNull(data?.privacy_policy),
        termsOfService: blankToNull(data?.terms_of_service),
      },
    };
  } catch (error) {
    console.error("[public] loading platform settings failed", error);
    return { status: "unavailable" };
  }
}

// ---------------------------------------------------------------------------
// Access requests (public "Request access" form)
// ---------------------------------------------------------------------------

/** True when the secret key needed for the public form (insert + rate limits) is configured. */
function canUseSecretKey(): boolean {
  if (!isSupabaseConfigured()) return false;
  try {
    return getServerEnv().supabaseSecretKey !== null;
  } catch {
    return false;
  }
}

/** Whether the request-access form can store submissions (Supabase + secret key configured). */
export function canStoreAccessRequests(): boolean {
  return canUseSecretKey();
}

export interface AccessRequestInput {
  businessName: string;
  businessType: BusinessType;
  contactName: string;
  /** Lower-cased by validation; the open-request unique index is on lower(email) anyway. */
  email: string;
  phone: string | null;
  message: string | null;
}

export type AccessRequestInsertResult = { ok: true } | { ok: false; reason: "duplicate" | "failed" };

/**
 * Stores a request with the secret-key client (anon/authenticated have no INSERT privilege). Status
 * defaults to 'new'; nothing is ever approved automatically. An open request (new/contacted) for the
 * same email violates `access_requests_open_email_key` (23505) and is reported as a duplicate.
 */
export async function insertAccessRequest(
  client: TypedSupabaseClient,
  input: AccessRequestInput,
): Promise<AccessRequestInsertResult> {
  try {
    const { error } = await client.from("access_requests").insert({
      business_name: input.businessName,
      business_type: input.businessType,
      contact_name: input.contactName,
      email: input.email,
      phone: input.phone,
      message: input.message,
    });
    if (!error) return { ok: true };
    if (error.code === "23505") return { ok: false, reason: "duplicate" };
    console.error("[public] storing an access request failed", { code: error.code, message: error.message });
    return { ok: false, reason: "failed" };
  } catch (error) {
    console.error("[public] storing an access request failed", error);
    return { ok: false, reason: "failed" };
  }
}
