"use client";

import { useRef } from "react";
import { gsap, MOTION_OK, ScrollTrigger, useGSAP } from "./motion/gsap";

export interface NameCyclerProps {
  /** Example station names; the last one stays. */
  names: readonly string[];
  className?: string;
}

/**
 * Types example venue names into the "You're listening to … Radio" line once, when it scrolls into
 * view, and stays on the last one (under five seconds in total). Decorative: the parent hides it from
 * assistive technology and provides the final sentence as text.
 */
export function NameCycler({ names, className }: NameCyclerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const finalName = names[names.length - 1] ?? "";

  useGSAP(
    () => {
      const element = ref.current;
      if (!element || names.length < 2) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const proxy = { n: 0 };
        const timeline = gsap.timeline({ paused: true });
        names.forEach((name, index) => {
          const show = () => {
            element.textContent = name.slice(0, Math.round(proxy.n));
          };
          timeline.set(proxy, { n: 0 });
          timeline.to(proxy, { n: name.length, duration: 0.045 * name.length + 0.1, ease: "none", onUpdate: show });
          if (index < names.length - 1) {
            timeline.to({}, { duration: 0.75 });
            timeline.to(proxy, { n: 0, duration: 0.025 * name.length + 0.08, ease: "none", onUpdate: show });
          }
        });
        element.textContent = names[0] ?? "";
        const trigger = ScrollTrigger.create({ trigger: element, start: "top 85%", once: true, onEnter: () => timeline.play(0) });
        return () => {
          trigger.kill();
          timeline.kill();
          element.textContent = finalName;
        };
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <span ref={ref} className={className}>
      {finalName}
    </span>
  );
}
