import type { ReactNode } from "react";
import { CircleHelp, Radio, UserRound } from "lucide-react";
import {
  AppShell,
  MobileTabBar,
  MobileTopBar,
  SidebarBrand,
  SidebarButton,
  SidebarIdentity,
  SidebarNav,
  SidebarSection,
} from "@/components/shell";
import type { PlayerBusiness } from "@/lib/api/contracts";
import { PlayerBar } from "./PlayerBar";
import { venueInitial } from "./player-view";
import { VenueAccountMenu } from "./VenueAccountMenu";
import { VENUE_LINKS, VenueShellProvider, type VenueLinks } from "./venue-shell-context";
import { VenueSignOutButton } from "./VenueSignOutButton";

export interface VenueAppShellProps {
  business: Pick<PlayerBusiness, "name" | "logoUrl">;
  /** Signed-in email for the account menu. */
  email?: string | null;
  /** Navigation targets; defaults to /radio, /account and /help (the dev lab/previews pass their own). */
  links?: VenueLinks;
  children: ReactNode;
}

/**
 * The venue area frame (screens 03/04) around /radio, /account and /help. Render it inside
 * <PlayerProvider> (or a <PlayerContextProvider>): the persistent player bar and the sign-out
 * controls use the player context.
 *
 * - ≥1024px: sidebar with the Frekvencija logo, the venue identity, Your radio / Account, and Help +
 *   Sign out at the bottom.
 * - <1024px: top bar (logo + venue avatar menu: Account, Help, Sign out) and Radio / Account tabs.
 * - The player bar sits at the bottom of the main column (above the tabs on small screens).
 */
export function VenueAppShell({ business, email = null, links = VENUE_LINKS, children }: VenueAppShellProps) {
  return (
    <VenueShellProvider links={links} email={email}>
      <AppShell
        sidebar={
          <>
            <SidebarBrand href={links.radio} />
            <SidebarIdentity name={business.name} initials={venueInitial(business.name)} imageUrl={business.logoUrl} />
            <SidebarNav
              label="Venue"
              items={[
                { href: links.radio, label: "Your radio", icon: Radio, match: "exact" },
                { href: links.account, label: "Account", icon: UserRound, match: "exact" },
              ]}
            />
            <SidebarSection label="Help and sign out">
              <SidebarButton href={links.help} match="exact" label="Help" icon={CircleHelp} />
              <VenueSignOutButton />
            </SidebarSection>
          </>
        }
        mobileHeader={<MobileTopBar href={links.radio} right={<VenueAccountMenu name={business.name} logoUrl={business.logoUrl} />} />}
        mobileNav={
          <MobileTabBar
            label="Venue"
            items={[
              { href: links.radio, label: "Radio", icon: Radio, match: "exact" },
              { href: links.account, label: "Account", icon: UserRound, match: "exact" },
            ]}
          />
        }
        playerBar={<PlayerBar />}
      >
        {children}
      </AppShell>
    </VenueShellProvider>
  );
}
