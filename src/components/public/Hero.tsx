import Image from "next/image";
import { ArrowRight, Pause } from "lucide-react";
import { ButtonLink, Waveform } from "@/components/ui";
import { defaultGenreArtwork } from "@/lib/brand/genre-artwork";
import { cn } from "@/lib/utils/cn";
import { EYEBROW_CLASSES, PUBLIC_CONTAINER } from "./layout";
import { VenuePhoto } from "./VenuePhoto";

/** Example content of the hero card. It is labelled as an example: no real station or playback. */
export const EXAMPLE_STATION = { name: "EmeraldBar Radio", genre: "House", quote: "You’re listening to EmeraldBar Radio." } as const;

/**
 * Illustration of a venue's station — explicitly labelled "Example station". The pause glyph is part of
 * the picture (aria-hidden), not a control, and nothing plays.
 */
function ExampleStation() {
  return (
    <figure className="grid w-full max-w-[22rem] gap-3">
      <figcaption className="sr-only">
        An example of a venue’s station: {EXAMPLE_STATION.name} playing {EXAMPLE_STATION.genre}, with its own
        station announcement.
      </figcaption>
      <div className="rounded-card border border-white/10 bg-canvas/80 p-3 shadow-overlay backdrop-blur-md">
        <p className={cn(EYEBROW_CLASSES, "mb-2.5 px-1 text-accent-text")}>Example station</p>
        <div className="flex items-center gap-3">
          <div className="relative size-14 shrink-0 overflow-hidden rounded-control border border-white/10">
            <Image src={defaultGenreArtwork("house")} alt="" fill sizes="56px" className="object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-fg">{EXAMPLE_STATION.name}</p>
            <p className="truncate text-sm text-fg-muted">{EXAMPLE_STATION.genre}</p>
          </div>
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-accent-fg"
          >
            <Pause className="size-5 fill-current" />
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4 rounded-card border border-white/10 bg-canvas/80 px-4 py-3.5 shadow-overlay backdrop-blur-md">
        <Waveform bars={12} className="h-8 w-16 shrink-0" />
        <p className="text-sm text-fg-muted italic">“{EXAMPLE_STATION.quote}”</p>
      </div>
    </figure>
  );
}

/** Two-column hero: pitch and actions on the left, the venue photograph with the example station on the right. */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      // Slides under the transparent header (72px) so the photo reaches the top edge on desktop.
      className="relative isolate -mt-[72px] overflow-hidden pt-[72px]"
    >
      <div
        className={cn(
          PUBLIC_CONTAINER,
          "grid gap-10 pt-8 pb-12 sm:pt-12 lg:min-h-[600px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-8 lg:pt-10 lg:pb-20",
        )}
      >
        <div className="grid content-start gap-7 lg:pt-6">
          <p
            className={cn(
              EYEBROW_CLASSES,
              "w-fit rounded-full border border-border-strong bg-canvas/60 px-3 py-1.5 text-fg-muted",
            )}
          >
            Radio for your business
          </p>
          <h1
            id="hero-title"
            className="text-[2.75rem] leading-[1.02] font-bold tracking-tight text-fg sm:text-6xl lg:text-[4.5rem]"
          >
            <span className="block">Your place.</span>
            <span className="block">Your sound.</span>
            <span className="block text-accent-text">Your radio.</span>
          </h1>
          <p className="max-w-md text-lg text-fg-muted sm:text-xl">
            Music for your atmosphere.
            <br />A station with your name.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/request-access" size="lg" iconRight={<ArrowRight aria-hidden="true" />}>
              Request access
            </ButtonLink>
            <ButtonLink href="#genres" size="lg" variant="outline">
              Explore genres
            </ButtonLink>
          </div>
        </div>

        {/*
          Mobile/tablet: a rounded photo block with the example station on top of it.
          Desktop: this wrapper becomes static, so the photo (absolute) fills the right side of the whole
          hero, behind the header, fading into the page on the left and bottom.
        */}
        <div className="relative flex min-h-[340px] items-end overflow-hidden rounded-card p-4 sm:min-h-[420px] sm:p-6 lg:static lg:min-h-0 lg:items-start lg:justify-end lg:overflow-visible lg:rounded-none lg:p-0 lg:pt-2">
          <div className="absolute inset-0 -z-10 lg:left-auto lg:w-[60%]">
            <VenuePhoto
              eager
              sizes="(min-width: 1024px) 60vw, 100vw"
              alt="A warmly lit cocktail bar with green velvet bar stools"
              imageClassName="object-[62%_50%]"
              overlays={[
                "bg-linear-to-t from-canvas/90 via-canvas/10 to-transparent lg:from-canvas lg:via-transparent",
                "lg:bg-linear-to-r lg:from-canvas lg:via-canvas/40 lg:to-transparent",
                "lg:bg-linear-to-b lg:from-canvas/60 lg:via-transparent lg:to-transparent",
              ]}
            />
          </div>
          <ExampleStation />
        </div>
      </div>
    </section>
  );
}
