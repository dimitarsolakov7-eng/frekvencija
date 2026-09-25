import type { Metadata } from "next";
import { RadioScreen } from "@/components/player/RadioScreen";
import { VenueAppShell } from "@/components/player/VenueAppShell";
import { PREVIEW_EMAIL, PREVIEW_LINKS, isPreviewState, previewBootstrap, previewSnapshot } from "./fixtures";
import { PreviewStateNav } from "./PreviewStateNav";
import { StaticPlayer } from "./StaticPlayer";

export const metadata: Metadata = { title: "Radio preview" };

// Reads the state from the query string on every request.
export const dynamic = "force-dynamic";

/**
 * /dev/preview/radio?state=… — the real venue radio screens (app shell, RadioScreen, player bar)
 * with fixture data for every playback state, for visual review without Supabase. Development only
 * (the /dev layout 404s in production).
 */
export default async function RadioPreviewPage({ searchParams }: PageProps<"/dev/preview/radio">) {
  const params = await searchParams;
  const raw = Array.isArray(params.state) ? params.state[0] : params.state;
  const state = isPreviewState(raw) ? raw : "playing";
  const bootstrap = previewBootstrap(state);

  return (
    <StaticPlayer key={state} bootstrap={bootstrap} snapshot={previewSnapshot(state)}>
      <VenueAppShell business={bootstrap.business} email={PREVIEW_EMAIL} links={PREVIEW_LINKS}>
        <PreviewStateNav current={state} />
        <RadioScreen />
      </VenueAppShell>
    </StaticPlayer>
  );
}
