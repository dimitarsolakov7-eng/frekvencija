"use client";

import { useRef } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { formatStatNumber } from "@/lib/public/format";
import { cn } from "@/lib/utils/cn";
import { gsap, MOTION_OK, useGSAP } from "./gsap";

export interface CountUpProps {
  value: number;
  suffix?: string;
  locale: Locale;
  className?: string;
}

/**
 * A number that counts up when it scrolls into view. The server renders the final value (and it stays
 * there with reduced motion), so the figure is always correct for search engines and screen readers.
 */
export function CountUp({ value, suffix = "", locale, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const finalText = `${formatStatNumber(value, locale)}${suffix}`;

  useGSAP(
    () => {
      const element = ref.current;
      if (!element || value === 0) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const counter = { n: 0 };
        element.textContent = `${formatStatNumber(0, locale)}${suffix}`;
        const tween = gsap.to(counter, {
          n: value,
          duration: 2.2,
          ease: "power3.out",
          scrollTrigger: { trigger: element, start: "top 92%", once: true },
          onUpdate: () => {
            element.textContent = `${formatStatNumber(counter.n, locale)}${suffix}`;
          },
        });
        return () => {
          tween.kill();
          element.textContent = finalText;
        };
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [value, suffix, locale] },
  );

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {finalText}
    </span>
  );
}
