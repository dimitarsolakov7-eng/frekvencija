"use client";

import { createContext, use, type ReactNode } from "react";
import type { Route } from "next";

/** Where the venue navigation points. The dev lab and previews swap in their own routes. */
export interface VenueLinks {
  radio: Route;
  account: Route;
  help: Route;
}

export const VENUE_LINKS: VenueLinks = { radio: "/radio", account: "/account", help: "/help" };

export interface VenueShellInfo {
  links: VenueLinks;
  /** The signed-in email, shown in the account menu (null when unknown). */
  email: string | null;
}

const DEFAULT_SHELL_INFO: VenueShellInfo = { links: VENUE_LINKS, email: null };

const VenueShellContext = createContext<VenueShellInfo>(DEFAULT_SHELL_INFO);

/** Rendered by <VenueAppShell>; lets page content (e.g. the /radio header menu) use the same links. */
export function VenueShellProvider({ links, email, children }: VenueShellInfo & { children: ReactNode }) {
  return <VenueShellContext value={{ links, email }}>{children}</VenueShellContext>;
}

export function useVenueShell(): VenueShellInfo {
  return use(VenueShellContext);
}
