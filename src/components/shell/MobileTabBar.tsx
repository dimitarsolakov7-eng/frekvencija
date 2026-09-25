import type { CSSProperties } from "react";
import type { Route } from "next";
import { renderIcon, type IconLike } from "@/components/ui/internal/render-icon";
import { cn } from "@/lib/utils/cn";
import type { NavMatch } from "./nav-state";
import { ShellNavLink } from "./ShellNavLink";

export interface MobileTabBarItem {
  href: Route;
  label: string;
  /** A lucide icon component (`Radio`) or element (`<Radio />`). */
  icon?: IconLike;
  /** Default "prefix". */
  match?: NavMatch;
}

function columns(count: number): CSSProperties {
  return { gridTemplateColumns: `repeat(${Math.max(1, count)}, minmax(0, 1fr))` };
}

export interface MobileTabBarProps {
  items: readonly MobileTabBarItem[];
  /** Accessible name of the navigation landmark. Default "Main". */
  label?: string;
  className?: string;
}

/**
 * Bottom tab navigation below 1024px (screen 04 "Radio / Account"): equal-width 64px tabs, the
 * current one emerald with an underline and aria-current="page". Uses next/link, so switching
 * tabs never reloads the page (the venue player keeps playing).
 */
export function MobileTabBar({ items, label = "Main", className }: MobileTabBarProps) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="grid" style={columns(items.length)}>
        {items.map((item) => (
          <li key={item.href} className="flex">
            <ShellNavLink
              href={item.href}
              match={item.match}
              className={cn(
                "relative flex h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                "focus-visible:-outline-offset-4 [&_svg]:size-6 [&_svg]:shrink-0",
                "after:absolute after:inset-x-[22%] after:bottom-0 after:h-[3px] after:rounded-full",
              )}
              activeClassName="text-accent-text after:bg-accent"
              inactiveClassName="text-fg-muted hover:text-fg"
            >
              {renderIcon(item.icon)}
              <span className="max-w-full truncate px-1">{item.label}</span>
            </ShellNavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
