"use client";

import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { TAB_ACTIVE_CLASSES, TAB_CLASSES, TAB_INACTIVE_CLASSES, TAB_LIST_CLASSES } from "./internal/control-styles";

export interface NavTabItem {
  href: Route;
  label: ReactNode;
  /** Only active on the exact path (default). Set false to also match nested paths. */
  exact?: boolean;
}

export interface NavTabsProps {
  items: readonly NavTabItem[];
  /** Accessible name of the navigation landmark, e.g. "Business sections". */
  label: string;
  className?: string;
}

function pathOf(href: string): string {
  const end = href.search(/[?#]/);
  const path = end === -1 ? href : href.slice(0, end);
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * Tab-styled navigation between routes. Links use next/link (client-side navigation keeps the
 * venue player alive) and the current route gets aria-current="page".
 */
export function NavTabs({ items, label, className }: NavTabsProps) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className={className}>
      <ul className={TAB_LIST_CLASSES}>
        {items.map((item) => {
          const path = pathOf(item.href);
          const exact = item.exact ?? true;
          const active = pathname === path || (!exact && pathname.startsWith(`${path}/`));
          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(TAB_CLASSES, active ? TAB_ACTIVE_CLASSES : TAB_INACTIVE_CLASSES)}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
