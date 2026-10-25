import { waveformHeights } from "@/components/ui/Waveform";
import type { SiteCopy } from "@/content/site/types";
import { cn } from "@/lib/utils/cn";

export interface OnAirCardProps {
  copy: SiteCopy["hero"]["card"];
  quotes: SiteCopy["common"]["quotes"];
  /** "Example" tag: the station on the card is a sample, not a customer. */
  exampleBadge: string;
  className?: string;
}

const BARS = waveformHeights(30, "on-air-card");

/**
 * The glass "now on air" card of the hero: an illustration of a venue's station (EmeraldCaffe Radio),
 * decorative and hidden from assistive technology. Its equaliser swells a few times and then rests.
 */
export function OnAirCard({ copy, quotes, exampleBadge, className }: OnAirCardProps) {
  return (
    <div
      aria-hidden="true"
      data-hero-card=""
      data-anim=""
      className={cn("w-[24rem] rounded-[30px] border border-fg/12 bg-canvas/55 p-7 shadow-overlay backdrop-blur-xl", className)}
    >
      <div className="grid gap-6">
        <div className="flex items-center justify-between">
          <span className="label-mono flex items-center gap-2 text-accent-text">
            <span className="size-1.5 rounded-full bg-accent" />
            {copy.label}
          </span>
          <span className="label-mono tabular-nums text-fg-subtle">{copy.time}</span>
        </div>
        <div className="grid gap-2">
          <p className="display-md text-fg">{copy.station}</p>
          <div className="flex items-center justify-between gap-4">
            <p className="label-mono text-fg-muted">{copy.genre}</p>
            <span className="label-mono rounded-full border border-fg/15 px-2.5 py-1 text-fg-subtle">{exampleBadge}</span>
          </div>
        </div>
        <div className="flex h-16 items-center gap-[3px]">
          {BARS.map((height, index) => (
            <span
              key={index}
              className="block min-w-0 flex-1 origin-center rounded-full bg-fg/85 motion-safe:animate-eq-once"
              style={{ height: `${Math.round(height * 100)}%`, animationDelay: `${(index % 6) * 110}ms` }}
            />
          ))}
        </div>
        <p className="serif-accent text-[1.65rem] leading-snug text-fg/90">
          {quotes.open}
          {copy.quote}
          {quotes.close}
        </p>
        <div className="flex items-center gap-3">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-fg/15">
            <span className="block h-full w-[64%] rounded-full bg-accent" />
          </span>
          <span className="label-mono tabular-nums text-fg-subtle">3:12</span>
        </div>
      </div>
    </div>
  );
}
