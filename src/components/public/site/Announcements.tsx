"use client";

import { useRef, useState } from "react";
import { Field, Input } from "@/components/ui";
import { waveformHeights } from "@/components/ui/Waveform";
import { SECTION_IDS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { previewStationName } from "@/lib/brand/station-name";
import { cn } from "@/lib/utils/cn";
import { gsap, MOTION_OK, useGSAP } from "./motion/gsap";
import { SplitHeading } from "./motion/SplitHeading";
import { Container, SectionLabel } from "./primitives";

export interface AnnouncementsProps {
  copy: SiteCopy["announcements"];
  quotes: SiteCopy["common"]["quotes"];
  /** The example venue the preview starts with. */
  exampleName: string;
}

type Segment = { kind: "music"; weight: number } | { kind: "voice"; weight: number; example: number };

/** One broadcast hour, compressed: music with the three example announcements between the songs. */
const SEGMENTS: readonly Segment[] = [
  { kind: "music", weight: 22 },
  { kind: "voice", weight: 7, example: 0 },
  { kind: "music", weight: 24 },
  { kind: "voice", weight: 7, example: 1 },
  { kind: "music", weight: 20 },
  { kind: "voice", weight: 7, example: 2 },
  { kind: "music", weight: 13 },
];

const TOTAL = SEGMENTS.reduce((sum, segment) => sum + segment.weight, 0);

/** The example on air at playhead position `progress` (0–1): the last announcement already reached. */
export function exampleAt(progress: number): number {
  let reached = 0;
  let start = 0;
  for (const segment of SEGMENTS) {
    if (segment.kind === "voice" && start / TOTAL <= progress) reached = segment.example;
    start += segment.weight;
  }
  return reached;
}

/** Venue name in bold inside an example sentence. */
function Highlighted({ template, name }: { template: string; name: string }) {
  const parts = template.split("{name}");
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && <strong className="font-semibold text-accent-text not-italic">{name}</strong>}
        </span>
      ))}
    </>
  );
}

/**
 * Chapter 06: what plays between the songs. Type a venue name and the station name and the three example
 * announcements change at once (a text preview — recorded voices are never regenerated). A broadcast strip
 * shows music and announcement slots; scrolling moves the playhead along it and lights up the example that
 * is on air.
 */
export function Announcements({ copy, quotes, exampleName }: AnnouncementsProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(exampleName);
  const [active, setActive] = useState(0);
  const trimmed = name.replace(/\s+/g, " ").trim();
  const displayName = trimmed === "" ? exampleName : trimmed;
  const station = previewStationName(name, exampleName);

  useGSAP(
    () => {
      const section = sectionRef.current;
      const playhead = section?.querySelector<HTMLElement>("[data-playhead]");
      const strip = section?.querySelector<HTMLElement>("[data-broadcast]");
      if (!section || !playhead || !strip) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const state = { p: 0 };
        gsap.to(state, {
          p: 1,
          ease: "none",
          scrollTrigger: { trigger: strip, start: "top 72%", end: () => `+=${Math.max(window.innerHeight * 0.9, 480)}`, scrub: 0.4 },
          onUpdate: () => {
            playhead.style.left = `${(state.p * 100).toFixed(2)}%`;
            const current = exampleAt(state.p);
            setActive((previous) => (previous === current ? previous : current));
          },
        });
      });
      return () => mm.revert();
    },
    { scope: sectionRef },
  );

  return (
    <section
      ref={sectionRef}
      id={SECTION_IDS.announcements}
      aria-labelledby="announcements-title"
      className="relative overflow-hidden border-t border-border bg-sidebar py-24 sm:py-32 lg:py-36"
    >
      <Container className="grid gap-16 lg:grid-cols-12 lg:gap-12">
        <div className="grid content-start gap-8 lg:sticky lg:top-28 lg:col-span-5 lg:self-start">
          <SectionLabel index="06">{copy.label}</SectionLabel>
          <SplitHeading id="announcements-title" className="display-xl text-fg">
            {copy.title}
          </SplitHeading>
          <p className="max-w-md text-lg leading-relaxed text-fg-muted text-pretty">{copy.lead}</p>
          <Field label={copy.inputLabel}>
            <Input
              value={name}
              maxLength={60}
              autoComplete="organization"
              placeholder={copy.inputPlaceholder}
              onChange={(event) => setName(event.currentTarget.value)}
              className="h-14! rounded-2xl! text-lg!"
            />
          </Field>
          <div className="grid gap-2 rounded-[24px] border border-border bg-canvas/70 p-6">
            <p className="label-mono text-fg-subtle">{copy.previewLabel}</p>
            <p aria-live="polite" className="display-md text-fg [overflow-wrap:anywhere]">
              {station}
            </p>
            <p className="pt-1 text-sm leading-relaxed text-fg-subtle">{copy.note}</p>
          </div>
        </div>

        <div className="grid content-start gap-5 lg:col-span-7">
          <div data-broadcast="" className="grid gap-5 rounded-[28px] border border-border bg-canvas p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4">
              <span className="label-mono flex items-center gap-2 text-accent-text">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                {copy.timelineLabel}
              </span>
              <span className="label-mono truncate text-fg-subtle">{station}</span>
            </div>
            <div aria-hidden="true" className="relative">
              <div className="flex h-20 gap-1.5">
                {SEGMENTS.map((segment, index) => (
                  <div
                    key={index}
                    className={cn(
                      "flex items-center gap-[2px] overflow-hidden rounded-lg px-1.5",
                      segment.kind === "voice" ? "bg-accent/15" : "bg-fg/[0.04]",
                    )}
                    style={{ flexGrow: segment.weight, flexBasis: 0 }}
                  >
                    {waveformHeights(segment.kind === "voice" ? 5 : Math.round(segment.weight * 0.8), `segment-${index}`).map((height, bar) => (
                      <span
                        key={bar}
                        className={cn("block min-w-0 flex-1 rounded-full", segment.kind === "voice" ? "bg-accent" : "bg-fg/30")}
                        style={{ height: `${Math.round(height * 100)}%` }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <span
                data-playhead=""
                className="absolute -top-2 -bottom-2 left-0 w-0.5 bg-fg shadow-[0_0_14px_rgb(243_237_228/0.7)] motion-reduce:hidden"
              />
            </div>
            <div aria-hidden="true" className="label-mono flex justify-between text-fg-subtle">
              <span>{copy.music}</span>
              <span className="text-accent-text">{copy.voice}</span>
            </div>
          </div>

          <ol className="grid gap-4">
            {copy.examples.map((example, index) => (
              <li
                key={example.key}
                className={cn(
                  "grid gap-3 rounded-[24px] border p-6 transition-[border-color,background-color,transform] duration-500 ease-expo sm:p-7",
                  active === index ? "border-accent/60 bg-accent/[0.07] motion-safe:lg:-translate-y-1" : "border-border bg-canvas/50",
                )}
              >
                <p className="label-mono flex items-center justify-between gap-3 text-fg-muted">
                  <span>{example.label}</span>
                  <span aria-hidden="true" className={cn("size-2 rounded-full transition-colors", active === index ? "bg-accent" : "bg-fg/20")} />
                </p>
                <blockquote className="serif-accent text-[clamp(1.5rem,1.1rem+1.4vw,2.3rem)] leading-tight text-fg">
                  {quotes.open}
                  <Highlighted template={example.text} name={displayName} />
                  {quotes.close}
                </blockquote>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
