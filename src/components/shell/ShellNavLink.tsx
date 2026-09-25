"use client";

import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { ariaCurrentFor, navItemState, type NavMatch } from "./nav-state";

export interface ShellNavLinkProps {
  href: Route;
  /** Default "prefix": nested pages also mark the item (as aria-current="true"). */
  match?: NavMatch;
  /** Classes for every state. */
  className?: string;
  /** Added while current (page or section). Keep it mutually exclusive with `inactiveClassName`. */
  activeClassName?: string;
  inactiveClassName?: string;
  title?: string;
  children: ReactNode;
}

/**
 * The client leaf of the shell navigation: a next/link (client-side navigation keeps the venue
 * player alive) that knows whether it is current. It only takes serialisable props, so shared
 * shell components can render it from Server Components with server-rendered icon children.
 */
export function ShellNavLink({
  href,
  match = "prefix",
  className,
  activeClassName,
  inactiveClassName,
  title,
  children,
}: ShellNavLinkProps) {
  const pathname = usePathname();
  const state = navItemState(pathname, href, match);
  return (
    <Link
      href={href}
      title={title}
      aria-current={ariaCurrentFor(state)}
      data-active={state ? "" : undefined}
      className={cn(className, state ? activeClassName : inactiveClassName)}
    >
      {children}
    </Link>
  );
}
