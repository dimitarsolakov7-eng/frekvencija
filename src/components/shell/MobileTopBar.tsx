import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { cn } from "@/lib/utils/cn";

export interface MobileTopBarProps {
  /** Right side: avatar, menu button… (keep controls ≥44px). */
  right?: ReactNode;
  /** Where the logo links. Default "/". */
  href?: Route;
  className?: string;
}

/** 64px top bar for screens below 1024px (screen 04): logo left, avatar/menu right. */
export function MobileTopBar({ right, href = "/", className }: MobileTopBarProps) {
  return (
    <div className={cn("flex h-16 items-center justify-between gap-3 px-page", className)}>
      <Link href={href} className="inline-flex shrink-0 rounded-control">
        <BrandLogo tone="ivory" size="md" priority />
      </Link>
      {right && <div className="flex min-w-0 items-center gap-2">{right}</div>}
    </div>
  );
}
