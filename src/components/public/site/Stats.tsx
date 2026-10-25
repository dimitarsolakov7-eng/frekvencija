import { PHOTOS } from "@/assets/photos";
import { SECTION_IDS, type SiteStat } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils/cn";
import { CountUp } from "./motion/CountUp";
import { ParallaxImage } from "./motion/ParallaxImage";
import { Reveal } from "./motion/Reveal";
import { SplitHeading } from "./motion/SplitHeading";
import { Container, SectionLabel } from "./primitives";

export interface StatsProps {
  copy: SiteCopy["stats"];
  stats: readonly SiteStat[];
  locale: Locale;
  photoAlt: string;
}

/**
 * Chapter 02: the headline numbers (from src/config/site.ts) counting up beside the amber vinyl. The
 * numbers are server-rendered in their final form, so they are correct without any motion.
 */
export function Stats({ copy, stats, locale, photoAlt }: StatsProps) {
  return (
    <section id={SECTION_IDS.numbers} aria-labelledby="numbers-title" className="relative border-t border-border py-24 sm:py-32 lg:py-36">
      <Container className="grid gap-14 lg:gap-20">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-8">
          <div className="lg:col-span-3">
            <SectionLabel index="02">{copy.label}</SectionLabel>
          </div>
          <SplitHeading id="numbers-title" className="display-xl max-w-[13ch] text-fg lg:col-span-9">
            {copy.title}
          </SplitHeading>
        </div>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
          <ParallaxImage
            src={PHOTOS.vinyl}
            alt={photoAlt}
            sizes="(min-width: 1024px) 28vw, 100vw"
            reveal
            className="hidden aspect-[3/4] rounded-[28px] lg:col-span-4 lg:block"
          />
          <Reveal as="dl" items="[data-stat]" stagger={0.12} className="grid grid-cols-2 content-start border-t border-border lg:col-span-8">
            {stats.map((stat, index) => (
              <div
                key={stat.key}
                data-stat=""
                data-anim=""
                className={cn(
                  "flex flex-col-reverse gap-4 border-b border-border py-8 sm:py-12",
                  index % 2 === 0 ? "border-r pr-4 sm:pr-8" : "pl-4 sm:pl-8",
                )}
              >
                <dt className="label-mono text-fg-muted">{copy.items[stat.key]}</dt>
                <dd className={cn("font-display text-[clamp(3.25rem,1.6rem+5.4vw,8rem)] leading-[0.85] font-extrabold", stat.key === "ads" ? "text-accent" : "text-fg")}>
                  <CountUp value={stat.value} suffix={stat.suffix} locale={locale} />
                </dd>
              </div>
            ))}
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
