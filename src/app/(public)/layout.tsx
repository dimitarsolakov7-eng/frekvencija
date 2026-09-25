import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { SkipLink } from "@/components/ui";
import { getPublicViewer } from "@/lib/data/public";

// The header adapts to the visitor's session ("Open radio" / "Admin workspace").
export const dynamic = "force-dynamic";

/**
 * Public website shell (homepage, request access, privacy, terms): header, main landmark, footer.
 * Renders without Supabase (setup mode) — the visitor then simply counts as signed out.
 */
export default async function PublicLayout({ children }: LayoutProps<"/">) {
  const viewer = await getPublicViewer();
  return (
    <>
      <SkipLink />
      <PublicHeader viewerRole={viewer?.role ?? null} />
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
        {children}
      </main>
      <PublicFooter />
    </>
  );
}
