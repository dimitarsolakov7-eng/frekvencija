"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { gsap, useGSAP } from "./gsap";

export interface MagneticProps {
  children: ReactNode;
  /** How far the element follows the pointer (fraction of the distance to its centre). */
  strength?: number;
  className?: string;
}

/**
 * Makes a focal call to action lean towards the pointer (precise pointers with motion allowed only). The
 * pull is clamped, so the element never leaves its own hit area, and it springs back on leave.
 */
export function Magnetic({ children, strength = 0.28, className }: MagneticProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const element = ref.current;
      if (!element) return;
      const mm = gsap.matchMedia();
      mm.add("(pointer: fine) and (prefers-reduced-motion: no-preference)", () => {
        const xTo = gsap.quickTo(element, "x", { duration: 0.7, ease: "elastic.out(1, 0.45)" });
        const yTo = gsap.quickTo(element, "y", { duration: 0.7, ease: "elastic.out(1, 0.45)" });
        const onMove = (event: PointerEvent) => {
          const rect = element.getBoundingClientRect();
          xTo((event.clientX - rect.left - rect.width / 2) * strength);
          yTo((event.clientY - rect.top - rect.height / 2) * strength);
        };
        const onLeave = () => {
          xTo(0);
          yTo(0);
        };
        element.addEventListener("pointermove", onMove);
        element.addEventListener("pointerleave", onLeave);
        return () => {
          element.removeEventListener("pointermove", onMove);
          element.removeEventListener("pointerleave", onLeave);
        };
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <span ref={ref} className={cn("inline-flex will-change-transform", className)}>
      {children}
    </span>
  );
}
