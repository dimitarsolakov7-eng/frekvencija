"use client";

import { useRef } from "react";
import type { StaticImageData } from "next/image";
import { SECTION_IDS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { DESKTOP_MOTION, EASE_OUT, gsap, MOTION_OK, useGSAP } from "./motion/gsap";
import { SplitHeading } from "./motion/SplitHeading";
import { Photo } from "./Photo";
import { SectionLabel } from "./primitives";

export interface HowItWorksProps {
  copy: SiteCopy["howItWorks"];
  /** One photo per step. */
  photos: readonly StaticImageData[];
}

/**
 * Chapter 03: four steps. On large screens with a precise pointer and motion allowed, the section pins
 * and the steps travel sideways with the scroll (each photo drifting inside its card, a progress line
 * filling); everywhere else — phones, touch, reduced motion, no JavaScript — the steps are a plain grid.
 * The horizontal layout only switches on once the pin is set up (data-pinned), so nothing is ever cut off.
 */
export function HowItWorks({ copy, photos }: HowItWorksProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const section = sectionRef.current;
      const track = trackRef.current;
      if (!section || !track) return;
      const mm = gsap.matchMedia();
      mm.add(DESKTOP_MOTION, () => {
        section.dataset.pinned = "true";
        const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);
        const travel = gsap.to(track, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top top",
            end: () => `+=${distance()}`,
            pin: true,
            pinSpacing: true,
            scrub: 0.8,
            invalidateOnRefresh: true,
            anticipatePin: 1,
          },
        });
        gsap.utils.toArray<HTMLElement>("[data-step-media]", track).forEach((media) => {
          gsap.fromTo(
            media,
            { xPercent: -7 },
            {
              xPercent: 7,
              ease: "none",
              scrollTrigger: { trigger: media.parentElement, containerAnimation: travel, start: "left right", end: "right left", scrub: true },
            },
          );
        });
        gsap.fromTo(
          section.querySelector("[data-steps-progress]"),
          { scaleX: 0 },
          { scaleX: 1, ease: "none", scrollTrigger: { trigger: section, start: "top top", end: () => `+=${distance()}`, scrub: true, invalidateOnRefresh: true } },
        );
        return () => {
          delete section.dataset.pinned;
        };
      });
      mm.add(`(max-width: 1023px) and ${MOTION_OK}, (pointer: coarse) and ${MOTION_OK}`, () => {
        gsap.utils.toArray<HTMLElement>("[data-step]", track).forEach((step) => {
          gsap.fromTo(step, { autoAlpha: 0, y: 60 }, { autoAlpha: 1, y: 0, duration: 1.1, ease: EASE_OUT, scrollTrigger: { trigger: step, start: "top 88%", once: true } });
        });
      });
      return () => mm.revert();
    },
    { scope: sectionRef },
  );

  // The pin's parent must not be a flex container (GSAP then drops the pin spacing), hence the block wrapper.
  return (
    <div className="relative">
      <section
        ref={sectionRef}
        id={SECTION_IDS.howItWorks}
        aria-labelledby="how-title"
        className="group/how relative overflow-hidden border-t border-border bg-sidebar data-[pinned=true]:h-svh"
      >
        <div
          ref={trackRef}
          className="grid gap-6 px-5 py-28 sm:px-8 sm:py-36 lg:grid-cols-2 lg:gap-8 lg:px-12 group-data-[pinned=true]/how:flex group-data-[pinned=true]/how:h-full group-data-[pinned=true]/how:w-max group-data-[pinned=true]/how:flex-row group-data-[pinned=true]/how:items-center group-data-[pinned=true]/how:gap-10 group-data-[pinned=true]/how:py-0 group-data-[pinned=true]/how:pr-[12vw] xl:group-data-[pinned=true]/how:pl-[max(3rem,calc((100vw-1440px)/2+3rem))]"
        >
          <div className="grid content-center gap-8 lg:col-span-2 lg:pb-8 group-data-[pinned=true]/how:w-[34vw] group-data-[pinned=true]/how:max-w-xl group-data-[pinned=true]/how:shrink-0 group-data-[pinned=true]/how:pr-6 group-data-[pinned=true]/how:pb-0">
            <SectionLabel index="03">{copy.label}</SectionLabel>
            <SplitHeading id="how-title" className="display-xl text-fg">
              {copy.title}
            </SplitHeading>
            <p className="max-w-md text-lg leading-relaxed text-fg-muted text-pretty">{copy.note}</p>
          </div>
          {copy.steps.map((step, index) => (
            <article
              key={step.title}
              data-step=""
              className="relative isolate flex min-h-[27rem] flex-col justify-end overflow-hidden rounded-[32px] border border-fg/10 lg:min-h-[34rem] group-data-[pinned=true]/how:h-[72vh] group-data-[pinned=true]/how:min-h-0 group-data-[pinned=true]/how:w-[min(40vw,38rem)] group-data-[pinned=true]/how:shrink-0"
            >
              <div data-step-media="" className="absolute inset-y-0 -inset-x-[9%] -z-20">
                <Photo src={photos[index % photos.length]} alt="" fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
              </div>
              <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-canvas via-canvas/65 to-canvas/5" />
              <span
                aria-hidden="true"
                className="text-outline absolute top-5 right-7 font-display text-[clamp(5rem,9vw,9.5rem)] leading-none font-extrabold"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="grid gap-3 p-7 sm:p-9">
                <p className="label-mono text-accent-text">
                  {copy.progress} {index + 1} / {copy.steps.length}
                </p>
                <h3 className="display-md text-fg">{step.title}</h3>
                <p className="max-w-sm text-base leading-relaxed text-fg/80 sm:text-lg">{step.body}</p>
              </div>
            </article>
          ))}
        </div>
        <div aria-hidden="true" className="absolute inset-x-12 bottom-10 hidden h-px bg-fg/10 group-data-[pinned=true]/how:block">
          <div data-steps-progress="" className="h-full origin-left scale-x-0 bg-accent" />
        </div>
      </section>
    </div>
  );
}
