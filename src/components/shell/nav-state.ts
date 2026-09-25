/** How a navigation item matches the current path. */
export type NavMatch = "exact" | "prefix";

/**
 * "page" when the item is the current page, "section" when the current page is nested inside it
 * (e.g. /admin/businesses/42 under Businesses, with `match: "prefix"`), otherwise null.
 */
export type NavItemState = "page" | "section" | null;

/** Path without query/hash and without trailing slashes ("/" stays "/"). */
export function normalizePath(path: string): string {
  const end = path.search(/[?#]/);
  const bare = end === -1 ? path : path.slice(0, end);
  const trimmed = bare.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function navItemState(pathname: string | null | undefined, href: string, match: NavMatch = "prefix"): NavItemState {
  if (!pathname) return null;
  const path = normalizePath(pathname);
  const target = normalizePath(href);
  if (path === target) return "page";
  if (match === "prefix" && target !== "/" && path.startsWith(`${target}/`)) return "section";
  return null;
}

/** aria-current value for a nav state: "page" for the page itself, "true" for its section. */
export function ariaCurrentFor(state: NavItemState): "page" | "true" | undefined {
  if (state === "page") return "page";
  if (state === "section") return "true";
  return undefined;
}
