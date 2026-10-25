"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { gsap, MOTION_OK, ScrollTrigger, useGSAP } from "./motion/gsap";
import { Spark } from "./primitives";

export interface GenreMarqueeProps {
  /** Genre names from the live catalogue (or the default list before setup). */
  genres: readonly string[];
  label: string;
  pauseLabel: string;
  playLabel: string;
}

/**
 * Two giant rows of the catalogue's genres drifting in opposite directions; scrolling speeds them up and
 * turns them with the scroll direction. The moving rows are decorative (a hidden list carries the
 * genres for screen readers), stop with reduced motion, and have a pause button (WCAG 2.2.2).
 */
export function GenreMarquee({ genres, label, pauseLabel, playLabel }: GenreMarqueeProps) {
  const ref = useRef<HTMLElement>(null);
  const tweensRef = useRef<gsap.core.Tween[]>([]);
  const [moving, setMoving] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  useGSAP(
    () => {
      const section = ref.current;
      if (!section) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const rows = gsap.utils.toArray<HTMLElement>("[data-marquee-track]", section);
        tweensRef.current = rows.map((row, index) =>
          gsap.fromTo(
            row,
            { xPercent: index % 2 === 0 ? 0 : -50 },
            { xPercent: index % 2 === 0 ? -50 : 0, duration: 46 + index * 8, ease: "none", repeat: -1 },
          ),
        );
        const trigger = ScrollTrigger.create({
          trigger: section,
          start: "top bottom",
          end: "bottom top",
          onToggle: (self) => {
            // Off screen: nothing to animate.
            tweensRef.current.forEach((tween) => (self.isActive && !pausedRef.current ? tween.resume() : tween.pause()));
          },
          onUpdate: (self) => {
            if (pausedRef.current) return;
            const boost = 1 + Math.min(Math.abs(self.getVelocity()) / 500, 5);
            tweensRef.current.forEach((tween) => {
              gsap.killTweensOf(tween, "timeScale");
              tween.timeScale(self.direction * boost);
              gsap.to(tween, { timeScale: self.direction, duration: 1.1, ease: "power2.out", delay: 0.12 });
            });
          },
        });
        setMoving(true);
        return () => {
          trigger.kill();
          tweensRef.current = [];
          setMoving(false);
        };
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  const toggle = () => {
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
    tweensRef.current.forEach((tween) => (next ? tween.pause() : tween.resume()));
  };

  const run = [...genres, ...genres];

  return (
    <section ref={ref} aria-label={label} className="relative overflow-hidden border-y border-border bg-canvas py-8 sm:py-10">
      <ul className="sr-only">
        {genres.map((genre) => (
          <li key={genre}>{genre}</li>
        ))}
      </ul>
      <div aria-hidden="true" className="grid gap-2 sm:gap-3">
        {[0, 1].map((row) => (
          <div key={row} className="overflow-hidden">
            <div data-marquee-track="" className="flex w-max will-change-transform">
              {[0, 1].map((half) => (
                <div key={half} className="flex shrink-0 items-center">
                  {run.map((genre, index) => (
                    <span key={`${half}-${index}`} className="flex items-center">
                      <span className={cn("display-xl px-5 whitespace-nowrap sm:px-9", row === 1 ? "text-outline" : "text-fg")}>{genre}</span>
                      <Spark className={cn("size-6 sm:size-9", row === 1 ? "text-fg-subtle" : "text-accent")} />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-canvas to-transparent sm:w-24" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-linear-to-l from-canvas via-canvas/85 to-transparent sm:w-36" />
      {moving && (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={paused}
          aria-label={paused ? playLabel : pauseLabel}
          className="absolute top-1/2 right-3 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-border-strong bg-canvas/80 text-fg-muted backdrop-blur-sm transition-colors hover:border-fg/40 hover:text-fg sm:right-6"
        >
          {paused ? <Play aria-hidden="true" className="size-4" /> : <Pause aria-hidden="true" className="size-4" />}
        </button>
      )}
    </section>
  );
}
