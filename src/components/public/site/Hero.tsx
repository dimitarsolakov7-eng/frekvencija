import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { DEMO_AUDIO } from "@/config/demo-audio";
import { SECTION_IDS, sectionHref } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { FrequencyLine } from "./FrequencyLine";
import { Container, Eyebrow } from "./primitives";
import { RadioConsole } from "./RadioConsole";

export interface HeroProps {
  copy: Pick<SiteCopy, "hero" | "console" | "common">;
}

/**
 * Typography-led, centred hero on warm ivory: eyebrow, a two-line editorial headline, the lead and
 * two actions, then the signature radio console on a frequency line. The entrance is a short
 * staggered rise (CSS only, so it also runs without JavaScript and stops under reduced motion).
 */
export function Hero({ copy }: HeroProps) {
  const [first, second] = copy.hero.titleLines;
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden pt-14 pb-10 sm:pt-20 lg:pt-24">
      <Container className="grid justify-items-center gap-7 text-center sm:gap-8">
        <Eyebrow tick={false} className="motion-safe:animate-rise">
          {copy.hero.eyebrow}
        </Eyebrow>
        <h1 id="hero-title" className="display-xl max-w-[15ch] text-fg">
          <span className="block motion-safe:animate-rise [animation-delay:70ms]">{first}</span>
          <span className="block motion-safe:animate-rise [animation-delay:160ms]">{second}</span>
        </h1>
        <p className="max-w-[48ch] text-lg leading-relaxed text-fg-muted text-pretty motion-safe:animate-rise [animation-delay:260ms] sm:text-xl">
          {copy.hero.lead}
        </p>
        <div className="flex flex-wrap justify-center gap-3 motion-safe:animate-rise [animation-delay:340ms]">
          <ButtonLink href={sectionHref(SECTION_IDS.trial)} size="lg" className="rounded-full! px-7" iconRight={<ArrowRight aria-hidden="true" />}>
            {copy.hero.primaryCta}
          </ButtonLink>
          <ButtonLink href={sectionHref(SECTION_IDS.listen)} size="lg" variant="outline" className="rounded-full! px-7">
            {copy.hero.secondaryCta}
          </ButtonLink>
        </div>
      </Container>

      <div className="relative mt-14 sm:mt-20">
        <FrequencyLine
          drift
          seed={2}
          amplitude={0.7}
          className="pointer-events-none absolute inset-x-[-4%] top-1/2 -z-10 h-48 w-[108%] -translate-y-1/2 text-accent-text/35 sm:h-64"
        />
        <Container className="max-w-[1120px] motion-safe:animate-console-in [animation-delay:380ms]">
          <RadioConsole copy={copy.console} common={copy.common} clip={DEMO_AUDIO.station} announcementClip={DEMO_AUDIO.announcements.identity} />
        </Container>
      </div>
    </section>
  );
}
