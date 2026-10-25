import Link from "next/link";
import { ArrowUpRight, Mail } from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { PLATFORM_DOMAIN } from "@/config/platform";
import { SECTION_IDS, SOCIAL_LINKS, sectionHref } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { fill, type Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils/cn";
import type { AccountLink } from "./account-link";
import { FrequencyLine } from "./FrequencyLine";
import { LanguageSwitch } from "./LanguageSwitch";
import { CONTAINER } from "./layout";

export interface SiteFooterProps {
  locale: Locale;
  copy: SiteCopy;
  account: AccountLink;
  /** The owner's public contact address from platform settings, when set. */
  contactEmail: string | null;
  /** Fixed year for deterministic rendering (tests); defaults to the current year. */
  year?: number;
}

const FOOTER_LINK = "inline-flex min-h-11 items-center gap-1.5 rounded-control py-2 text-[0.9375rem] text-fg-muted transition-colors hover:text-fg";

/** Spacious footer on soft stone: brand and tagline, site and legal links, contact, language. */
export function SiteFooter({ locale, copy, account, contactEmail, year = new Date().getFullYear() }: SiteFooterProps) {
  const siteLinks = [
    { href: sectionHref(SECTION_IDS.howItWorks), label: copy.nav.howItWorks },
    { href: sectionHref(SECTION_IDS.listen), label: copy.nav.listen },
    { href: sectionHref(SECTION_IDS.venues), label: copy.nav.venues },
    { href: sectionHref(SECTION_IDS.genres), label: copy.genres.eyebrow },
    { href: sectionHref(SECTION_IDS.plans), label: copy.nav.plans },
    { href: sectionHref(SECTION_IDS.faq), label: copy.nav.faq },
  ];

  return (
    <footer className="border-t border-border bg-surface-2/70">
      <div className={cn(CONTAINER, "grid gap-12 py-16 sm:py-20")}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] lg:gap-8">
          <div className="grid content-start gap-6">
            <Link href="/" aria-label={copy.common.brandHome} className="w-fit rounded-full py-1">
              <BrandLogo tone="cobalt" size="md" />
            </Link>
            <p className="max-w-xs font-display text-2xl leading-snug text-fg text-balance">{copy.footer.tagline}</p>
            <FrequencyLine className="h-8 max-w-56 text-accent-text/60" seed={3} amplitude={0.6} />
          </div>

          <nav aria-label={copy.footer.siteLabel} className="grid content-start gap-3">
            <h2 className="eyebrow text-fg-muted">{copy.footer.siteLabel}</h2>
            <ul className="grid">
              {siteLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={FOOTER_LINK}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={copy.footer.legalLabel} className="grid content-start gap-3">
            <h2 className="eyebrow text-fg-muted">{copy.footer.legalLabel}</h2>
            <ul className="grid">
              <li>
                <Link href={account.href} className={FOOTER_LINK}>
                  {account.label}
                </Link>
              </li>
              <li>
                <Link href="/privacy" className={FOOTER_LINK}>
                  {copy.footer.privacy}
                </Link>
              </li>
              <li>
                <Link href="/terms" className={FOOTER_LINK}>
                  {copy.footer.terms}
                </Link>
              </li>
            </ul>
          </nav>

          <div className="grid content-start gap-3">
            <h2 className="eyebrow text-fg-muted">{copy.footer.contactLabel}</h2>
            <ul className="grid">
              {contactEmail && (
                <li>
                  <a href={`mailto:${contactEmail}`} className={cn(FOOTER_LINK, "break-all")}>
                    <Mail aria-hidden="true" className="size-4 shrink-0" />
                    {contactEmail}
                  </a>
                </li>
              )}
              <li>
                <Link href={sectionHref(SECTION_IDS.trial)} className={cn(FOOTER_LINK, "text-accent-text hover:text-accent-hover")}>
                  {copy.footer.contactCta}
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
              </li>
              {SOCIAL_LINKS.map((social) => (
                <li key={social.href}>
                  <a href={social.href} rel="me noopener" target="_blank" className={FOOTER_LINK}>
                    {social.label}
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
            <div className="pt-2">
              <LanguageSwitch locale={locale} label={copy.common.languageSwitch} switchTo={copy.common.switchTo} variant="full" />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-6 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between">
          <p>{PLATFORM_DOMAIN}</p>
          <p>{fill(copy.footer.rights, { year })}</p>
        </div>
      </div>
    </footer>
  );
}
