import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand";
import { SkipLink } from "@/components/ui";
import { PLATFORM_DOMAIN, PLATFORM_NAME } from "@/config/platform";
import { cn } from "@/lib/utils/cn";

export interface AuthShellProps {
  children: ReactNode;
  /** "md" for single forms, "lg" for wider content such as the setup checklist. */
  width?: "md" | "lg";
}

/**
 * Centered shell for wide account pages that don't fit the split form column (the /setup checklist).
 * Works without Supabase: it renders only static branding.
 */
export function AuthShell({ children, width = "md" }: AuthShellProps) {
  return (
    <>
      <SkipLink />
      <div className="flex flex-1 flex-col items-center px-4 py-10 sm:justify-center sm:px-6 sm:py-16">
        <header className="mb-8 flex justify-center">
          <Link href="/" aria-label={`${PLATFORM_NAME} home`} className="rounded-control p-1">
            <BrandLogo size="lg" />
          </Link>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className={cn("w-full focus:outline-none", width === "md" ? "max-w-md" : "max-w-2xl")}
        >
          {children}
        </main>
        <footer className="mt-10 text-center text-sm text-fg-muted">{PLATFORM_DOMAIN}</footer>
      </div>
    </>
  );
}
