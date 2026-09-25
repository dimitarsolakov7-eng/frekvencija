import type { Metadata, Route } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/shell";
import { IntegrationStatusCard } from "@/components/admin/settings/IntegrationStatusCard";
import type { PlatformSettingsFormData } from "@/components/admin/settings/types";
import { PageHeading } from "@/components/shell/PageHeading";
import type { IntegrationItem } from "@/lib/data/admin/settings";
import { cn } from "@/lib/utils/cn";
import { SettingsPreview } from "./SettingsPreview";

export const metadata: Metadata = { title: "Settings preview" };

// Reads the variant from the query string on every request.
export const dynamic = "force-dynamic";

type Variant = "configured" | "empty" | "missing";

const VARIANTS: readonly { value: Variant; label: string }[] = [
  { value: "configured", label: "Configured" },
  { value: "empty", label: "Nothing set yet" },
  { value: "missing", label: "Keys missing" },
];

const EMAIL_NOTE =
  "Invitations and password resets are sent by Supabase Auth. Its built-in email service only delivers to members of your Supabase project’s team and allows about 2 emails per hour. For real venues, set up custom SMTP in Supabase (Authentication → Emails). Until then, use “Create invite link” on a venue’s Access tab and deliver the one-time link privately.";

const PRIVACY_TEXT =
  "Frekvencija provides background music and station announcements to hospitality venues.\n\nWe store the venue details and the account email addresses needed to sign in. Playback preferences (genre and volume) are stored per account.\n\nContact us to have your data removed.";

function settingsFor(variant: Variant): PlatformSettingsFormData {
  if (variant === "empty") {
    return {
      contactEmail: null,
      contactPhone: null,
      privacyPolicy: null,
      termsOfService: null,
      defaultAnnouncementEveryNTracks: 4,
      updatedAt: null,
      updatedByEmail: null,
      rowMissing: false,
    };
  }
  return {
    contactEmail: "hello@frekvencija.online",
    contactPhone: "+389 70 123 456",
    privacyPolicy: PRIVACY_TEXT,
    termsOfService: variant === "configured" ? "Accounts are provided to approved venues only.\n\nEach venue is responsible for who uses its account." : null,
    defaultAnnouncementEveryNTracks: 4,
    updatedAt: "2026-09-24T16:05:00Z",
    updatedByEmail: "admin@frekvencija.online",
    rowMissing: false,
  };
}

function integrationsFor(variant: Variant): IntegrationItem[] {
  const missing = variant === "missing";
  return [
    {
      key: "supabase",
      name: "Supabase",
      state: "ok",
      summary: "Configured: sign-in, database and file storage are available.",
      details: [{ label: "Project", value: "abcdefghijklmnop.supabase.co" }],
    },
    missing
      ? {
          key: "secret-key",
          name: "Supabase secret key",
          state: "error",
          summary:
            "Missing: SUPABASE_SECRET_KEY is needed for invitations, password resets, staff sign-in statuses, access-request storage and upload checks.",
          details: [],
        }
      : {
          key: "secret-key",
          name: "Supabase secret key",
          state: "ok",
          summary: "Present on the server (never shown). Invitations, password resets and access requests can be handled.",
          details: [],
        },
    {
      key: "site-url",
      name: "Site address for email links",
      state: "ok",
      summary: "Invitation and password reset links point here.",
      details: [{ label: "Address", value: "https://frekvencija.online" }],
    },
    missing
      ? {
          key: "elevenlabs",
          name: "ElevenLabs voice generation",
          state: "off",
          summary: "Not configured: set ELEVENLABS_API_KEY to generate announcement voices. Uploading your own recordings works without it.",
          details: [],
        }
      : {
          key: "elevenlabs",
          name: "ElevenLabs voice generation",
          state: "ok",
          summary: "Configured: announcement voices can be generated.",
          details: [
            { label: "Plan", value: "Creator" },
            { label: "Status", value: "Active" },
            { label: "Credits", value: "12,480 of 100,000 characters used (12%)" },
            { label: "Credits reset", value: "25 Oct 2026, 00:00 UTC" },
          ],
        },
    { key: "email", name: "Email delivery", state: "info", summary: EMAIL_NOTE, details: [] },
  ];
}

/**
 * Development-only preview of /admin/settings with fixture values and a no-op save, inside the admin
 * shell. `?variant=configured|empty|missing`. The /dev layout returns 404 in production.
 */
export default async function SettingsPreviewPage({ searchParams }: PageProps<"/dev/preview/settings">) {
  const { variant: raw } = await searchParams;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const variant: Variant = value === "empty" || value === "missing" ? value : "configured";

  return (
    <AdminShell email="admin@frekvencija.online">
      <nav
        aria-label="Preview variants"
        className="mb-6 flex flex-wrap items-center gap-2 rounded-card border border-dashed border-border-strong px-4 py-3 text-xs"
      >
        <span className="mr-2 font-semibold text-fg">Dev preview · fixtures only</span>
        {VARIANTS.map((item) => (
          <Link
            key={item.value}
            href={`/dev/preview/settings?variant=${item.value}` as Route}
            aria-current={item.value === variant ? "page" : undefined}
            className={cn(
              "rounded-full border px-2.5 py-1 transition-colors",
              item.value === variant ? "border-accent/50 bg-accent/15 text-fg" : "border-border text-fg-muted hover:text-fg",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <PageHeading title="Settings" description="Contact details, defaults for new venues, legal pages and integrations." />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="min-w-0">
          <SettingsPreview key={variant} settings={settingsFor(variant)} />
        </div>
        <div className="min-w-0 xl:sticky xl:top-6">
          <IntegrationStatusCard items={integrationsFor(variant)} />
        </div>
      </div>
    </AdminShell>
  );
}
