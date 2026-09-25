import type { Metadata } from "next";
import { VenueAppShell } from "@/components/player/VenueAppShell";
import { PREVIEW_EMAIL, PREVIEW_LINKS, previewBootstrap, previewSnapshot } from "../fixtures";
import { StaticPlayer } from "../StaticPlayer";
import { AccountPreview } from "./AccountPreview";

export const metadata: Metadata = { title: "Account preview" };

export const dynamic = "force-dynamic";

/** /dev/preview/radio/account[?partial=1] — the venue account page with fixture data (development only). */
export default async function AccountPreviewPage({ searchParams }: PageProps<"/dev/preview/radio/account">) {
  const params = await searchParams;
  const bootstrap = previewBootstrap("playing");
  return (
    <StaticPlayer bootstrap={bootstrap} snapshot={previewSnapshot("playing")}>
      <VenueAppShell business={bootstrap.business} email={PREVIEW_EMAIL} links={PREVIEW_LINKS}>
        <AccountPreview partial={params.partial === "1"} />
      </VenueAppShell>
    </StaticPlayer>
  );
}
