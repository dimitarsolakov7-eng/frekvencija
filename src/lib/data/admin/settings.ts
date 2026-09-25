import "server-only";
import { DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS } from "@/config/platform";
import { EnvError, getServerEnv, getSiteUrl, getSupabasePublicConfig, isSupabaseConfigured } from "@/lib/env";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { ElevenLabsError, getElevenLabsClient, type Subscription } from "@/lib/tts/elevenlabs";
import { formatDateTime } from "@/lib/utils/format";
import type { PlatformSettingsInput } from "@/lib/validation/settings";
import type { TablesUpdate } from "@/types/database";

/**
 * Platform settings (the `platform_settings` singleton, id = true) and the read-only integration
 * status for /admin/settings. Reads and writes use the admin's own client: anyone may read the row
 * (it is public content), only platform admins may update it.
 */

export class SettingsDataError extends Error {
  readonly code: string | null;

  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "SettingsDataError";
    const code = (cause as { code?: unknown } | null)?.code;
    this.code = typeof code === "string" ? code : null;
  }
}

export interface PlatformSettingsView {
  contactEmail: string | null;
  contactPhone: string | null;
  privacyPolicy: string | null;
  termsOfService: string | null;
  defaultAnnouncementEveryNTracks: number;
  updatedAt: string | null;
  updatedByEmail: string | null;
  /** The singleton row does not exist (the migration was not applied completely). */
  rowMissing: boolean;
}

export const EMPTY_PLATFORM_SETTINGS: PlatformSettingsView = Object.freeze({
  contactEmail: null,
  contactPhone: null,
  privacyPolicy: null,
  termsOfService: null,
  defaultAnnouncementEveryNTracks: DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS,
  updatedAt: null,
  updatedByEmail: null,
  rowMissing: false,
});

const SETTINGS_COLUMNS =
  "contact_email, contact_phone, privacy_policy, terms_of_service, default_announcement_every_n_tracks, updated_at, editor:profiles!platform_settings_updated_by_fkey ( email )";

function validFrequency(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50
    ? value
    : DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS;
}

/** The settings row for the settings page. Throws SettingsDataError when it can't be read. */
export async function loadPlatformSettings(supabase: TypedSupabaseClient): Promise<PlatformSettingsView> {
  const { data, error } = await supabase.from("platform_settings").select(SETTINGS_COLUMNS).eq("id", true).maybeSingle();
  if (error) throw new SettingsDataError("Could not load the platform settings.", error);
  if (!data) return { ...EMPTY_PLATFORM_SETTINGS, rowMissing: true };
  const row = data as {
    contact_email: string | null;
    contact_phone: string | null;
    privacy_policy: string | null;
    terms_of_service: string | null;
    default_announcement_every_n_tracks: number;
    updated_at: string;
    editor?: { email: string } | null;
  };
  return {
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    privacyPolicy: row.privacy_policy,
    termsOfService: row.terms_of_service,
    defaultAnnouncementEveryNTracks: validFrequency(row.default_announcement_every_n_tracks),
    updatedAt: row.updated_at,
    updatedByEmail: row.editor?.email ?? null,
    rowMissing: false,
  };
}

/**
 * The announcement frequency new venues start with. Never throws: a missing row or a failed read
 * falls back to the built-in default (4), and says so in `fromSettings`.
 */
export async function loadDefaultAnnouncementFrequency(
  supabase: TypedSupabaseClient,
): Promise<{ everyNTracks: number; fromSettings: boolean }> {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("default_announcement_every_n_tracks")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) {
      if (error) console.warn("[admin/settings] default announcement frequency unavailable", error.message);
      return { everyNTracks: DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS, fromSettings: false };
    }
    return { everyNTracks: validFrequency(data.default_announcement_every_n_tracks), fromSettings: true };
  } catch (error) {
    console.warn("[admin/settings] default announcement frequency unavailable", error);
    return { everyNTracks: DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS, fromSettings: false };
  }
}

export function toPlatformSettingsUpdate(input: PlatformSettingsInput, adminId: string): TablesUpdate<"platform_settings"> {
  return {
    contact_email: input.contactEmail,
    contact_phone: input.contactPhone,
    privacy_policy: input.privacyPolicy,
    terms_of_service: input.termsOfService,
    default_announcement_every_n_tracks: input.defaultAnnouncementEveryNTracks,
    updated_by: adminId,
  };
}

// ---------------------------------------------------------------------------
// Integration status (read-only)
// ---------------------------------------------------------------------------

export type IntegrationState = "ok" | "warning" | "error" | "off" | "info";

export interface IntegrationDetail {
  label: string;
  value: string;
}

export interface IntegrationItem {
  key: "supabase" | "secret-key" | "site-url" | "elevenlabs" | "email";
  name: string;
  state: IntegrationState;
  /** One line: what is configured and what that means. Never contains a secret. */
  summary: string;
  details: IntegrationDetail[];
  note?: string;
}

export interface IntegrationStatusDeps {
  isSupabaseConfigured: () => boolean;
  supabaseHost: () => string | null;
  secretKeyPresent: () => boolean;
  siteUrl: () => string;
  elevenLabsKeyPresent: () => boolean;
  getSubscription: () => Promise<Subscription>;
}

function defaultDeps(): IntegrationStatusDeps {
  return {
    isSupabaseConfigured,
    supabaseHost: () => {
      try {
        return new URL(getSupabasePublicConfig().url).host;
      } catch {
        return null;
      }
    },
    secretKeyPresent: () => getServerEnv().supabaseSecretKey !== null,
    siteUrl: getSiteUrl,
    elevenLabsKeyPresent: () => getServerEnv().elevenLabsApiKey !== null,
    // No retries and a short timeout: this is only a status read, the page must not hang on it.
    getSubscription: () => getElevenLabsClient({ maxRetries: 0 }).getSubscription({ timeoutMs: 8000 }),
  };
}

const numberFormat = new Intl.NumberFormat("en-US");

/** "12,345 of 100,000 characters used (12%)". */
export function describeCharacterUsage(used: number, limit: number): string {
  if (!Number.isFinite(limit) || limit <= 0) return `${numberFormat.format(Math.max(0, used))} characters used`;
  const percent = Math.min(100, Math.round((Math.max(0, used) / limit) * 100));
  return `${numberFormat.format(Math.max(0, used))} of ${numberFormat.format(limit)} characters used (${percent}%)`;
}

function sentenceCase(text: string): string {
  const cleaned = text.replace(/_/g, " ").trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "Unknown";
}

/** Honest explanation of a failed subscription read. Never echoes the key. */
export function describeSubscriptionError(error: unknown): { state: IntegrationState; summary: string } {
  if (!(error instanceof ElevenLabsError)) {
    return { state: "warning", summary: "The subscription details couldn’t be read from ElevenLabs. Try again later." };
  }
  switch (error.kind) {
    case "not_configured":
      return { state: "off", summary: "Not configured: ELEVENLABS_API_KEY is not set." };
    case "auth":
      return {
        state: "error",
        summary:
          "ElevenLabs refused the subscription request: the API key is invalid, or it lacks the “User: Read” permission (voice generation may still work). Check ELEVENLABS_API_KEY.",
      };
    case "rate_limited":
      return { state: "warning", summary: "ElevenLabs is rate-limiting this account right now. Reload the page in a minute." };
    case "timeout":
      return { state: "warning", summary: "ElevenLabs didn’t answer in time. Reload the page to try again." };
    case "provider_unavailable":
      return { state: "warning", summary: "ElevenLabs is temporarily unavailable. Reload the page later." };
    case "quota":
      return { state: "error", summary: "ElevenLabs reports a plan or credit problem on this account." };
    default:
      return { state: "warning", summary: "ElevenLabs didn’t return the subscription details." };
  }
}

export const EMAIL_DELIVERY_NOTE =
  "Invitations and password resets are sent by Supabase Auth. Its built-in email service only delivers to members of your Supabase project’s team and allows about 2 emails per hour. For real venues, set up custom SMTP in Supabase (Authentication → Emails). Until then, use “Create invite link” on a venue’s Access tab and deliver the one-time link privately.";

/** Read-only status of the external services. Never throws and never includes a secret value. */
export async function loadIntegrationStatus(deps: IntegrationStatusDeps = defaultDeps()): Promise<IntegrationItem[]> {
  const items: IntegrationItem[] = [];

  const supabaseConfigured = deps.isSupabaseConfigured();
  const host = supabaseConfigured ? deps.supabaseHost() : null;
  items.push({
    key: "supabase",
    name: "Supabase",
    state: supabaseConfigured ? "ok" : "error",
    summary: supabaseConfigured
      ? "Configured: sign-in, database and file storage are available."
      : "Not configured: NEXT_PUBLIC_SUPABASE_URL or the publishable key is missing.",
    details: host ? [{ label: "Project", value: host }] : [],
  });

  let secretKey = false;
  try {
    secretKey = deps.secretKeyPresent();
  } catch (error) {
    console.warn("[admin/settings] reading the server environment failed", error);
  }
  items.push({
    key: "secret-key",
    name: "Supabase secret key",
    state: secretKey ? "ok" : "error",
    summary: secretKey
      ? "Present on the server (never shown). Invitations, password resets and access requests can be handled."
      : "Missing: SUPABASE_SECRET_KEY is needed for invitations, password resets, staff sign-in statuses, access-request storage and upload checks.",
    details: [],
  });

  try {
    const origin = deps.siteUrl();
    items.push({
      key: "site-url",
      name: "Site address for email links",
      state: "ok",
      summary: "Invitation and password reset links point here.",
      details: [{ label: "Address", value: origin }],
    });
  } catch (error) {
    items.push({
      key: "site-url",
      name: "Site address for email links",
      state: "error",
      summary: error instanceof EnvError ? error.message : "NEXT_PUBLIC_SITE_URL could not be read.",
      details: [],
    });
  }

  let elevenLabsKey = false;
  try {
    elevenLabsKey = deps.elevenLabsKeyPresent();
  } catch (error) {
    console.warn("[admin/settings] reading the server environment failed", error);
  }
  if (!elevenLabsKey) {
    items.push({
      key: "elevenlabs",
      name: "ElevenLabs voice generation",
      state: "off",
      summary: "Not configured: set ELEVENLABS_API_KEY to generate announcement voices. Uploading your own recordings works without it.",
      details: [],
    });
  } else {
    try {
      const subscription = await deps.getSubscription();
      const details: IntegrationDetail[] = [
        { label: "Plan", value: sentenceCase(subscription.tier) },
        { label: "Status", value: sentenceCase(subscription.status) },
        { label: "Credits", value: describeCharacterUsage(subscription.characterCount, subscription.characterLimit) },
      ];
      if (subscription.nextResetUnix) {
        details.push({ label: "Credits reset", value: formatDateTime(new Date(subscription.nextResetUnix * 1000)) });
      }
      const exhausted = subscription.characterLimit > 0 && subscription.characterCount >= subscription.characterLimit;
      items.push({
        key: "elevenlabs",
        name: "ElevenLabs voice generation",
        state: exhausted ? "warning" : "ok",
        summary: exhausted
          ? "Configured, but this period’s character credits are used up: new voices can’t be generated until they reset."
          : "Configured: announcement voices can be generated.",
        details,
      });
    } catch (error) {
      if (!(error instanceof ElevenLabsError)) console.warn("[admin/settings] ElevenLabs subscription read failed", error);
      const described = describeSubscriptionError(error);
      items.push({
        key: "elevenlabs",
        name: "ElevenLabs voice generation",
        state: described.state,
        summary: described.summary,
        details: [],
        note: "The API key is configured on the server and is never shown here.",
      });
    }
  }

  items.push({
    key: "email",
    name: "Email delivery",
    state: "info",
    summary: EMAIL_DELIVERY_NOTE,
    details: [],
  });

  return items;
}
