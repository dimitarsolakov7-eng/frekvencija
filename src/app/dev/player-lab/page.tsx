import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui";
import { DemoManifestError, loadDemoManifest } from "@/app/api/dev/_lib/demo-manifest";
import { buildLabCatalog, type LabCatalog } from "./lab-catalog";
import { PlayerLab } from "./PlayerLab";

export const metadata: Metadata = { title: "Player lab" };

// Re-read the manifest on every request (it changes when `npm run demo:audio` runs).
export const dynamic = "force-dynamic";

/**
 * /dev/player-lab — development-only harness (the /dev layout 404s in production). Renders the real
 * venue radio inside the venue app shell, driven by the real PlayerEngine with real browser audio
 * against an in-browser fake API and the synthetic demo audio, so it works without Supabase.
 */
export default async function PlayerLabPage() {
  let catalog: LabCatalog | null = null;
  let problem: string | null = null;
  try {
    const manifest = await loadDemoManifest();
    catalog = buildLabCatalog(manifest.notice, manifest.entries);
  } catch (error) {
    if (!(error instanceof DemoManifestError)) throw error;
    problem = error.message;
  }

  if (catalog) return <PlayerLab catalog={catalog} />;

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto grid w-full max-w-3xl gap-6 px-page py-10 focus:outline-none">
      <PageHeader
        title="Player lab"
        description="Runs the real venue radio with the real PlayerEngine against a fake in-browser API and synthetic demo audio."
        breadcrumbs={[{ label: "Developer tools" }, { label: "Player lab" }]}
        className="pb-0"
      />
      <Alert tone="danger" title="Demo audio is not available" description={problem} />
    </main>
  );
}
