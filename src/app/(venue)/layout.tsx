import { unstable_rethrow } from "next/navigation";
import { PlayerProvider } from "@/components/player/PlayerProvider";
import { VenueAppShell } from "@/components/player/VenueAppShell";
import type { PlayerBootstrap, SupportContact } from "@/lib/api/contracts";
import { checkBusinessUserAccess } from "@/lib/auth/access";
import { requireBusinessUserPage } from "@/lib/auth/session";
import { EMPTY_SUPPORT_CONTACT, loadPlayerBootstrap, loadSupportContact } from "@/lib/data/player";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VenueStatusScreen } from "./_components/VenueStatusScreen";

// Per-user content: never prerender or cache this segment.
export const dynamic = "force-dynamic";

/**
 * The owner's contact details (platform_settings, readable by every signed-in user) for the status
 * screens. Never another venue's data; never fails the page.
 */
async function supportContact(): Promise<SupportContact> {
  try {
    return await loadSupportContact(await createSupabaseServerClient());
  } catch (error) {
    unstable_rethrow(error);
    return { ...EMPTY_SUPPORT_CONTACT };
  }
}

/**
 * Venue area (/radio, /account, /help). The PlayerProvider lives here — never in a template — so
 * client-side navigation between venue pages keeps one engine and uninterrupted music; the app
 * shell (sidebar / top bar / tabs) and the persistent player bar come from <VenueAppShell>.
 */
export default async function VenueLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireBusinessUserPage();

  if (!ctx.business) {
    return <VenueStatusScreen variant="no-business" email={ctx.email} support={await supportContact()} />;
  }
  const access = checkBusinessUserAccess(ctx);
  if (!access.ok) {
    return <VenueStatusScreen variant="inactive" email={ctx.email} business={ctx.business} support={await supportContact()} />;
  }

  let bootstrap: PlayerBootstrap;
  try {
    const supabase = await createSupabaseServerClient();
    bootstrap = await loadPlayerBootstrap(supabase, access.ctx);
  } catch (error) {
    // Let Next.js control-flow errors (redirect/notFound/dynamic bail-outs) through.
    unstable_rethrow(error);
    console.error("[venue] could not load the player bootstrap", error);
    return <VenueStatusScreen variant="unavailable" email={ctx.email} business={ctx.business} support={await supportContact()} />;
  }

  return (
    // Keyed by identity: a different user or venue always gets a fresh engine.
    <PlayerProvider key={`${bootstrap.userId}:${bootstrap.business.id}`} bootstrap={bootstrap}>
      <VenueAppShell business={bootstrap.business} email={ctx.email || null}>
        {children}
      </VenueAppShell>
    </PlayerProvider>
  );
}
