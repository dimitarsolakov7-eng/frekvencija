"use client";

import { useRef } from "react";
import { PHOTOS } from "@/assets/photos";
import { SECTION_IDS } from "@/config/site";
import { highlightRuns } from "@/content/site";
import type { SiteCopy } from "@/content/site/types";
import { cn } from "@/lib/utils/cn";
import { gsap, MOTION_OK, useGSAP } from "./motion/gsap";
import { ParallaxImage } from "./motion/ParallaxImage";
import { Container, SectionLabel } from "./primitives";

export interface ManifestoProps {
  copy: SiteCopy["manifesto"];
  photoAlt: string;
}

/**
 * Chapter 01: the brand's statement in large type. While it scrolls through the viewport, the words
 * light up one by one (scrubbed to the scroll; fully lit with reduced motion). The highlighted phrases
 * switch to the italic serif in the signal colour.
 */
export function Manifesto({ copy, photoAlt }: ManifestoProps) {
  const ref = useRef<HTMLElement>(null);
  const runs = highlightRuns(copy.text);

  useGSAP(
    () => {
      const section = ref.current;
      if (!section) return;
      const words = gsap.utils.toArray<HTMLElement>("[data-word]", section);
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          words,
          { opacity: 0.14 },
          {
            opacity: 1,
            ease: "none",
            stagger: 0.08,
            scrollTrigger: { trigger: section.querySelector("[data-manifesto-text]"), start: "top 80%", end: "bottom 50%", scrub: 0.6 },
          },
        );
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <section ref={ref} id={SECTION_IDS.manifesto} aria-labelledby="manifesto-label" className="relative py-24 sm:py-32 lg:py-44">
      <Container className="grid gap-12 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-3">
          <SectionLabel as="h2" id="manifesto-label" index="01">
            {copy.label}
          </SectionLabel>
        </div>
        <div className="grid gap-16 lg:col-span-9">
          <p data-manifesto-text="" className="text-[clamp(1.85rem,1rem+2.9vw,4.1rem)] leading-[1.08] font-semibold tracking-[-0.03em] text-fg text-pretty">
            {runs.map((run, runIndex) =>
              run.text.split(/(\s+)/).map((part, partIndex) =>
                /^\s+$/.test(part) || part === "" ? (
                  part
                ) : (
                  <span
                    key={`${runIndex}-${partIndex}`}
                    data-word=""
                    className={cn(run.highlight && "serif-accent text-[1.12em] leading-[0.95] text-accent-text")}
                  >
                    {part}
                  </span>
                ),
              ),
            )}
          </p>
          <ParallaxImage
            src={PHOTOS.toast}
            alt={photoAlt}
            sizes="(min-width: 1024px) 40vw, 90vw"
            reveal
            className="aspect-[16/10] w-full max-w-xl justify-self-end rounded-[28px] lg:w-[58%]"
          />
        </div>
      </Container>
    </section>
  );
}
