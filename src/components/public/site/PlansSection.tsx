import { ArrowRight, Check } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { formatPlanPrice, publishedPlans } from "@/config/plans";
import { SECTION_IDS, sectionHref } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils/cn";
import { Container, SectionHeading } from "./primitives";
import { Reveal } from "./Reveal";
import { SECTION_SPACE } from "./layout";

export interface PlansSectionProps {
  copy: SiteCopy["plans"];
  locale: Locale;
}

/**
 * Plans. While the prices are unpublished (src/config/plans.ts) this is a refined request-pricing
 * invitation that still states what every package includes; once approved, the three packages are
 * compared side by side with the VAT note. No discounts, commitments or "most popular" claims.
 */
export function PlansSection({ copy, locale }: PlansSectionProps) {
  const plans = publishedPlans();
  const trialHref = sectionHref(SECTION_IDS.trial);

  return (
    <section id={SECTION_IDS.plans} aria-labelledby="plans-title" className={cn("scroll-mt-24 bg-surface-2/50", SECTION_SPACE)}>
      <Container className="grid gap-12">
        {plans.length === 0 ? (
          <Reveal className="grid gap-10 rounded-[28px] border border-border bg-surface p-7 shadow-card sm:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16 lg:p-14">
            <div className="grid content-start gap-8">
              <SectionHeading id="plans-title" eyebrow={copy.eyebrow} title={copy.unpublishedTitle} lead={copy.unpublishedLead} />
              <div>
                <ButtonLink href={trialHref} size="lg" className="rounded-full! px-7" iconRight={<ArrowRight aria-hidden="true" />}>
                  {copy.requestPricing}
                </ButtonLink>
              </div>
            </div>
            <div className="grid content-start gap-4 border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-12">
              <h3 className="text-sm font-semibold text-fg">{copy.includesTitle}</h3>
              <IncludesList items={copy.includes} />
            </div>
          </Reveal>
        ) : (
          <>
            <SectionHeading id="plans-title" eyebrow={copy.eyebrow} title={copy.title} lead={copy.lead} />
            <Reveal as="ul" className="grid gap-5 lg:grid-cols-3">
              {plans.map((plan) => (
                <li key={plan.key} className="grid content-start gap-6 rounded-[26px] border border-border bg-surface p-7 shadow-card">
                  <div className="grid gap-2">
                    <h3 className="display-sm text-fg">{plan.name[locale]}</h3>
                    <p className="flex items-baseline gap-2">
                      <span className="text-3xl font-semibold tracking-tight text-fg tabular-nums">{formatPlanPrice(plan.monthlyPrice, locale)}</span>
                      <span className="text-sm text-fg-muted">{copy.perMonth}</span>
                    </p>
                  </div>
                  <IncludesList items={plan.features[locale]} />
                  <ButtonLink href={trialHref} variant="outline" className="rounded-full! mt-auto">
                    {copy.choose}
                  </ButtonLink>
                </li>
              ))}
            </Reveal>
            <div className="grid gap-4 border-t border-border pt-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-10">
              <h3 className="text-sm font-semibold text-fg">{copy.includesTitle}</h3>
              <div className="grid gap-4">
                <IncludesList items={copy.includes} className="sm:grid-cols-2" />
                <p className="text-sm text-fg-subtle">{copy.vatNote}</p>
              </div>
            </div>
          </>
        )}
      </Container>
    </section>
  );
}

function IncludesList({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <ul className={cn("grid gap-2.5", className)}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-base text-fg-muted">
          <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-accent-text" />
          <span className="text-pretty">{item}</span>
        </li>
      ))}
    </ul>
  );
}
