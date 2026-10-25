import Link from "next/link";
import { ArrowUpRight, Mail } from "lucide-react";
import { BrandLogo } from "@/components/brand";
import { PLATFORM_DOMAIN } from "@/config/platform";
import { SECTION_IDS, SOCIAL_LINKS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { fill, type Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils/cn";
import type { AccountLink } from "./account-link";
import { LanguageSwitch } from "./LanguageSwitch";
import { PILL_LG } from "./layout";
import { Magnetic } from "./motion/Magnetic";
import { Reveal } from "./motion/Reveal";
import { siteNavLinks } from "./nav";
import { Container } from "./primitives";
import { SectionButtonLink, SectionLink } from "./SectionLink";

export interface SiteFooterProps {
  locale: Locale;
  copy: SiteCopy;
  account: AccountLink;
  /** The owner's public contact address from platform settings, when set. */
  contactEmail: string | null;
  /** Fixed year for deterministic rendering (tests); defaults to the current year. */
  year?: number;
}

const FOOTER_LINK = "inline-flex min-h-11 items-center gap-1.5 py-1.5 text-base text-fg/75 transition-colors hover:text-fg";
const WORDMARK = "FREKVENCIJA";

/** Closing call to action, links, contact and language, and the giant wordmark rising into view. */
export function SiteFooter({ locale, copy, account, contactEmail, year = new Date().getFullYear() }: SiteFooterProps) {
  const { footer } = copy;
  return (
    <footer className="relative overflow-hidden border-t border-border bg-canvas">
      <Container className="grid gap-16 pt-24 pb-12 sm:pt-32">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <p className="display-lg max-w-[13ch] text-fg lg:col-span-8">{footer.ctaTitle}</p>
          <div className="lg:col-span-4 lg:justify-self-end">
            <Magnetic>
              <SectionButtonLink section={SECTION_IDS.trial} size="lg" className={PILL_LG} iconRight={<ArrowUpRight aria-hidden="true" />}>
                {footer.ctaButton}
              </SectionButtonLink>
            </Magnetic>
          </div>
        </div>

        <div className="grid gap-12 border-t border-border pt-12 sm:grid-cols-2 lg:grid-cols-12 lg:gap-8">
          <div className="grid content-start gap-5 sm:col-span-2 lg:col-span-4">
            <Link href="/" aria-label={copy.common.brandHome} className="w-fit rounded-full py-1">
              <BrandLogo tone="light" size="md" />
            </Link>
            <p className="serif-accent max-w-xs text-[1.75rem] leading-snug text-fg/85">{footer.tagline}</p>
          </div>

          <nav aria-label={footer.siteLabel} className="grid content-start gap-3 lg:col-span-3">
            <h2 className="label-mono text-fg-subtle">{footer.siteLabel}</h2>
            <ul className="grid">
              {siteNavLinks(copy.nav).map((link) => (
                <li key={link.id}>
                  <SectionLink section={link.id} className={FOOTER_LINK}>
                    {link.label}
                  </SectionLink>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={footer.legalLabel} className="grid content-start gap-3 lg:col-span-2">
            <h2 className="label-mono text-fg-subtle">{footer.legalLabel}</h2>
            <ul className="grid">
              <li>
                <Link href={account.href} className={FOOTER_LINK}>
                  {account.label}
                </Link>
              </li>
              <li>
                <Link href="/privacy" className={FOOTER_LINK}>
                  {footer.privacy}
                </Link>
              </li>
              <li>
                <Link href="/terms" className={FOOTER_LINK}>
                  {footer.terms}
                </Link>
              </li>
            </ul>
          </nav>

          <div className="grid content-start gap-3 lg:col-span-3">
            <h2 className="label-mono text-fg-subtle">{footer.contactLabel}</h2>
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
                <SectionLink section={SECTION_IDS.trial} className={cn(FOOTER_LINK, "text-accent-text hover:text-accent-hover")}>
                  {footer.contactCta}
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </SectionLink>
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
            <div className="pt-3">
              <LanguageSwitch locale={locale} label={copy.common.languageSwitch} switchTo={copy.common.switchTo} variant="full" />
            </div>
          </div>
        </div>
      </Container>

      <Reveal items="[data-letter]" stagger={0.035} start="top 98%" className="flex justify-center overflow-hidden px-2 select-none" style={{ fontSize: "clamp(4rem, 23.5vw, 26rem)" }}>
        <p aria-hidden="true" className="flex font-display leading-[0.78] font-extrabold tracking-[-0.02em] text-fg">
          {WORDMARK.split("").map((letter, index) => (
            <span key={index} data-letter="" data-anim="" className="inline-block">
              {letter}
            </span>
          ))}
        </p>
      </Reveal>

      <Container className="flex flex-col gap-2 border-t border-border py-7 text-sm text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
        <p>{PLATFORM_DOMAIN}</p>
        <p>{footer.credits}</p>
        <p>{fill(footer.rights, { year })}</p>
      </Container>
    </footer>
  );
}
