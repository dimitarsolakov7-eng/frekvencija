import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { ButtonLink } from "@/components/ui";
import { PLATFORM_NAME } from "@/config/platform";
import type { AppRole } from "@/types/database";
import { cn } from "@/lib/utils/cn";
import { PUBLIC_CONTAINER, PUBLIC_HEADER_HEIGHT_CLASS, PUBLIC_NAV_LINK_CLASSES } from "./layout";

export interface PublicHeaderProps {
  /** Role of the signed-in visitor, or null when signed out. */
  viewerRole: AppRole | null;
}

/** "Log in" for visitors; signed-in users get a direct way back into their own area instead. */
export function accountLinkFor(role: AppRole | null): { href: "/login" | "/radio" | "/admin"; label: string } {
  if (role === "platform_admin") return { href: "/admin", label: "Admin workspace" };
  if (role === "business_user") return { href: "/radio", label: "Open radio" };
  return { href: "/login", label: "Log in" };
}

/**
 * Public site header (screen 01): logo, section links, account link and the Request access button.
 * It has no background of its own, so on the homepage the hero photo shows through behind it.
 */
export function PublicHeader({ viewerRole }: PublicHeaderProps) {
  const account = accountLinkFor(viewerRole);
  const signedIn = viewerRole !== null;

  return (
    <header className="relative z-20">
      <div className={cn(PUBLIC_CONTAINER, PUBLIC_HEADER_HEIGHT_CLASS, "flex items-center gap-3 sm:gap-8")}>
        <Link href="/" aria-label={`${PLATFORM_NAME} home`} className="shrink-0 rounded-control py-1">
          <BrandLogo size="md" />
        </Link>

        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            <li>
              <Link href="/#how-it-works" className={PUBLIC_NAV_LINK_CLASSES}>
                How it works
              </Link>
            </li>
            <li>
              <Link href="/#genres" className={PUBLIC_NAV_LINK_CLASSES}>
                Genres
              </Link>
            </li>
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          <Link
            href={account.href}
            className={cn(PUBLIC_NAV_LINK_CLASSES, signedIn && "gap-1.5 text-fg hover:text-accent-text")}
          >
            {account.label}
            {signedIn && <ArrowRight aria-hidden="true" className="size-4" />}
          </Link>
          <ButtonLink
            href="/request-access"
            size="md"
            className={cn("max-sm:px-3 sm:px-5", signedIn && "max-sm:hidden")}
          >
            Request access
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
