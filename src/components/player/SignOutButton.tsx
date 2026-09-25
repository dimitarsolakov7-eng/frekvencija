"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { signOutOfVenue, useOptionalPlayer } from "./PlayerProvider";

export interface SignOutButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  label?: string;
}

/**
 * Stops the player (when there is one), clears its session state, signs out and goes to /login.
 * Works inside and outside <PlayerProvider> (the "venue inactive" screens have no player).
 */
export function SignOutButton({ variant = "ghost", size = "md", className, label = "Sign out" }: SignOutButtonProps) {
  const player = useOptionalPlayer();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      icon={<LogOut aria-hidden="true" />}
      loading={pending}
      loadingText="Signing out…"
      onClick={async () => {
        setPending(true);
        if (player) await player.signOut();
        else await signOutOfVenue();
      }}
    >
      {label}
    </Button>
  );
}
