"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { useModalDialog } from "@/components/ui/internal/use-modal-dialog";
import { PLATFORM_NAME } from "@/config/platform";
import { SECTION_IDS, sectionHref } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils/cn";
import type { AccountLink } from "./account-link";
import { LanguageSwitch } from "./LanguageSwitch";
import { CONTAINER } from "./layout";
import { gsap, MOTION_OK, useGSAP } from "./motion/gsap";
import { Magnetic } from "./motion/Magnetic";
import { useLenisRef } from "./motion/MotionProvider";
import { siteNavLinks, type SiteNavLink } from "./nav";
import { SectionButtonLink, useSectionClick } from "./SectionLink";

export interface SiteHeaderProps {
  locale: Locale;
  nav: SiteCopy["nav"];
  common: SiteCopy["common"];
  account: AccountLink;
  signedIn: boolean;
}

function NavItem({ link, className }: { link: SiteNavLink; className?: string }) {
  const onClick = useSectionClick(link.id);
  return (
    <Link href={sectionHref(link.id)} onClick={onClick} className={className}>
      {link.label}
      <span aria-hidden="true" className="absolute inset-x-3 bottom-2.5 h-px origin-left scale-x-0 bg-accent transition-transform duration-500 ease-expo group-hover:scale-x-100" />
    </Link>
  );
}

/**
 * Fixed header: transparent over the hero, a blurred bar once the page scrolls, and out of the way while
 * scrolling down (it returns on scroll up, and whenever something inside it takes keyboard focus).
 * Below 1280px the section links move into a full-screen menu on a native modal <dialog> (focus trap,
 * Escape, focus return to the menu button).
 */
export function SiteHeader({ locale, nav, common, account, signedIn }: SiteHeaderProps) {
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const lenisRef = useLenisRef();
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const links = siteNavLinks(nav);

  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 24);
      const delta = y - last;
      if (Math.abs(delta) < 6) return;
      const focusInside = headerRef.current?.contains(document.activeElement) ?? false;
      setHidden(delta > 0 && y > 360 && !focusInside);
      last = y;
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

  // The page must not scroll behind the open menu.
  useEffect(() => {
    const lenis = lenisRef.current;
    if (menuOpen) lenis?.stop();
    else lenis?.start();
  }, [menuOpen, lenisRef]);

  return (
    <header
      ref={headerRef}
      onFocusCapture={() => setHidden(false)}
      data-scrolled={scrolled ? "true" : "false"}
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-[transform,background-color,border-color] duration-500 ease-expo",
        hidden && !menuOpen ? "-translate-y-full" : "translate-y-0",
        scrolled ? "border-border/80 bg-canvas/75 backdrop-blur-xl" : "border-transparent bg-linear-to-b from-canvas/70 to-canvas/0",
      )}
    >
      <div className={cn(CONTAINER, "flex h-[76px] items-center gap-3 sm:gap-4 xl:gap-8")}>
        <Link href="/" aria-label={common.brandHome} className="shrink-0 rounded-full py-1">
          <BrandLogo tone="light" size="md" priority className="h-6! sm:h-8!" />
        </Link>

        <nav aria-label={PLATFORM_NAME} className="hidden xl:block">
          <ul className="flex items-center">
            {links.map((link) => (
              <li key={link.id}>
                <NavItem
                  link={link}
                  className="group relative inline-flex h-11 items-center px-3 text-[0.9375rem] font-medium whitespace-nowrap text-fg/75 transition-colors hover:text-fg"
                />
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          <LanguageSwitch locale={locale} label={common.languageSwitch} switchTo={common.switchTo} className="hidden sm:inline-flex" />
          <Link
            href={account.href}
            className="hidden h-11 items-center gap-1.5 px-2 text-[0.9375rem] font-medium whitespace-nowrap text-fg/75 transition-colors hover:text-fg md:inline-flex"
          >
            {account.label}
            {signedIn && <ArrowRight aria-hidden="true" className="size-4" />}
          </Link>
          <Magnetic className={cn(signedIn && "max-sm:hidden")}>
            <SectionButtonLink
              section={SECTION_IDS.trial}
              size="md"
              className="rounded-full! whitespace-nowrap max-sm:h-10! max-sm:px-4! max-sm:text-sm! sm:px-5"
            >
              <span className="sm:hidden">{nav.trialCtaShort}</span>
              <span className="hidden sm:inline">{nav.trialCta}</span>
            </SectionButtonLink>
          </Magnetic>
          <button
            ref={menuButtonRef}
            type="button"
            aria-label={common.openMenu}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="group grid size-11 shrink-0 place-items-center rounded-full border border-fg/15 text-fg transition-colors hover:border-fg/40 xl:hidden"
          >
            <span aria-hidden="true" className="grid gap-1.5">
              <span className="block h-px w-5 bg-current transition-transform duration-300 ease-expo group-hover:translate-x-0.5" />
              <span className="block h-px w-5 bg-current transition-transform duration-300 ease-expo group-hover:-translate-x-0.5" />
            </span>
          </button>
        </div>
      </div>

      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        returnFocusRef={menuButtonRef}
        links={links}
        locale={locale}
        nav={nav}
        common={common}
        account={account}
      />
    </header>
  );
}

interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  links: SiteNavLink[];
  locale: Locale;
  nav: SiteCopy["nav"];
  common: SiteCopy["common"];
  account: AccountLink;
}

function MenuLink({ link, index, onClose }: { link: SiteNavLink; index: number; onClose: () => void }) {
  const onClick = useSectionClick(link.id, onClose);
  return (
    <Link
      href={sectionHref(link.id)}
      onClick={onClick}
      data-menu-link=""
      className="flex items-baseline gap-4 py-1.5 font-display text-[clamp(2.75rem,13vw,5.5rem)] leading-[0.92] font-extrabold uppercase text-fg transition-colors hover:text-accent"
    >
      <span className="label-mono text-accent-text">{String(index + 1).padStart(2, "0")}</span>
      {link.label}
    </Link>
  );
}

function MobileMenu({ open, onClose, returnFocusRef, links, locale, nav, common, account }: MobileMenuProps) {
  const titleId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const dialogProps = useModalDialog({ open, onClose, dismissible: true, returnFocusRef });
  const onTrial = useSectionClick(SECTION_IDS.trial, onClose);

  useGSAP(
    () => {
      const content = contentRef.current;
      if (!open || !content) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(content, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: "power2.out" });
        gsap.fromTo(
          content.querySelectorAll("[data-menu-link]"),
          { yPercent: 110 },
          { yPercent: 0, duration: 0.9, ease: "expo.out", stagger: 0.06, delay: 0.08 },
        );
        gsap.fromTo(
          content.querySelectorAll("[data-menu-fade]"),
          { autoAlpha: 0, y: 18 },
          { autoAlpha: 1, y: 0, duration: 0.7, ease: "expo.out", stagger: 0.06, delay: 0.3 },
        );
      });
      return () => mm.revert();
    },
    { dependencies: [open] },
  );

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={titleId}
      className="theme-night fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-canvas p-0 text-fg backdrop:bg-canvas/60"
    >
      {open && (
        <div ref={contentRef} data-lenis-prevent="" className="flex h-full flex-col overflow-y-auto pt-safe pb-safe">
          <div className={cn(CONTAINER, "flex h-[76px] shrink-0 items-center justify-between")}>
            <BrandLogo tone="light" size="md" className="h-6! sm:h-8!" />
            <h2 id={titleId} className="sr-only">
              {common.menuTitle}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={common.closeMenu}
              className="grid size-11 place-items-center rounded-full border border-fg/15 text-fg transition-colors hover:border-fg/40"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <nav aria-label={PLATFORM_NAME} className={cn(CONTAINER, "flex-1 py-8")}>
            <ol className="grid gap-1">
              {links.map((link, index) => (
                <li key={link.id} className="overflow-clip">
                  <MenuLink link={link} index={index} onClose={onClose} />
                </li>
              ))}
            </ol>
          </nav>
          <div className={cn(CONTAINER, "grid gap-6 border-t border-border py-8")}>
            <div data-menu-fade="" className="flex flex-wrap items-center justify-between gap-4">
              <LanguageSwitch locale={locale} label={common.languageSwitch} switchTo={common.switchTo} variant="full" />
              <Link href={account.href} className="inline-flex h-11 items-center gap-2 text-base font-medium text-fg/80 hover:text-fg">
                {account.label}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
            <div data-menu-fade="">
              <a
                href={sectionHref(SECTION_IDS.trial)}
                onClick={onTrial}
                className="inline-flex h-14 w-full items-center justify-center rounded-full bg-accent px-8 text-base font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
              >
                {nav.trialCta}
              </a>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
