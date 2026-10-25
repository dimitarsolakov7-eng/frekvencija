"use client";

import { useRef, useState } from "react";
import { SECTION_IDS, VENUE_TYPES } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { GenreOption } from "@/lib/public/trial-request";
import { cn } from "@/lib/utils/cn";
import { DESKTOP_MOTION, gsap, useGSAP } from "./motion/gsap";
import { Reveal } from "./motion/Reveal";
import { SplitHeading } from "./motion/SplitHeading";
import { Photo } from "./Photo";
import { Container, SectionLabel } from "./primitives";

export interface VenuesProps {
  copy: SiteCopy["venues"];
  /** Genres that exist in the catalogue (or the default list), for the suggestions. */
  genres: readonly GenreOption[];
}

/**
 * Chapter 05: the venue types as a large editorial list. On desktop a photograph of the hovered venue
 * follows the pointer (tilting with its speed) and the other rows dim; on phones and touch screens each
 * row shows its photograph inline. All information is in the text — the floating photo is decorative.
 */
export function Venues({ copy, genres }: VenuesProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  useGSAP(
    () => {
      const section = sectionRef.current;
      const preview = previewRef.current;
      const list = section?.querySelector<HTMLElement>("[data-venue-list]");
      if (!section || !preview || !list) return;
      const mm = gsap.matchMedia();
      mm.add(DESKTOP_MOTION, () => {
        gsap.set(preview, { autoAlpha: 0, scale: 0.8 });
        const xTo = gsap.quickTo(preview, "x", { duration: 0.65, ease: "power3" });
        const yTo = gsap.quickTo(preview, "y", { duration: 0.65, ease: "power3" });
        const rotateTo = gsap.quickTo(preview, "rotation", { duration: 0.9, ease: "power3" });
        let lastX = 0;
        const place = (event: PointerEvent) => {
          xTo(event.clientX - preview.offsetWidth / 2);
          yTo(event.clientY - preview.offsetHeight / 2);
          rotateTo(gsap.utils.clamp(-10, 10, (event.clientX - lastX) * 0.5));
          lastX = event.clientX;
        };
        const onEnter = (event: PointerEvent) => {
          lastX = event.clientX;
          gsap.set(preview, { x: event.clientX - preview.offsetWidth / 2, y: event.clientY - preview.offsetHeight / 2 });
          gsap.to(preview, { autoAlpha: 1, scale: 1, duration: 0.55, ease: "expo.out", overwrite: "auto" });
        };
        const onLeave = () => {
          gsap.to(preview, { autoAlpha: 0, scale: 0.8, duration: 0.4, ease: "power3.out", overwrite: "auto" });
          setActive(null);
        };
        list.addEventListener("pointermove", place);
        list.addEventListener("pointerenter", onEnter);
        list.addEventListener("pointerleave", onLeave);
        return () => {
          list.removeEventListener("pointermove", place);
          list.removeEventListener("pointerenter", onEnter);
          list.removeEventListener("pointerleave", onLeave);
        };
      });
      return () => mm.revert();
    },
    { scope: sectionRef },
  );

  return (
    <section ref={sectionRef} id={SECTION_IDS.venues} aria-labelledby="venues-title" className="relative border-t border-border py-24 sm:py-32 lg:py-36">
      <Container className="grid gap-14 lg:gap-20">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-8">
          <div className="lg:col-span-3">
            <SectionLabel index="05">{copy.label}</SectionLabel>
          </div>
          <div className="grid gap-6 lg:col-span-9">
            <SplitHeading id="venues-title" className="display-xl max-w-[14ch] text-fg">
              {copy.title}
            </SplitHeading>
            <p className="max-w-xl text-lg leading-relaxed text-fg-muted text-pretty">{copy.lead}</p>
          </div>
        </div>

        <Reveal as="ul" items="[data-venue]" stagger={0.1} className="border-t border-border">
          {VENUE_TYPES.map((venue, index) => {
            const item = copy.items[venue.key];
            const suggested = venue.recommendedGenres
              .map((slug) => genres.find((genre) => genre.slug === slug)?.name)
              .filter((name): name is string => Boolean(name));
            return (
              <li
                key={venue.key}
                data-venue=""
                data-anim=""
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") setActive(index);
                }}
                className="group grid gap-x-8 gap-y-5 border-b border-border py-9 sm:py-11 lg:grid-cols-[4.5rem_minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:py-12"
              >
                <span className="label-mono text-fg-subtle">{String(index + 1).padStart(2, "0")}</span>
                <h3
                  className={cn(
                    "display-xl text-fg transition-[color,transform] duration-700 ease-expo lg:group-hover:translate-x-3 lg:group-hover:text-accent",
                    active !== null && active !== index && "lg:text-fg/25",
                  )}
                >
                  {item.name}
                </h3>
                <div className={cn("grid gap-3 transition-opacity duration-500", active !== null && active !== index && "lg:opacity-40")}>
                  <p className="label-mono text-accent-text">{item.moment}</p>
                  <p className="max-w-md text-base leading-relaxed text-fg-muted sm:text-lg">{item.body}</p>
                  {suggested.length > 0 && (
                    <p className="text-sm text-fg-subtle">
                      <span className="sr-only">{copy.recommendedLabel}: </span>
                      {suggested.join(" · ")}
                    </p>
                  )}
                </div>
                <div className="relative aspect-[16/10] overflow-hidden rounded-[22px] lg:hidden">
                  <Photo src={venue.photo} alt={item.imageAlt} fill sizes="100vw" className="object-cover" />
                </div>
              </li>
            );
          })}
        </Reveal>
      </Container>

      <div
        ref={previewRef}
        aria-hidden="true"
        className="pointer-events-none invisible fixed top-0 left-0 z-40 hidden h-[23rem] w-[17.5rem] overflow-hidden rounded-[26px] shadow-overlay lg:block"
      >
        {VENUE_TYPES.map((venue, index) => (
          <div
            key={venue.key}
            className={cn(
              "absolute inset-0 transition-[opacity,transform] duration-700 ease-expo",
              active === index ? "scale-100 opacity-100" : "scale-110 opacity-0",
            )}
          >
            <Photo src={venue.photo} alt="" fill sizes="280px" className="object-cover" />
          </div>
        ))}
      </div>
    </section>
  );
}
