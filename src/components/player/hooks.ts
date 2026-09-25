"use client";

/**
 * Browser-only React hooks for the venue player: per-viewer flags, the Screen Wake Lock and the
 * player keyboard shortcuts. Everything touching `window`/`navigator` runs in effects or behind
 * useSyncExternalStore server snapshots, so server and client renders always match.
 */
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import type { FlagPreference } from "./local-preference";
import { isModalDialogOpen, isPopupOpen, playerShortcutFor, type PlayerShortcut } from "./shortcuts";

/** Reads and updates a localStorage-backed on/off preference. */
export function useFlagPreference(preference: FlagPreference): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(preference.subscribe, preference.getSnapshot, preference.getServerSnapshot);
  return [value, preference.set];
}

const noopSubscribe = () => () => {};

function wakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator && typeof navigator.wakeLock?.request === "function";
}

export interface ScreenWakeLockState {
  /** The browser offers the Screen Wake Lock API (false during the server render). */
  supported: boolean;
  /** A lock is currently held. */
  active: boolean;
  /** Why the last request failed, in plain words; null when fine. */
  error: string | null;
}

function describeWakeLockError(error: unknown): string {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  if (name === "NotAllowedError") {
    return "The browser refused to keep the screen awake right now (for example on low battery or power saving).";
  }
  return "The screen could not be kept awake on this device.";
}

/**
 * Holds a screen wake lock while `shouldHold` is true. Browsers release the lock whenever the page
 * is hidden, so it is re-requested when the page becomes visible again. It only stops the screen
 * from sleeping; it cannot stop the computer from sleeping or the browser from closing.
 */
export function useScreenWakeLock(shouldHold: boolean): ScreenWakeLockState {
  const supported = useSyncExternalStore(noopSubscribe, wakeLockSupported, () => false);
  // `held` is the sentinel currently holding the lock, so a late "release" event of an older lock
  // can never mark a newer one as released.
  const [lock, setLock] = useState<{ held: WakeLockSentinel | null; error: string | null }>({ held: null, error: null });

  useEffect(() => {
    if (!supported || !shouldHold) return;
    let cancelled = false;
    let sentinel: WakeLockSentinel | null = null;
    let requesting = false;

    const request = async () => {
      if (cancelled || sentinel || requesting || document.visibilityState !== "visible") return;
      requesting = true;
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await acquired.release().catch(() => undefined);
          return;
        }
        sentinel = acquired;
        acquired.addEventListener("release", () => {
          if (sentinel === acquired) sentinel = null;
          setLock((previous) => (previous.held === acquired ? { ...previous, held: null } : previous));
        });
        setLock({ held: acquired, error: null });
      } catch (error) {
        if (!cancelled) setLock({ held: null, error: describeWakeLockError(error) });
      } finally {
        requesting = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const held = sentinel;
      sentinel = null;
      // Its "release" event clears `held` asynchronously.
      if (held) void held.release().catch(() => undefined);
    };
  }, [supported, shouldHold]);

  const holding = supported && shouldHold;
  return { supported, active: holding && lock.held !== null, error: holding ? lock.error : null };
}

/**
 * Listens for the player shortcuts on the document while `enabled`. `onShortcut` returns true when
 * it handled the key (only then is the browser default, such as Space scrolling, prevented). Keys
 * are ignored while a modal dialog, a menu or another popup is open (see playerShortcutFor for
 * fields, focused popups and modifier chords). The handler runs synchronously inside the keydown,
 * so a play() it triggers keeps the user's gesture.
 */
export function usePlayerShortcuts(enabled: boolean, onShortcut: (shortcut: PlayerShortcut) => boolean): void {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const shortcut = playerShortcutFor(event);
    if (!shortcut || isModalDialogOpen(document) || isPopupOpen(document)) return;
    if (onShortcut(shortcut)) event.preventDefault();
  });

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [enabled]);
}
