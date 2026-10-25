"use client";

import { useRef } from "react";
import type { StaticImageData } from "next/image";
import { cn } from "@/lib/utils/cn";
import { Photo } from "../Photo";
import { gsap, MOTION_OK, useGSAP } from "./gsap";

export interface ParallaxImageProps {
  src: StaticImageData | string;
  alt: string;
  sizes: string;
  /** The frame: give it a size or aspect ratio and rounding. */
  className?: string;
  imageClassName?: string;
  /** Drift in percent of the image height while the frame crosses the viewport (max 10). */
  speed?: number;
  /** Above the fold: load first. */
  preload?: boolean;
  /** Also reveal the frame with a clip as it enters. */
  reveal?: boolean;
}

/**
 * A photo that drifts slightly slower than the page (scrubbed to the scroll). The image is 30% taller
 * than its frame, so the drift never shows an edge. Static with reduced motion.
 */
export function ParallaxImage({ src, alt, sizes, className, imageClassName, speed = 8, preload = false, reveal = false }: ParallaxImageProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const frame = ref.current;
      const inner = frame?.querySelector<HTMLElement>("[data-parallax-inner]");
      if (!frame || !inner) return;
      const drift = Math.min(10, Math.max(0, speed));
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          inner,
          { yPercent: -drift },
          { yPercent: drift, ease: "none", scrollTrigger: { trigger: frame, start: "top bottom", end: "bottom top", scrub: true } },
        );
        if (reveal) {
          gsap.fromTo(
            frame,
            { clipPath: "inset(14% 6% 14% 6% round 32px)", autoAlpha: 0 },
            {
              clipPath: "inset(0% 0% 0% 0% round 0px)",
              autoAlpha: 1,
              duration: 1.5,
              ease: "expo.out",
              clearProps: "clipPath",
              scrollTrigger: { trigger: frame, start: "top 88%", once: true },
            },
          );
        }
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <div ref={ref} data-anim={reveal ? "" : undefined} className={cn("relative overflow-hidden", className)}>
      <div data-parallax-inner className="absolute inset-x-0 -inset-y-[15%]">
        <Photo src={src} alt={alt} fill sizes={sizes} preload={preload} className={cn("object-cover", imageClassName)} />
      </div>
    </div>
  );
}
