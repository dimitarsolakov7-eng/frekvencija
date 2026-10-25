import { Laptop, Smartphone, Speaker, Tablet } from "lucide-react";
import { PHOTOS } from "@/assets/photos";
import { waveformHeights } from "@/components/ui/Waveform";
import { EXAMPLE_STATION_NAMES, EXAMPLE_VENUE_NAME, SECTION_IDS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { Reveal } from "./motion/Reveal";
import { SplitHeading } from "./motion/SplitHeading";
import { NameCycler } from "./NameCycler";
import { Photo } from "./Photo";
import { Container, SectionLabel } from "./primitives";
import { SpotlightCard } from "./SpotlightCard";

export interface FeaturesProps {
  copy: SiteCopy["features"];
}

const VOICE_BARS = waveformHeights(40, "station-voice");

function CardText({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid max-w-md gap-2.5">
      <h3 className="text-2xl font-semibold tracking-[-0.02em] text-fg">{title}</h3>
      <p className="text-base leading-relaxed text-fg-muted">{body}</p>
    </div>
  );
}

/**
 * Chapter 04: a bento of six features, each with its own composition — the station name being "typed"
 * on air, a giant zero for outside ads, photographs for offers and staff, the hours of a day, the devices.
 * Cards rise in one after another and carry a pointer spotlight.
 */
export function Features({ copy }: FeaturesProps) {
  const { items } = copy;
  return (
    <section id={SECTION_IDS.features} aria-labelledby="features-title" className="relative py-24 sm:py-32 lg:py-36">
      <Container className="grid gap-14 lg:gap-20">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-8">
          <div className="lg:col-span-3">
            <SectionLabel index="04">{copy.label}</SectionLabel>
          </div>
          <SplitHeading id="features-title" className="display-xl max-w-[15ch] text-fg lg:col-span-9">
            {copy.title}
          </SplitHeading>
        </div>

        <Reveal items="[data-feature]" stagger={0.1} className="grid gap-4 lg:grid-cols-12 lg:gap-5">
          <SpotlightCard className="flex min-h-[30rem] flex-col justify-between gap-12 p-7 sm:p-10 lg:col-span-7 lg:row-span-2">
            <div aria-hidden="true" className="flex h-10 items-center gap-[3px]">
              {VOICE_BARS.map((height, index) => (
                <span
                  key={index}
                  className="block min-w-0 flex-1 origin-center rounded-full bg-accent/80 motion-safe:animate-eq-once"
                  style={{ height: `${Math.round(height * 100)}%`, animationDelay: `${(index % 8) * 90}ms` }}
                />
              ))}
            </div>
            <div className="grid gap-10">
              <p aria-hidden="true" className="display-lg text-fg">
                {copy.nameQuote.lead} <NameCycler names={EXAMPLE_STATION_NAMES} className="text-accent" /> {copy.nameQuote.tail}
              </p>
              <p className="sr-only">
                {copy.nameQuote.lead} {EXAMPLE_VENUE_NAME} {copy.nameQuote.tail}
              </p>
              <CardText title={items.name.title} body={items.name.body} />
            </div>
          </SpotlightCard>

          <SpotlightCard className="flex min-h-[19rem] flex-col justify-between gap-8 p-7 sm:p-10 lg:col-span-5">
            <p aria-hidden="true" className="flex items-end gap-4">
              <span className="font-display text-[clamp(7rem,5rem+6vw,11rem)] leading-[0.75] font-extrabold text-accent">0</span>
              <span className="label-mono pb-2 text-fg-muted">{copy.adsCaption}</span>
            </p>
            <CardText title={items.noAds.title} body={items.noAds.body} />
          </SpotlightCard>

          <SpotlightCard className="flex min-h-[19rem] flex-col justify-end lg:col-span-5">
            <div className="absolute inset-0 -z-20 transition-transform duration-1000 ease-expo group-hover:scale-105">
              <Photo src={PHOTOS.cocktail} alt="" fill sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" />
            </div>
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-canvas via-canvas/70 to-canvas/10" />
            <div className="grid gap-5 p-7 sm:p-10">
              <span className="label-mono w-fit rounded-full border border-accent/50 bg-canvas/60 px-3 py-1.5 text-accent-text backdrop-blur">
                {copy.offerChip}
              </span>
              <CardText title={items.offers.title} body={items.offers.body} />
            </div>
          </SpotlightCard>

          <SpotlightCard className="flex min-h-[22rem] flex-col justify-between gap-10 p-7 sm:p-10 lg:col-span-4">
            <ol aria-hidden="true" className="grid gap-3">
              {copy.hours.map((slot, index) => (
                <li key={slot.time} className="flex items-center gap-4 border-b border-border pb-3 last:border-b-0">
                  <span className="label-mono tabular-nums text-fg-subtle">{slot.time}</span>
                  <span className={index === copy.hours.length - 1 ? "font-semibold text-accent-text" : "font-semibold text-fg"}>{slot.genre}</span>
                </li>
              ))}
            </ol>
            <CardText title={items.hours.title} body={items.hours.body} />
          </SpotlightCard>

          <SpotlightCard className="flex min-h-[22rem] flex-col justify-between gap-10 p-7 sm:p-10 lg:col-span-4">
            <div className="grid gap-4">
              <div aria-hidden="true" className="flex items-end gap-5 text-fg">
                <Laptop strokeWidth={1.25} className="size-14" />
                <Tablet strokeWidth={1.25} className="size-11" />
                <Smartphone strokeWidth={1.25} className="size-9" />
                <Speaker strokeWidth={1.25} className="ml-auto size-11 text-accent" />
              </div>
              <p className="label-mono text-fg-subtle">{copy.devices}</p>
            </div>
            <CardText title={items.browser.title} body={items.browser.body} />
          </SpotlightCard>

          <SpotlightCard className="flex min-h-[22rem] flex-col justify-end lg:col-span-4">
            <div className="absolute inset-0 -z-20 transition-transform duration-1000 ease-expo group-hover:scale-105">
              <Photo src={PHOTOS.espresso} alt="" fill sizes="(min-width: 1024px) 33vw, 100vw" className="object-cover" />
            </div>
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-canvas via-canvas/75 to-canvas/10" />
            <div className="p-7 sm:p-10">
              <CardText title={items.staff.title} body={items.staff.body} />
            </div>
          </SpotlightCard>
        </Reveal>
      </Container>
    </section>
  );
}
