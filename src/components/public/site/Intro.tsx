"use client";

import { useRef } from "react";
import { BrandLogo } from "@/components/brand";
import { INTRO_DONE_EVENT, INTRO_SEEN_KEY } from "./motion/boot";
import { gsap, useGSAP } from "./motion/gsap";

/** Resting heights of the equaliser bars (they echo the logo's bars around the "f"). */
const BAR_HEIGHTS = [0.32, 0.5, 0.74, 1, 0.68, 0.86, 0.58, 0.42, 0.28];

export interface IntroProps {
  /** "Finding the frequency". */
  label: string;
}

/**
 * First-visit intro (once per tab, homepage only, never with reduced motion or without JavaScript): an
 * equaliser tunes in while the dial counts to 101.7, the logo settles, and the curtain lifts into the
 * hero after about 1.3 seconds. Any key or a tap skips it. The overlay is decorative (aria-hidden) and
 * never traps focus; the page is fully rendered underneath it.
 */
export function Intro({ label }: IntroProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const overlay = ref.current;
    const root = document.documentElement;
    if (!overlay || !root.classList.contains("intro-on")) return;
    const bars = overlay.querySelectorAll<HTMLElement>("[data-intro-bar]");
    const readout = overlay.querySelector<HTMLElement>("[data-intro-freq]");
    const brand = overlay.querySelectorAll<HTMLElement>("[data-intro-brand]");
    const dial = { value: 87.5 };

    const finish = () => {
      root.classList.remove("intro-on");
      try {
        window.sessionStorage.setItem(INTRO_SEEN_KEY, "1");
      } catch {
        // Private mode without storage: the intro may simply play again next time.
      }
    };
    const announce = () => window.dispatchEvent(new Event(INTRO_DONE_EVENT));

    const timeline = gsap.timeline({ onComplete: finish });
    timeline
      .fromTo(
        bars,
        { scaleY: 0.06 },
        { scaleY: (index: number) => BAR_HEIGHTS[index] ?? 0.5, duration: 0.55, ease: "expo.out", stagger: { each: 0.035, from: "center" } },
      )
      .to(bars, { scaleY: () => gsap.utils.random(0.2, 1), duration: 0.15, ease: "sine.inOut", repeat: 3, yoyo: true, stagger: { each: 0.02, from: "random" } })
      .to(
        dial,
        {
          value: 101.7,
          duration: 1.05,
          ease: "power3.inOut",
          onUpdate: () => {
            if (readout) readout.textContent = dial.value.toFixed(1);
          },
        },
        0,
      )
      .fromTo(brand, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "expo.out", stagger: 0.06 }, 0.45)
      .add(announce, 1.25)
      .to(overlay, { yPercent: -100, duration: 1, ease: "expo.inOut" }, 1.25);

    const skip = () => timeline.progress(1);
    window.addEventListener("keydown", skip, { once: true });
    overlay.addEventListener("pointerdown", skip, { once: true });
    return () => {
      window.removeEventListener("keydown", skip);
      overlay.removeEventListener("pointerdown", skip);
      timeline.kill();
    };
  });

  return (
    <div ref={ref} data-intro="" aria-hidden="true" className="fixed inset-0 z-[100] flex-col items-center justify-center gap-12 bg-canvas text-fg">
      <div className="flex h-32 items-center gap-2.5">
        {BAR_HEIGHTS.map((_, index) => (
          <span key={index} data-intro-bar="" className="block h-full w-2.5 origin-center scale-y-[0.06] rounded-full bg-accent" />
        ))}
      </div>
      <div className="grid justify-items-center gap-5">
        <span data-intro-brand="" className="invisible">
          <BrandLogo tone="light" size="lg" priority />
        </span>
        <p data-intro-brand="" className="label-mono invisible text-fg-muted">
          {label} · <span data-intro-freq="" className="tabular-nums text-fg">87.5</span> <span className="normal-case">MHz</span>
        </p>
      </div>
    </div>
  );
}
