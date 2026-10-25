"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu } from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { ButtonLink, Drawer, IconButton } from "@/components/ui";
import { SECTION_IDS, sectionHref } from "@/config/site";
import { PLATFORM_NAME } from "@/config/platform";
import type { SiteCopy } from "@/content/site/types";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils/cn";
import type { AccountLink } from "./account-link";
import { LanguageSwitch } from "./LanguageSwitch";
import { CONTAINER, HEADER_COMPACT_HEIGHT, HEADER_HEIGHT, NAV_LINK_CLASSES } from "./layout";

export interface SiteHeaderProps {
  locale: Locale;
  nav: SiteCopy["nav"];
  common: SiteCopy["common"];
  account: AccountLink;
  signedIn: boolean;
}

/** The section links of the header, in order. */
export function headerLinks(nav: SiteCopy["nav"]): { href: `/#${string}`; label: string }[] {
  return [
    { href: sectionHref(SECTION_IDS.howItWorks), label: nav.howItWorks },
    { href: sectionHref(SECTION_IDS.listen), label: nav.listen },
    { href: sectionHref(SECTION_IDS.venues), label: nav.venues },
    { href: sectionHref(SECTION_IDS.plans), label: nav.plans },
    { href: sectionHref(SECTION_IDS.faq), label: nav.faq },
  ];
}

/**
 * Minimal ivory header: logo, section links, MK / EN, Log in and the cobalt trial button. Sticky,
 * and slightly more compact once the page scrolls. Below 1280px the section links move into a side
 * sheet (native <dialog>: focus trap, Escape, focus return) opened by the menu button.
 */
export function SiteHeader({ locale, nav, common, account, signedIn }: SiteHeaderProps) {
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const links = headerLinks(nav);
  const trialHref = sectionHref(SECTION_IDS.trial);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setCompact(window.scrollY > 24);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header
      data-compact={compact ? "true" : "false"}
      className={cn(
        "sticky top-0 z-40 border-b bg-canvas/85 backdrop-blur-md transition-[background-color,border-color] duration-300",
        compact ? "border-border bg-canvas/95" : "border-transparent",
      )}
    >
      <div
        className={cn(CONTAINER, "flex items-center gap-2 transition-[height] duration-300 sm:gap-3 lg:gap-6")}
        style={{ height: compact ? HEADER_COMPACT_HEIGHT : HEADER_HEIGHT }}
      >
        <Link href="/" aria-label={common.brandHome} className="shrink-0 rounded-full py-1">
          <BrandLogo tone="cobalt" size={compact ? "sm" : "md"} priority className="transition-[height] duration-300 max-sm:h-7!" />
        </Link>

        <nav aria-label={PLATFORM_NAME} className="hidden xl:block">
          <ul className="flex items-center gap-0.5">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={cn(NAV_LINK_CLASSES, "inline-flex whitespace-nowrap px-3 text-sm")}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LanguageSwitch locale={locale} label={common.languageSwitch} switchTo={common.switchTo} className="hidden sm:inline-flex" />
          <Link href={account.href} className={cn(NAV_LINK_CLASSES, "hidden md:inline-flex", signedIn && "gap-1.5 text-fg")}>
            {account.label}
            {signedIn && <ArrowRight aria-hidden="true" className="size-4" />}
          </Link>
          <ButtonLink
            href={trialHref}
            size="md"
            className={cn("rounded-full! max-sm:h-10 max-sm:px-3.5 max-sm:text-sm sm:px-5", signedIn && "max-sm:hidden")}
          >
            <span className="sm:hidden">{nav.trialCtaShort}</span>
            <span className="hidden sm:inline">{nav.trialCta}</span>
          </ButtonLink>
          <IconButton
            ref={menuButtonRef}
            aria-label={common.openMenu}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            icon={<Menu />}
            round
            className="xl:hidden"
            onClick={() => setMenuOpen(true)}
          />
        </div>
      </div>

      <Drawer open={menuOpen} onClose={closeMenu} title={common.menuTitle} side="right" size="sm" returnFocusRef={menuButtonRef}>
        <div className="flex h-full flex-col gap-8 pt-2">
          <nav aria-label={PLATFORM_NAME}>
            <ul className="grid gap-1">
              {links.map((link, index) => (
                <li key={link.href} className="motion-safe:animate-fade-up" style={{ animationDelay: `${60 + index * 40}ms` }}>
                  <Link
                    href={link.href}
                    onClick={closeMenu}
                    className="flex min-h-12 items-center rounded-control px-3 font-display text-2xl text-fg transition-colors hover:bg-surface-2"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li className="motion-safe:animate-fade-up" style={{ animationDelay: "260ms" }}>
                <Link
                  href={account.href}
                  onClick={closeMenu}
                  className="flex min-h-12 items-center gap-2 rounded-control px-3 text-base font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  data-testid="menu-account"
                >
                  {account.label}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </li>
            </ul>
          </nav>
          <div className="grid gap-3 px-3">
            <p className="text-sm font-medium text-fg-muted">{common.languageSwitch}</p>
            <LanguageSwitch locale={locale} label={common.languageSwitch} switchTo={common.switchTo} variant="full" />
          </div>
          <div className="mt-auto px-3 pb-2">
            <ButtonLink href={trialHref} size="lg" fullWidth className="rounded-full!" onClick={closeMenu}>
              {nav.trialCta}
            </ButtonLink>
          </div>
        </div>
      </Drawer>
    </header>
  );
}
