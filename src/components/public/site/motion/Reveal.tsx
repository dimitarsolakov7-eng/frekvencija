"use client";

import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { EASE_OUT, gsap, MOTION_OK, useGSAP } from "./gsap";

export type RevealVariant = "up" | "fade" | "clip" | "scale";

type RevealTag = "div" | "section" | "ul" | "ol" | "li" | "article" | "p" | "figure" | "dl";

export interface RevealProps {
  as?: RevealTag;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
  variant?: RevealVariant;
  /** Seconds before the entrance starts. */
  delay?: number;
  /**
   * Reveal these descendants (a selector; each must carry `data-anim`) one after another instead of
   * the wrapper itself.
   */
  items?: string;
  /** Seconds between items. */
  stagger?: number;
  /** ScrollTrigger start, e.g. "top 85%". */
  start?: string;
}

const FROM: Record<RevealVariant, gsap.TweenVars> = {
  up: { autoAlpha: 0, y: 56 },
  fade: { autoAlpha: 0 },
  clip: { autoAlpha: 0, clipPath: "inset(22% 0% 0% 0% round 28px)" },
  scale: { autoAlpha: 0, scale: 0.94 },
};

const TO: Record<RevealVariant, gsap.TweenVars> = {
  up: { autoAlpha: 1, y: 0 },
  fade: { autoAlpha: 1 },
  clip: { autoAlpha: 1, clipPath: "inset(0% 0% 0% 0% round 28px)" },
  scale: { autoAlpha: 1, scale: 1 },
};

/**
 * Scroll-triggered entrance (once). Hidden until revealed only while motion is allowed (see boot.ts);
 * otherwise the content is simply there.
 */
export function Reveal({ as = "div", children, className, style, id, variant = "up", delay = 0, items, stagger = 0.08, start = "top 86%" }: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const element = ref.current;
      if (!element) return;
      const targets = items ? Array.from(element.querySelectorAll<HTMLElement>(items)) : [element];
      if (targets.length === 0) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(targets, FROM[variant], {
          ...TO[variant],
          duration: variant === "clip" ? 1.4 : 1.1,
          ease: EASE_OUT,
          delay,
          stagger,
          ...(variant === "clip" ? { clearProps: "clipPath" } : {}),
          scrollTrigger: { trigger: element, start, once: true },
        });
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  const Element = as as "div";
  return (
    <Element ref={ref as RefObject<HTMLDivElement>} id={id} data-anim={items ? undefined : ""} className={className} style={style}>
      {children}
    </Element>
  );
}
