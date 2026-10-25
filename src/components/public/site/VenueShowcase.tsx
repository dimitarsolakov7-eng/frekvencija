"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import { SECTION_IDS, VENUE_TYPES, VENUE_TYPE_KEYS, type VenueTypeKey } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { GenreOption } from "@/lib/public/trial-request";
import { cn } from "@/lib/utils/cn";
import { Container, SectionHeading } from "./primitives";
import { SECTION_SPACE } from "./layout";

export interface VenueShowcaseProps {
  copy: SiteCopy["venues"];
  /** Genres that exist in the catalogue (or the default list before setup), for the recommendations. */
  availableGenres: readonly GenreOption[];
}

/**
 * Editorial venue section: one large photograph and a description per venue type, switched with an
 * accessible tab list (arrow keys, Home/End, automatic activation). Genre recommendations come from
 * configuration but only name genres that are actually available.
 */
export function VenueShowcase({ copy, availableGenres }: VenueShowcaseProps) {
  const [selected, setSelected] = useState<VenueTypeKey>("cafe");
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<VenueTypeKey, HTMLButtonElement | null>>>({});
  const venue = VENUE_TYPES.find((entry) => entry.key === selected) ?? VENUE_TYPES[0];
  const item = copy.items[venue.key];
  const recommended = venue.recommendedGenres
    .map((slug) => availableGenres.find((genre) => genre.slug === slug))
    .filter((genre): genre is GenreOption => genre !== undefined);

  const select = (key: VenueTypeKey) => {
    setSelected(key);
    tabRefs.current[key]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = VENUE_TYPE_KEYS.indexOf(selected);
    const last = VENUE_TYPE_KEYS.length - 1;
    const next =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? VENUE_TYPE_KEYS[index === last ? 0 : index + 1]
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? VENUE_TYPE_KEYS[index === 0 ? last : index - 1]
          : event.key === "Home"
            ? VENUE_TYPE_KEYS[0]
            : event.key === "End"
              ? VENUE_TYPE_KEYS[last]
              : null;
    if (!next) return;
    event.preventDefault();
    select(next);
  };

  return (
    <section id={SECTION_IDS.venues} aria-labelledby="venues-title" className={cn("scroll-mt-24 bg-surface-2/50", SECTION_SPACE)}>
      <Container className="grid gap-12">
        <SectionHeading id="venues-title" eyebrow={copy.eyebrow} title={copy.title} lead={copy.lead} />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-14">
          <div key={venue.key} className="relative aspect-[4/3] overflow-hidden rounded-[28px] bg-surface-3 motion-safe:animate-fade-up sm:aspect-[16/11]">
            <Image
              src={venue.photo.src}
              alt={item.imageAlt}
              fill
              sizes="(min-width: 1024px) 60vw, 100vw"
              className="object-cover"
              style={{ objectPosition: venue.photo.position }}
              draggable={false}
            />
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/45 to-transparent" />
            <p className="absolute bottom-5 left-5 rounded-full bg-white/90 px-3.5 py-1.5 text-sm font-semibold text-[#191b22] backdrop-blur">
              {item.moment}
            </p>
          </div>

          <div className="grid content-start gap-7">
            <div role="tablist" aria-label={copy.selectorLabel} className="flex flex-wrap gap-2">
              {VENUE_TYPE_KEYS.map((key) => {
                const active = key === selected;
                return (
                  <button
                    key={key}
                    ref={(element) => {
                      tabRefs.current[key] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`${baseId}-tab-${key}`}
                    aria-selected={active}
                    aria-controls={`${baseId}-panel`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => select(key)}
                    onKeyDown={onKeyDown}
                    className={cn(
                      "inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                      active ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
                    )}
                  >
                    {copy.items[key].name}
                  </button>
                );
              })}
            </div>

            <div
              key={`${venue.key}-panel`}
              role="tabpanel"
              id={`${baseId}-panel`}
              aria-labelledby={`${baseId}-tab-${venue.key}`}
              className="grid gap-5 motion-safe:animate-fade-up"
            >
              <p className="eyebrow text-accent-text">{item.moment}</p>
              <h3 className="display-md text-fg">{item.name}</h3>
              <p className="max-w-[48ch] text-lg leading-relaxed text-fg-muted text-pretty">{item.body}</p>
              <div className="grid gap-3 border-t border-border pt-5">
                <p className="text-sm font-semibold text-fg">{copy.recommendedLabel}</p>
                {recommended.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {recommended.map((genre) => (
                      <li key={genre.slug} className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg">
                        {genre.name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-fg-muted">{copy.noRecommendation}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
