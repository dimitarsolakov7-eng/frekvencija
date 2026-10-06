import type { Route } from "next";

/**
 * Where the venue navigation points. The dev lab and previews swap in their own routes.
 *
 * Kept out of the "use client" context module on purpose: a Server Component (VenueAppShell) that
 * imports a plain value from a "use client" file receives a client-reference placeholder, not the
 * object, so every link would be `undefined` at render time.
 */
export interface VenueLinks {
  radio: Route;
  account: Route;
  help: Route;
}

export const VENUE_LINKS: VenueLinks = { radio: "/radio", account: "/account", help: "/help" };
