import { ArrowRight, Check } from "lucide-react";
import { PHOTOS } from "@/assets/photos";
import { formatPlanPrice, publishedPlans } from "@/config/plans";
import { SECTION_IDS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils/cn";
import { PILL_LG } from "./layout";
import { Magnetic } from "./motion/Magnetic";
import { ParallaxImage } from "./motion/ParallaxImage";
import { Reveal } from "./motion/Reveal";
import { SplitHeading } from "./motion/SplitHeading";
import { Container, SectionLabel } from "./primitives";
import { SectionButtonLink } from "./SectionLink";

export interface PlansProps {
  copy: SiteCopy["plans"];
  locale: Locale;
  photoAlt: string;
}

function IncludesList({ items, className }: { items: readonly string[]; className?: string }) {
  return (
    <ul className={cn("grid gap-3", className)}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-base text-fg/85">
          <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-text">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          <span className="text-pretty">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Chapter 07: plans. While the prices are unpublished (src/config/plans.ts) this is an invitation to
 * request pricing that still lists what every plan includes; once approved, the three plans are compared
 * side by side. No discounts, commitments or "most popular" badges.
 */
export function Plans({ copy, locale, photoAlt }: PlansProps) {
  const plans = publishedPlans();
  const published = plans.length > 0;

  return (
    <section id={SECTION_IDS.plans} aria-labelledby="plans-title" className="relative border-t border-border py-24 sm:py-32 lg:py-36">
      <Container className="grid gap-14 lg:gap-20">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-8">
          <div className="lg:col-span-3">
            <SectionLabel index="07">{copy.label}</SectionLabel>
          </div>
          <SplitHeading id="plans-title" className="display-xl max-w-[15ch] text-fg lg:col-span-9">
            {published ? copy.title : copy.unpublishedTitle}
          </SplitHeading>
        </div>

        {published ? (
          <div className="grid gap-10">
            <Reveal as="ul" items="[data-plan]" stagger={0.1} className="grid gap-4 lg:grid-cols-3 lg:gap-5">
              {plans.map((plan) => (
                <li key={plan.key} data-plan="" data-anim="" className="grid content-start gap-8 rounded-[28px] border border-border bg-surface p-8 sm:p-10">
                  <div className="grid gap-3">
                    <h3 className="display-md text-fg">{plan.name[locale]}</h3>
                    <p className="flex items-baseline gap-2">
                      <span className="font-display text-6xl leading-none font-extrabold text-fg tabular-nums">{formatPlanPrice(plan.monthlyPrice, locale)}</span>
                      <span className="text-sm text-fg-muted">{copy.perMonth}</span>
                    </p>
                  </div>
                  <IncludesList items={plan.features[locale]} />
                  <SectionButtonLink section={SECTION_IDS.trial} variant="outline" size="lg" className="mt-auto rounded-full! border-fg/30!">
                    {copy.choose}
                  </SectionButtonLink>
                </li>
              ))}
            </Reveal>
            <div className="grid gap-4 border-t border-border pt-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-12">
              <h3 className="label-mono text-fg-muted">{copy.includesTitle}</h3>
              <div className="grid gap-4">
                <IncludesList items={copy.includes} className="sm:grid-cols-2" />
                <p className="text-sm text-fg-subtle">{copy.vatNote}</p>
              </div>
            </div>
          </div>
        ) : (
          <Reveal className="grid overflow-hidden rounded-[32px] border border-border bg-surface lg:grid-cols-12">
            <div className="grid content-start gap-10 p-8 sm:p-12 lg:col-span-7 lg:p-16">
              <p className="text-xl leading-relaxed text-fg/85 text-pretty sm:text-2xl">{copy.unpublishedLead}</p>
              <div className="grid gap-5 border-t border-border pt-8">
                <h3 className="label-mono text-fg-muted">{copy.includesTitle}</h3>
                <IncludesList items={copy.includes} className="sm:grid-cols-2" />
              </div>
              <div>
                <Magnetic>
                  <SectionButtonLink section={SECTION_IDS.trial} size="lg" className={PILL_LG} iconRight={<ArrowRight aria-hidden="true" />}>
                    {copy.requestPricing}
                  </SectionButtonLink>
                </Magnetic>
              </div>
            </div>
            <ParallaxImage src={PHOTOS.dinner} alt={photoAlt} sizes="(min-width: 1024px) 38vw, 100vw" className="min-h-72 lg:col-span-5 lg:min-h-full" />
          </Reveal>
        )}
      </Container>
    </section>
  );
}
