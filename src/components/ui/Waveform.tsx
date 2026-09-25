import type { CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";
import { seededRandom } from "@/lib/utils/hash";

/**
 * Bar heights (0.12–1) for a decorative waveform: seeded noise shaped by a soft speech-like
 * envelope, identical for the same count + seed on server and client.
 */
export function waveformHeights(count: number, seed: string = "frekvencija"): number[] {
  const total = Math.max(0, Math.floor(count));
  if (total === 0) return [];
  const random = seededRandom(`${seed}:${total}`);
  return Array.from({ length: total }, (_, index) => {
    const position = total === 1 ? 0.5 : index / (total - 1);
    // Rises from the edges, with a gentle second swell like a spoken phrase.
    const envelope = 0.35 + 0.65 * Math.sin(Math.PI * position) ** 0.6 * (0.8 + 0.2 * Math.sin(position * 9));
    const value = envelope * (0.45 + 0.55 * random());
    return Math.round(Math.min(1, Math.max(0.12, value)) * 100) / 100;
  });
}

export type WaveformTone = "accent" | "muted";

function barStyle(height: number): CSSProperties {
  return { height: `${height * 100}%`, maxWidth: "4px" };
}

export interface WaveformProps {
  /** Number of bars. Default 32. */
  bars?: number;
  /** Changes the pattern; use something stable such as a clip id. */
  seed?: string;
  /**
   * 0–1: bars before this point use the tone colour and the rest are muted (the audio preview of
   * screen 07). Omit to colour every bar.
   */
  progress?: number | null;
  tone?: WaveformTone;
  /** Size the box with height/width utilities; default `h-8`. Bars stretch to fill it. */
  className?: string;
}

/**
 * Decorative waveform bars (screens 03/07), always `aria-hidden`. It never animates, so it can't
 * suggest that audio is playing when it isn't.
 */
export function Waveform({ bars = 32, seed, progress, tone = "accent", className }: WaveformProps) {
  const heights = waveformHeights(bars, seed);
  const playedUntil =
    progress === null || progress === undefined || !Number.isFinite(progress)
      ? heights.length
      : Math.round(Math.min(1, Math.max(0, progress)) * heights.length);
  const active = tone === "accent" ? "bg-accent" : "bg-fg-muted";

  return (
    <span aria-hidden="true" className={cn("flex h-8 items-center gap-[2px]", className)}>
      {heights.map((height, index) => (
        <span
          key={index}
          className={cn("min-w-[2px] flex-1 rounded-full", index < playedUntil ? active : "bg-fg-muted/35")}
          style={barStyle(height)}
        />
      ))}
    </span>
  );
}
