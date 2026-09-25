import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { cn } from "@/lib/utils/cn";

export interface SidebarBrandProps {
  /** Where the logo links (the area's home, e.g. "/admin/music" or "/radio"). */
  href: Route;
  /** Small uppercase label under the logo, e.g. "Admin workspace" (write it in sentence case). */
  eyebrow?: ReactNode;
  className?: string;
}

/** Sidebar header: the ivory Frekvencija logo (never with a domain suffix) and an optional eyebrow. */
export function SidebarBrand({ href, eyebrow, className }: SidebarBrandProps) {
  return (
    <div className={cn("px-6 pt-8 pb-6", className)}>
      <Link href={href} className="inline-flex rounded-control">
        <BrandLogo tone="ivory" size="lg" priority className="max-w-full" />
      </Link>
      {eyebrow && <p className="eyebrow mt-4 text-fg-muted">{eyebrow}</p>}
    </div>
  );
}
