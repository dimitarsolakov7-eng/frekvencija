import type { Route } from "next";
import { renderIcon, type IconLike } from "@/components/ui/internal/render-icon";
import { cn } from "@/lib/utils/cn";
import type { NavMatch } from "./nav-state";
import { ShellNavLink } from "./ShellNavLink";
import { SIDEBAR_ROW_ACTIVE_CLASSES, SIDEBAR_ROW_CLASSES, SIDEBAR_ROW_INACTIVE_CLASSES } from "./sidebar-styles";

export interface SidebarNavItem {
  href: Route;
  label: string;
  /** A lucide icon component (`Music`) or element (`<Music />`). */
  icon?: IconLike;
  /** "prefix" (default): nested pages keep the item current. "exact": only the page itself. */
  match?: NavMatch;
}

export interface SidebarNavProps {
  /** Accessible name of the navigation landmark, e.g. "Admin" or "Main". */
  label: string;
  items: readonly SidebarNavItem[];
  className?: string;
}

/**
 * Primary sidebar navigation. The current page gets aria-current="page" (a nested page marks its
 * section with aria-current="true") and the emerald-tinted pill. Renders on the server; only the
 * links' current-state logic runs on the client.
 */
export function SidebarNav({ label, items, className }: SidebarNavProps) {
  return (
    <nav aria-label={label} className={cn("px-3", className)}>
      <ul className="grid gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <ShellNavLink
              href={item.href}
              match={item.match}
              className={SIDEBAR_ROW_CLASSES}
              activeClassName={SIDEBAR_ROW_ACTIVE_CLASSES}
              inactiveClassName={SIDEBAR_ROW_INACTIVE_CLASSES}
            >
              {renderIcon(item.icon)}
              <span className="truncate">{item.label}</span>
            </ShellNavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
