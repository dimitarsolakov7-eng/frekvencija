import type { Metadata } from "next";
import { HelpScreen } from "@/components/player/HelpScreen";
import { VenueAppShell } from "@/components/player/VenueAppShell";
import { PREVIEW_EMAIL, PREVIEW_LINKS, previewBootstrap, previewSnapshot } from "../fixtures";
import { StaticPlayer } from "../StaticPlayer";

export const metadata: Metadata = { title: "Help preview" };

export const dynamic = "force-dynamic";

/**
 * /dev/preview/radio/help[?contact=0] — the venue help page with fixture data (development only).
 * `contact=0` shows the state without owner contact details.
 */
export default async function HelpPreviewPage({ searchParams }: PageProps<"/dev/preview/radio/help">) {
  const params = await searchParams;
  const base = previewBootstrap("paused");
  const bootstrap = params.contact === "0" ? { ...base, support: { email: null, phone: null } } : base;
  return (
    <StaticPlayer bootstrap={bootstrap} snapshot={previewSnapshot("paused")}>
      <VenueAppShell business={bootstrap.business} email={PREVIEW_EMAIL} links={PREVIEW_LINKS}>
        <HelpScreen />
      </VenueAppShell>
    </StaticPlayer>
  );
}
