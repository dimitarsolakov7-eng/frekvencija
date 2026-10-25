import { cn } from "@/lib/utils/cn";

export interface FrequencyLineProps {
  /** Number of sample points; more points = a more detailed line. Default 96. */
  points?: number;
  /** Changes the shape. */
  seed?: number;
  /** Overall amplitude (0–1 of the height). Default 0.55. */
  amplitude?: number;
  strokeWidth?: number;
  /** Size the box with width/height utilities; the line stretches to fill it. */
  className?: string;
  /** Gentle sideways drift (motion-safe only). */
  drift?: boolean;
}

/**
 * The website's frequency-line motif: one smooth, deterministic "sound wave" drawn in currentColor
 * (decorative, aria-hidden). It connects the typography, the console and the photography without
 * pretending to visualise any real audio.
 */
export function FrequencyLine({ points = 96, seed = 1, amplitude = 0.55, strokeWidth = 1.5, className, drift = false }: FrequencyLineProps) {
  const width = 1000;
  const height = 100;
  const mid = height / 2;
  const coords: string[] = [];
  for (let index = 0; index <= points; index++) {
    const t = index / points;
    // A few harmonics with a soft envelope: calm at the edges, lively in the middle.
    const envelope = Math.sin(Math.PI * t) ** 0.7;
    const wave =
      Math.sin(t * Math.PI * 6 + seed) * 0.55 +
      Math.sin(t * Math.PI * 13 + seed * 1.7) * 0.3 +
      Math.sin(t * Math.PI * 29 + seed * 0.4) * 0.15;
    const y = mid - wave * envelope * amplitude * mid;
    coords.push(`${(t * width).toFixed(1)},${y.toFixed(2)}`);
  }
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("block h-16 w-full overflow-visible text-accent-text", drift && "motion-safe:animate-freq-drift", className)}
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
