"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Split panels start here (docs/REDESIGN.md §1: desktop ≥ 1024px). */
export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

/**
 * Live `matchMedia` result. The server (and the first hydration pass) reports false, so layouts must
 * not depend on it for their initial markup — use it to decide behaviour (drawer vs inline editor,
 * which copy of a player may hold an <audio> element), and CSS breakpoints for layout.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Whether the viewport is at the desktop breakpoint right now (for event handlers). */
export function isDesktopViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}
