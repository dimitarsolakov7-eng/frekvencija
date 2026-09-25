import Link from "next/link";
import { BrandLogo } from "@/components/brand";
import { PLATFORM_DOMAIN, PLATFORM_NAME } from "@/config/platform";
import { cn } from "@/lib/utils/cn";
import { PUBLIC_CONTAINER } from "./layout";

const FOOTER_LINKS = [
  { href: "/request-access", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

/** Public site footer: logo, domain, Contact (the access/contact form), Privacy and Terms. */
export function PublicFooter() {
  return (
    <footer className="border-t border-border">
      <div
        className={cn(
          PUBLIC_CONTAINER,
          "flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        )}
      >
        <div className="flex items-center gap-4">
          <Link href="/" aria-label={`${PLATFORM_NAME} home`} className="rounded-control py-1">
            <BrandLogo size="sm" />
          </Link>
          <span aria-hidden="true" className="h-6 w-px bg-border" />
          <p className="text-sm text-fg-muted">{PLATFORM_DOMAIN}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
            {FOOTER_LINKS.map((link, index) => (
              <li key={link.href} className="flex items-center">
                {index > 0 && <span aria-hidden="true" className="mr-1 h-4 w-px bg-border" />}
                <Link
                  href={link.href}
                  className="inline-flex h-11 items-center rounded-control px-3 text-fg-muted transition-colors hover:text-fg"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
