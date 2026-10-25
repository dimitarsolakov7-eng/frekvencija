import { cn } from "@/lib/utils/cn";
import { CONTAINER } from "./layout";

const MARKS = [88, 92, 96, 100, 104, 108] as const;
const LOW = 88;
const HIGH = 108;

/** Position of a frequency on the dial, in percent of its width. */
export function dialPercent(frequency: number): number {
  return ((frequency - LOW) / (HIGH - LOW)) * 100;
}

/** The station's place on the dial (decorative). */
export const DIAL_FREQUENCY = 101.7;

/**
 * The FM dial along the bottom of the hero: a tick scale, frequency marks and a glowing needle that the
 * hero's motion tunes in on load and drifts with the scroll. Decorative (aria-hidden), with the scroll
 * cue on the left.
 */
export function FmDial({ scrollCue }: { scrollCue: string }) {
  return (
    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 z-10">
      <div className={cn(CONTAINER, "flex items-end justify-between pb-4")}>
        <span data-hero-fade="" data-anim="" className="label-mono hidden items-center gap-3 text-fg-subtle sm:flex">
          <span className="relative h-9 w-px overflow-hidden bg-fg/15">
            <span className="absolute inset-0 bg-fg motion-safe:animate-cue" />
          </span>
          {scrollCue}
        </span>
        <span className="label-mono text-fg-subtle">FM</span>
      </div>
      <div className={CONTAINER}>
        <div
          className="relative h-12 border-t border-fg/15"
          style={{
            backgroundImage: "repeating-linear-gradient(to right, rgb(243 237 228 / 0.2) 0 1px, transparent 1px 12px)",
            backgroundSize: "100% 38%",
            backgroundRepeat: "repeat-x",
            backgroundPosition: "bottom",
          }}
        >
          {MARKS.map((mark) => (
            <span
              key={mark}
              className={cn(
                "label-mono absolute top-2 text-fg-subtle",
                mark === LOW ? "translate-x-0" : mark === HIGH ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${dialPercent(mark)}%` }}
            >
              {mark}
            </span>
          ))}
          <div data-dial-drift="" className="absolute inset-0">
            <span
              data-dial-needle=""
              className="absolute bottom-0 h-[150%] w-0.5 bg-accent shadow-[0_0_18px_rgb(255_91_46/0.85)]"
              style={{ left: `${dialPercent(DIAL_FREQUENCY)}%` }}
            >
              <span className="label-mono absolute -top-6 left-2 tabular-nums text-accent-text">{DIAL_FREQUENCY.toFixed(1)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
