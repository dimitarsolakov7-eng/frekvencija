"use client";

import { useId, useState } from "react";
import { Radio } from "lucide-react";
import { Field, Input } from "@/components/ui";
import type { DemoClip } from "@/config/demo-audio";
import { SECTION_IDS, VENUE_TYPE_KEYS, type VenueTypeKey } from "@/config/site";
import type { AnnouncementExampleKey, SiteCopy } from "@/content/site/types";
import { previewStationName } from "@/lib/brand/station-name";
import { cn } from "@/lib/utils/cn";
import { FrequencyLine } from "./FrequencyLine";
import { Container, Eyebrow, SectionHeading } from "./primitives";
import { SamplePlayButton } from "./SamplePlayButton";
import { SECTION_SPACE } from "./layout";

export interface PersonalizerProps {
  copy: SiteCopy["personalizer"];
  common: Pick<SiteCopy["common"], "exampleBadge">;
  /** Venue type names in the current language. */
  venueTypes: Record<VenueTypeKey, string>;
  /** The example venue the preview starts with. */
  exampleName: string;
  /** Prerecorded example announcements (null = text only). */
  clips: Record<AnnouncementExampleKey, DemoClip | null>;
}

const MAX_NAME = 60;

/** Venue name in bold inside an example sentence. */
function Highlighted({ template, name }: { template: string; name: string }) {
  const parts = template.split("{name}");
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && <strong className="font-semibold text-fg">{name}</strong>}
        </span>
      ))}
    </>
  );
}

/**
 * "How would your radio sound?" — type a venue name, pick a venue type, and the station preview and
 * the example announcements update immediately. Honest by design: the text changes, the recorded
 * voice samples (when configured) are for the example venue and are never regenerated.
 */
export function Personalizer({ copy, common, venueTypes, exampleName, clips }: PersonalizerProps) {
  const [name, setName] = useState(exampleName);
  const [type, setType] = useState<VenueTypeKey>("cafe");
  const typeGroupId = useId();
  const trimmed = name.replace(/\s+/g, " ").trim();
  const displayName = trimmed === "" ? exampleName : trimmed;
  const station = previewStationName(name, exampleName);

  return (
    <section id={SECTION_IDS.listen} aria-labelledby="listen-title" className={cn("scroll-mt-24", SECTION_SPACE)}>
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div className="grid content-start gap-8">
          <SectionHeading id="listen-title" eyebrow={copy.eyebrow} title={copy.title} lead={copy.lead} />
          <div className="grid gap-6">
            <Field label={copy.venueNameLabel}>
              <Input
                value={name}
                maxLength={MAX_NAME}
                autoComplete="organization"
                placeholder={copy.venueNamePlaceholder}
                onChange={(event) => setName(event.currentTarget.value)}
                className="h-14 text-lg"
              />
            </Field>
            <fieldset className="grid gap-2.5">
              <legend className="mb-2.5 text-sm font-medium text-fg">{copy.venueTypeLabel}</legend>
              <div className="flex flex-wrap gap-2">
                {VENUE_TYPE_KEYS.map((key) => {
                  const checked = key === type;
                  return (
                    <label
                      key={key}
                      className={cn(
                        "inline-flex h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors",
                        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
                        checked ? "border-fg bg-fg text-canvas" : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${typeGroupId}-type`}
                        value={key}
                        checked={checked}
                        onChange={() => setType(key)}
                        className="sr-only"
                      />
                      {venueTypes[key]}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <p className="text-sm text-fg-muted text-pretty">{copy.note}</p>
          </div>
        </div>

        <div className="grid content-start gap-5">
          <div className="relative overflow-hidden rounded-[26px] border border-border bg-surface p-6 shadow-card sm:p-8">
            <FrequencyLine seed={5} amplitude={0.5} className="pointer-events-none absolute inset-x-0 bottom-0 h-16 text-accent-text/30" />
            <div className="flex items-start justify-between gap-4">
              <div className="grid gap-2">
                <Eyebrow>{copy.previewLabel}</Eyebrow>
                <p className="display-md text-fg [overflow-wrap:anywhere]" aria-live="polite">
                  {station}
                </p>
                <p className="text-sm font-medium text-fg-muted">{venueTypes[type]}</p>
              </div>
              <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
                <Radio className="size-5" />
              </span>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-fg">{copy.examplesTitle}</h3>
              <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-fg-muted uppercase">
                {common.exampleBadge}
              </span>
            </div>
            <ul className="grid gap-3">
              {copy.examples.map((example) => (
                <li key={example.key} className="grid gap-3 rounded-[20px] border border-border bg-surface p-5">
                  <p className="eyebrow text-fg-muted">{example.label}</p>
                  <blockquote className="font-display text-xl leading-snug text-fg sm:text-2xl">
                    “<Highlighted template={example.text} name={displayName} />”
                  </blockquote>
                  <SamplePlayButton
                    id={`personalizer:${example.key}`}
                    clip={clips[example.key]}
                    label={copy.playExample}
                    stopLabel={copy.playExample}
                    unavailableLabel={copy.exampleUnavailable}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}
