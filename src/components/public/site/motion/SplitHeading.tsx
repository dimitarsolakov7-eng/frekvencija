"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { EASE_OUT, gsap, MOTION_OK, SplitText, useGSAP } from "./gsap";

export interface SplitHeadingProps {
  as?: "h1" | "h2" | "h3" | "p";
  id?: string;
  className?: string;
  children: ReactNode;
  /** Seconds before the lines rise. */
  delay?: number;
}

/**
 * A heading whose lines rise out of masks when it scrolls into view (SplitText, re-split on resize and
 * font load). SplitText keeps the full text as the accessible name. With reduced motion, or before the
 * motion layer runs, it is a normal heading.
 */
export function SplitHeading({ as: Tag = "h2", id, className, children, delay = 0 }: SplitHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);

  useGSAP(
    () => {
      const element = ref.current;
      if (!element) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const split = SplitText.create(element, {
          type: "lines",
          mask: "lines",
          linesClass: "split-line",
          autoSplit: true,
          onSplit(self) {
            gsap.set(element, { visibility: "inherit" });
            return gsap.from(self.lines, {
              yPercent: 115,
              duration: 1.2,
              ease: EASE_OUT,
              stagger: 0.09,
              delay,
              scrollTrigger: { trigger: element, start: "top 88%", once: true },
            });
          },
        });
        return () => split.revert();
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref as RefObject<HTMLHeadingElement>} id={id} data-anim="" className={className}>
      {children}
    </Tag>
  );
}
