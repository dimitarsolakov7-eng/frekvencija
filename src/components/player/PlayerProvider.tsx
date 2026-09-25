"use client";

/**
 * One PlayerEngine per venue session (docs/ARCHITECTURE.md §9). Mounted by src/app/(venue)/layout.tsx,
 * so navigating between /radio, /account and /help keeps the same engine and the music keeps playing.
 *
 * - The engine is created in an effect (never during render) and destroyed on unmount. Strict Mode's
 *   double mount is safe: destroy() is idempotent and a fresh engine is attached on the re-mount.
 * - State reaches React through useSyncExternalStore with a static idle snapshot for the server.
 * - Commands are stable functions that call the engine synchronously; call them straight from
 *   click/keydown handlers so play() stays inside the user gesture.
 * - The engine saves playback preferences (genre, volume, mute) itself; nothing here saves them again.
 * - Other tabs share this browser's session: when one signs out or signs in as another venue, this
 *   player stops and the page reloads (venue-session.ts), so two venues are never mixed.
 *
 * The dev player lab and the dev previews supply their own context value through
 * <PlayerContextProvider> (lab engine / static fixture), so the same screens render there.
 */
import { createContext, use, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PlayerBootstrap, SignedMedia } from "@/lib/api/contracts";
import { safeNextPath } from "@/lib/auth/redirects";
import { createPlayerApi } from "@/lib/player/api-client";
import { clearPlayerSessionState, createBrowserEngineDeps } from "@/lib/player/browser";
import { createPlayerEngine } from "@/lib/player/engine";
import type { EngineDeps, PlayerCommands, PlayerSnapshot } from "@/lib/player/types";
import { PlayerEngineStore } from "./engine-store";
import { useFlagPreference, useScreenWakeLock, type ScreenWakeLockState } from "./hooks";
import { keepAwakePreference } from "./local-preference";
import { createIdleSnapshot, isAudioActive, toEngineConfig } from "./player-view";
import { announceVenueSignedOut, followVenueSession } from "./venue-session";

export interface ScreenWakeLockControl extends ScreenWakeLockState {
  /** The listener asked to keep the screen awake while music plays (saved per browser). */
  enabled: boolean;
  setEnabled(enabled: boolean): void;
}

export interface SignOutOptions {
  /** Same-origin path to land on after signing out. Default "/login". */
  destination?: string;
}

export interface PlayerContextValue {
  snapshot: PlayerSnapshot;
  commands: PlayerCommands;
  bootstrap: PlayerBootstrap;
  /** Stops audio, clears the player's session state, signs out and leaves for /login (or `destination`). */
  signOut(options?: SignOutOptions): Promise<void>;
  wakeLock: ScreenWakeLockControl;
  /**
   * Signs one of the venue's own announcements for the station-voice Preview (POST /api/media/sign
   * in the app). The result is played in a separate element, never through the engine.
   */
  signAnnouncement(id: string, signal?: AbortSignal): Promise<SignedMedia>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/** Diagnostic engine events in the browser console during development only. */
const devLog: EngineDeps["log"] =
  process.env.NODE_ENV === "production"
    ? undefined
    : (event, detail) => {
        console.debug(`[player] ${event}`, detail ?? "");
      };

/**
 * Logout sequence shared by the sidebar, the account menu, the account page and the session-expired
 * notice: engine.destroy() → clearPlayerSessionState() → POST /auth/signout → tell the other tabs →
 * hard navigation. Only a same-origin path is accepted as `destination` (safeNextPath), else /login.
 */
export async function signOutOfVenue(destroyEngine?: () => void, options: SignOutOptions = {}): Promise<void> {
  try {
    destroyEngine?.();
  } catch (error) {
    // Never let a player problem keep someone signed in.
    console.error("[player] stopping the player failed", error);
  }
  clearPlayerSessionState();
  try {
    // `manual`: the 303 → /login is followed by the hard navigation below, not by fetch.
    await fetch("/auth/signout", { method: "POST", credentials: "same-origin", redirect: "manual" });
  } catch (error) {
    // Offline or the server is unreachable: /login still shows the sign-in state honestly.
    console.error("[player] sign-out request failed", error);
  }
  // The other tabs share the (now cleared) session cookies: their players must stop too (PLAY-01).
  announceVenueSignedOut();
  window.location.replace(safeNextPath(options.destination, "/login"));
}

/** Supplies a ready-made player context (dev lab engine, static dev previews). */
export function PlayerContextProvider({ value, children }: { value: PlayerContextValue; children: ReactNode }) {
  return <PlayerContext value={value}>{children}</PlayerContext>;
}

export interface PlayerProviderProps {
  bootstrap: PlayerBootstrap;
  children: ReactNode;
}

export function PlayerProvider({ bootstrap, children }: PlayerProviderProps) {
  // The engine configuration is fixed for the lifetime of this provider (the layout keys the
  // provider by user + venue). Later bootstrap props, e.g. after a refresh, only update the UI data.
  const [session] = useState(() => {
    const config = toEngineConfig(bootstrap);
    const store = new PlayerEngineStore(
      createIdleSnapshot({ genreId: config.initialGenreId, volume: config.initialVolume, muted: config.initialMuted }),
    );
    // Creating the client has no side effects; it only issues requests when called.
    return { config, store, api: createPlayerApi() };
  });
  const { store, api } = session;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  useEffect(() => {
    const engine = createPlayerEngine(createBrowserEngineDeps({ api: session.api, log: devLog }), session.config);
    store.attach(engine);
    return () => {
      store.detach(engine);
      engine.destroy();
    };
  }, [session, store]);

  // Another tab signed out, or signed this browser in as someone else (PLAY-01): every request from
  // this tab would now carry that session. Stop at once without saving this tab's pending
  // preferences into the other account, forget this session's welcome, and reload into whatever the
  // browser is signed in as now, so another venue's announcements never play under this venue's name.
  useEffect(
    () =>
      followVenueSession({ userId: session.config.userId, businessId: session.config.businessId }, () => {
        store.destroyEngine({ savePreferences: false });
        clearPlayerSessionState();
        window.location.reload();
      }),
    [session, store],
  );

  const [keepAwake, setKeepAwake] = useFlagPreference(keepAwakePreference);
  const wakeLock = useScreenWakeLock(keepAwake && isAudioActive(snapshot.status));

  const value: PlayerContextValue = {
    snapshot,
    commands: store.commands,
    bootstrap,
    signOut: (options) => signOutOfVenue(() => store.destroyEngine(), options),
    wakeLock: { ...wakeLock, enabled: keepAwake, setEnabled: setKeepAwake },
    signAnnouncement: (id, signal) => api.signMedia({ kind: "announcement", id }, signal),
  };

  return <PlayerContext value={value}>{children}</PlayerContext>;
}

/** Player state and commands. Only valid below <PlayerProvider> (the venue area). */
export function usePlayer(): PlayerContextValue {
  const value = use(PlayerContext);
  if (!value) throw new Error("usePlayer() must be used inside <PlayerProvider>.");
  return value;
}

/** Like usePlayer(), but returns null outside the venue player (e.g. on the "venue inactive" screen). */
export function useOptionalPlayer(): PlayerContextValue | null {
  return use(PlayerContext);
}
