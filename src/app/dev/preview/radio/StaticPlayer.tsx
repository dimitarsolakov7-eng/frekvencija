"use client";

import { useReducer, useState, type ReactNode } from "react";
import { useFlagPreference, useScreenWakeLock } from "@/components/player/hooks";
import { keepAwakePreference } from "@/components/player/local-preference";
import { PlayerContextProvider, type PlayerContextValue } from "@/components/player/PlayerProvider";
import type { PlayerBootstrap, SignedMedia } from "@/lib/api/contracts";
import type { PlayerCommands, PlayerSnapshot } from "@/lib/player/types";
import { applyPreviewCommand } from "./fixtures";

export interface StaticPlayerProps {
  bootstrap: PlayerBootstrap;
  snapshot: PlayerSnapshot;
  children: ReactNode;
}

/**
 * Player context for the dev previews: a fixture snapshot that reacts to the controls (play/pause,
 * genre, volume) through applyPreviewCommand, with no engine, no network and no sign-out. The
 * station-voice Preview plays the synthetic demo clip from /api/dev/audio when it exists.
 */
export function StaticPlayer({ bootstrap, snapshot: initial, children }: StaticPlayerProps) {
  const [snapshot, dispatch] = useReducer(applyPreviewCommand, initial);
  const [keepAwake, setKeepAwake] = useFlagPreference(keepAwakePreference);
  // Nothing plays in a preview, so the lock is never requested; the switch still reflects support.
  const wakeLock = useScreenWakeLock(false);
  const [commands] = useState<PlayerCommands>(() => ({
    start: () => dispatch({ type: "play" }),
    resume: () => dispatch({ type: "play" }),
    togglePlay: () => dispatch({ type: "play" }),
    pause: () => dispatch({ type: "pause" }),
    skip: () => dispatch({ type: "skip" }),
    retry: () => dispatch({ type: "retry" }),
    selectGenre: (genreId) => dispatch({ type: "select", genreId }),
    setVolume: (volume) => dispatch({ type: "volume", volume }),
    setMuted: (muted) => dispatch({ type: "muted", muted }),
    destroy: () => undefined,
  }));

  const value: PlayerContextValue = {
    snapshot,
    commands,
    bootstrap,
    signOut: async () => undefined,
    wakeLock: { ...wakeLock, enabled: keepAwake, setEnabled: setKeepAwake },
    signAnnouncement: async (id): Promise<SignedMedia> => {
      const clip = bootstrap.announcements.find((item) => item.id === id);
      return {
        kind: "announcement",
        id,
        url: `/api/dev/audio/${encodeURIComponent(id)}`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        durationSeconds: clip?.durationSeconds ?? null,
      };
    },
  };

  return <PlayerContextProvider value={value}>{children}</PlayerContextProvider>;
}
