"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { SidebarButton } from "@/components/shell/SidebarButton";
import { signOutOfVenue, useOptionalPlayer } from "./PlayerProvider";

/**
 * Sidebar "Sign out" row for the venue area. It runs the venue logout (stop the engine, clear the
 * player's session state, POST /auth/signout, go to /login) instead of a plain form POST, so no
 * audio keeps playing on a signed-out page.
 */
export function VenueSignOutButton() {
  const player = useOptionalPlayer();
  const [pending, setPending] = useState(false);
  return (
    <SidebarButton
      label={pending ? "Signing out…" : "Sign out"}
      icon={LogOut}
      disabled={pending}
      onClick={() => {
        setPending(true);
        void (player ? player.signOut() : signOutOfVenue());
      }}
    />
  );
}
