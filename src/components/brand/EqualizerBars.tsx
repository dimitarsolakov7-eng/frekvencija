import type { CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";

export type EqualizerBarsSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<EqualizerBarsSize, { box: string; bar: string }> = {
  sm: { box: "h-3 gap-[2px]", bar: "w-[2px]" },
  md: { box: "h-4 gap-[2px]", bar: "w-[3px]" },
  lg: { box: "h-6 gap-[3px]", bar: "w-1" },
};

/** Resting heights double as the still icon; delays/durations de-synchronise the animation. */
const BARS: readonly { rest: number; delay: string; duration: string }[] = [
  { rest: 0.45, delay: "-0.4s", duration: "0.9s" },
  { rest: 0.85, delay: "-0.15s", duration: "1.1s" },
  { rest: 0.6, delay: "-0.7s", duration: "0.8s" },
  { rest: 0.35, delay: "-0.25s", duration: "1.2s" },
];

export interface EqualizerBarsProps {
  /** Animate while audio is actually playing; otherwise (and with reduced motion) the bars stay still. */
  playing: boolean;
  size?: EqualizerBarsSize;
  /**
   * Accessible label. Omit when the playing state is already announced elsewhere (the player's
   * status region), which keeps the indicator decorative.
   */
  label?: string;
  className?: string;
}

/** Small "now playing" indicator. */
export function EqualizerBars({ playing, size = "md", label, className }: EqualizerBarsProps) {
  const s = SIZE_CLASSES[size];
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-flex shrink-0 items-end text-accent", s.box, className)}
    >
      {BARS.map((bar, index) => (
        <span
          key={index}
          className={cn("h-full origin-bottom rounded-full bg-current", s.bar, playing && "motion-safe:animate-eq")}
          style={
            {
              transform: `scaleY(${bar.rest})`,
              animationDelay: bar.delay,
              animationDuration: bar.duration,
            } satisfies CSSProperties
          }
        />
      ))}
    </span>
  );
}
