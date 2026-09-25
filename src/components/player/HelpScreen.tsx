"use client";

import { HelpView } from "./HelpView";
import { usePlayer } from "./PlayerProvider";
import { useVenueShell } from "./venue-shell-context";

/** /help over the player context: the venue's interval, its clips and the owner's contact details. */
export function HelpScreen() {
  const { bootstrap } = usePlayer();
  const { links } = useVenueShell();
  const { announcements, business, support } = bootstrap;
  return (
    <HelpView
      everyNTracks={business.announcementEveryNTracks}
      hasRotation={announcements.some((clip) => clip.placement === "rotation" || clip.placement === "both")}
      hasWelcome={announcements.some((clip) => clip.placement === "welcome" || clip.placement === "both")}
      support={support}
      accountHref={links.account}
    />
  );
}
