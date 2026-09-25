import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { LoadErrorAlert } from "@/components/admin/businesses/LoadErrorAlert";
import { IntegrationStatusCard, IntegrationStatusSkeleton } from "@/components/admin/settings/IntegrationStatusCard";
import { SettingsForm } from "@/components/admin/settings/SettingsForm";
import { PageHeading } from "@/components/shell/PageHeading";
import { requireAdminPage } from "@/lib/auth/session";
import { loadIntegrationStatus, loadPlatformSettings, type PlatformSettingsView } from "@/lib/data/admin/settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { savePlatformSettings } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

/** Streams in separately: it may wait for ElevenLabs (bounded by a short timeout). */
async function IntegrationStatusSection() {
  await connection();
  const items = await loadIntegrationStatus();
  return <IntegrationStatusCard items={items} />;
}

/** /admin/settings: platform contact, defaults for new venues, legal texts and integration status. */
export default async function SettingsPage() {
  await requireAdminPage("/admin/settings");

  let settings: PlatformSettingsView | null = null;
  try {
    settings = await loadPlatformSettings(await createSupabaseServerClient());
  } catch (error) {
    console.error("[admin/settings] settings failed to load", error);
  }

  return (
    <>
      <PageHeading title="Settings" description="Contact details, defaults for new venues, legal pages and integrations." />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="min-w-0">
          {settings ? (
            <SettingsForm settings={settings} action={savePlatformSettings} privacyHref="/privacy" termsHref="/terms" />
          ) : (
            <LoadErrorAlert title="The settings couldn’t be loaded" />
          )}
        </div>
        <div className="min-w-0 xl:sticky xl:top-6">
          <Suspense fallback={<IntegrationStatusSkeleton />}>
            <IntegrationStatusSection />
          </Suspense>
        </div>
      </div>
    </>
  );
}
