"use client";

import { CircleHelp, LogOut, UserRound } from "lucide-react";
import { UserMenu } from "@/components/shell/UserMenu";
import { signOutOfVenue, useOptionalPlayer } from "./PlayerProvider";
import { venueInitial } from "./player-view";
import { useVenueShell } from "./venue-shell-context";

export interface VenueAccountMenuProps {
  /** Venue name (menu trigger name and header). */
  name: string;
  /** Signed venue logo URL; falls back to the venue's initials. */
  logoUrl?: string | null;
  className?: string;
}

/**
 * The venue avatar with its account menu (mobile top bar, /radio header): Account, Help and Sign
 * out. Sign out runs the venue logout, which stops the player first.
 */
export function VenueAccountMenu({ name, logoUrl, className }: VenueAccountMenuProps) {
  const player = useOptionalPlayer();
  const { links, email } = useVenueShell();
  return (
    <UserMenu
      compact
      name={name}
      initials={venueInitial(name)}
      email={email}
      imageUrl={logoUrl}
      className={className}
      items={[
        { label: "Account", href: links.account, icon: UserRound },
        { label: "Help", href: links.help, icon: CircleHelp },
        {
          label: "Sign out",
          icon: LogOut,
          onSelect: () => {
            void (player ? player.signOut() : signOutOfVenue());
          },
        },
      ]}
    />
  );
}
