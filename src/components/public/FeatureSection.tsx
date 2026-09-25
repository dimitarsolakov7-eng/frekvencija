import { Waveform } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { EXAMPLE_STATION } from "./Hero";
import { EYEBROW_CLASSES, SECTION_TITLE_CLASSES } from "./layout";
import { VenuePhoto } from "./VenuePhoto";

/** "Make it sound like you." — the personal-station feature with an example announcement. */
export function FeatureSection() {
  return (
    <section aria-labelledby="feature-title" className="border-y border-border bg-sidebar/40">
      <div className="grid lg:grid-cols-2">
        <div className="relative min-h-64 overflow-hidden sm:min-h-80 lg:min-h-[26rem]">
          {/* Same photograph as the hero, zoomed towards the candle-lit lounge tables on its left. */}
          <VenuePhoto
            sizes="(min-width: 1024px) 75vw, 150vw"
            imageClassName="origin-[0%_80%] scale-[1.45] object-[0%_80%]"
            overlays={["bg-linear-to-t from-canvas/80 via-transparent to-transparent lg:bg-linear-to-l lg:from-canvas/70"]}
          />
        </div>
        <div className="mx-auto flex w-full max-w-2xl flex-col justify-center gap-6 px-4 py-12 sm:px-6 lg:mx-0 lg:px-14 lg:py-16">
          <h2 id="feature-title" className={SECTION_TITLE_CLASSES}>
            Make it sound like you.
          </h2>
          <p className="max-w-lg text-lg text-fg-muted text-pretty">
            A station with your name, tailored to your space and your guests. The same great music, with a personal
            touch.
          </p>
          <figure className="grid max-w-lg gap-2">
            <figcaption className={cn(EYEBROW_CLASSES, "text-fg-muted")}>Example announcement</figcaption>
            <div className="flex items-center gap-5 rounded-card border border-border bg-surface px-5 py-4 shadow-card">
              <Waveform bars={20} className="h-10 w-28 shrink-0" />
              <blockquote className="text-fg italic">“{EXAMPLE_STATION.quote}”</blockquote>
            </div>
          </figure>
        </div>
      </div>
    </section>
  );
}
