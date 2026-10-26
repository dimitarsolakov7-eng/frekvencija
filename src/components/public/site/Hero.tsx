"use client";

import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { PHOTOS } from "@/assets/photos";
import { SECTION_IDS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { cn } from "@/lib/utils/cn";
import { DIAL_FREQUENCY, dialPercent, FmDial } from "./FmDial";
import { CONTAINER, PILL_LG } from "./layout";
import { EASE_OUT, gsap, MOTION_OK, useGSAP } from "./motion/gsap";
import { onIntroDone } from "./motion/intro-signal";
import { Magnetic } from "./motion/Magnetic";
import { OnAirCard } from "./OnAirCard";
import { Photo } from "./Photo";
import { LiveDot } from "./primitives";
import { SectionButtonLink } from "./SectionLink";

export interface HeroProps {
  copy: Pick<SiteCopy, "hero" | "common">;
}

/**
 * The opening chapter: a full-screen photograph (slow settle-in zoom, then a slower parallax), the
 * three-line promise rising out of masks, the lead and actions, the glass on-air card and the FM dial
 * whose needle tunes in to 101.7. The entrance waits for the intro (when it plays); on scroll the
 * content lifts away and the needle drifts on.
 */
export function Hero({ copy }: HeroProps) {
  const ref = useRef<HTMLElement>(null);
  const { hero } = copy;

  useGSAP(
    () => {
      const section = ref.current;
      if (!section) return;
      const q = gsap.utils.selector(section);
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const entrance = gsap.timeline({ paused: true });
        entrance
          .fromTo(q("[data-hero-media]"), { scale: 1.16 }, { scale: 1, duration: 2.8, ease: "expo.out" }, 0)
          .fromTo(q("[data-hero-line]"), { yPercent: 118, autoAlpha: 1 }, { yPercent: 0, duration: 1.3, ease: EASE_OUT, stagger: 0.11 }, 0.05)
          .fromTo(q("[data-hero-fade]"), { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 1.1, ease: EASE_OUT, stagger: 0.08 }, 0.5)
          .fromTo(q("[data-hero-card]"), { autoAlpha: 0, y: 48, rotate: 2.5 }, { autoAlpha: 1, y: 0, rotate: 0, duration: 1.4, ease: EASE_OUT }, 0.65)
          .fromTo(q("[data-dial-needle]"), { left: "0%" }, { left: `${dialPercent(DIAL_FREQUENCY)}%`, duration: 2.2, ease: "expo.inOut" }, 0.15);
        const cancel = onIntroDone(() => entrance.play());

        const scrollOut = { trigger: section, start: "top top", end: "bottom top", scrub: true } as const;
        gsap.to(q("[data-hero-parallax]"), { yPercent: 14, ease: "none", scrollTrigger: scrollOut });
        gsap.to(q("[data-hero-content]"), { yPercent: -10, opacity: 0.2, ease: "none", scrollTrigger: scrollOut });
        gsap.to(q("[data-dial-drift]"), { xPercent: 14, ease: "none", scrollTrigger: scrollOut });
        return () => cancel();
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <section ref={ref} id={SECTION_IDS.top} aria-labelledby="hero-title" className="relative isolate flex min-h-[100svh] flex-col overflow-hidden">
      <div data-hero-parallax="" className="absolute inset-0 -z-20">
        <div data-hero-media="" className="absolute inset-0 will-change-transform">
          <Photo src={PHOTOS.hero} alt="" fill preload sizes="100vw" className="object-cover object-[55%_28%]" />
        </div>
      </div>
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-canvas via-canvas/60 to-canvas/30" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-r from-canvas/90 via-canvas/40 to-canvas/0" />
      <div aria-hidden="true" className="grain absolute inset-0 -z-10" />

      <div data-hero-content="" className={cn(CONTAINER, "relative flex flex-1 flex-col justify-end pt-28 pb-36 sm:pb-36")}>
        <div className="grid items-end gap-12 xl:grid-cols-[minmax(0,1fr)_auto] xl:gap-16">
          <div className="@container grid gap-7 sm:gap-8">
            <p data-hero-fade="" data-anim="" className="label-mono flex items-center gap-3 text-fg">
              <LiveDot />
              {hero.eyebrow}
            </p>
            <h1 id="hero-title" className="display-hero text-fg">
              {hero.titleLines.map((line, index) => (
                <span key={line} className="-mb-[0.08em] block overflow-clip pb-[0.08em]">
                  <span data-hero-line="" data-anim="" className={cn("block", index === 2 && "text-accent")}>
                    {line}
                  </span>
                </span>
              ))}
            </h1>
            <p data-hero-fade="" data-anim="" className="max-w-[44ch] text-lg leading-relaxed text-fg/80 text-pretty sm:text-xl">
              {hero.lead}
            </p>
            <div data-hero-fade="" data-anim="" className="flex flex-wrap items-center gap-3">
              <Magnetic>
                <SectionButtonLink section={SECTION_IDS.trial} size="lg" className={PILL_LG} iconRight={<ArrowRight aria-hidden="true" />}>
                  {hero.primaryCta}
                </SectionButtonLink>
              </Magnetic>
              <SectionButtonLink
                section={SECTION_IDS.howItWorks}
                size="lg"
                variant="outline"
                className={cn(PILL_LG, "border-fg/30! text-fg hover:bg-fg/10")}
              >
                {hero.secondaryCta}
              </SectionButtonLink>
            </div>
          </div>
          <OnAirCard copy={hero.card} quotes={copy.common.quotes} exampleBadge={copy.common.exampleBadge} className="hidden xl:block" />
        </div>
      </div>

      <FmDial scrollCue={copy.common.scrollCue} />
    </section>
  );
}
