/** Admin navigation model (pure; the shell maps icon keys to lucide icons). */
import { navItemState, type NavItemState } from "@/components/shell/nav-state";

export type AdminNavIcon = "music" | "genres" | "businesses" | "announcements" | "settings";

export type AdminNavHref =
  | "/admin/music"
  | "/admin/genres"
  | "/admin/businesses"
  | "/admin/announcements"
  | "/admin/settings";

export interface AdminNavItem {
  href: AdminNavHref;
  label: string;
  icon: AdminNavIcon;
  /** Only current on the exact path; otherwise nested pages (e.g. /admin/businesses/42) count too. */
  exact: boolean;
}

/** Where /admin and the sidebar logo lead. */
export const ADMIN_HOME_PATH = "/admin/music";

/** Main sidebar navigation (screens 05–08). */
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin/music", label: "Music library", icon: "music", exact: false },
  { href: "/admin/genres", label: "Genres", icon: "genres", exact: false },
  { href: "/admin/businesses", label: "Businesses", icon: "businesses", exact: false },
  { href: "/admin/announcements", label: "Announcements", icon: "announcements", exact: false },
];

/** Bottom-of-sidebar links (Sign out is a form POST, not a nav item). */
export const ADMIN_SECONDARY_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin/settings", label: "Settings", icon: "settings", exact: false },
];

/**
 * "page" when the item is the current page, "section" when the current page is nested inside it
 * (e.g. a business detail page under Businesses), otherwise null.
 */
export function adminNavItemState(pathname: string | null, item: Pick<AdminNavItem, "href" | "exact">): NavItemState {
  return navItemState(pathname, item.href, item.exact ? "exact" : "prefix");
}
