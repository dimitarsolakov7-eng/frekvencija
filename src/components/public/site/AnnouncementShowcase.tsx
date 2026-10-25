"use client";

import { useId, useState } from "react";
import { LockKeyhole, Mic, Music2 } from "lucide-react";
import type { DemoClip } from "@/config/demo-audio";
import { SECTION_IDS } from "@/config/site";
import type { AnnouncementExampleKey, SiteCopy } from "@/content/site/types";
import { fill } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils/cn";
import { FrequencyLine } from "./FrequencyLine";
import { Container, Eyebrow } from "./primitives";
import { SamplePlayButton } from "./SamplePlayButton";
import { SECTION_SPACE } from "./layout";

export interface AnnouncementShowcaseProps {
  copy: SiteCopy["announcements"];
  common: Pick<SiteCopy["common"], "exampleBadge" | "illustrativeNote">;
  personalizer: Pick<SiteCopy["personalizer"], "playExample" | "exampleUnavailable">;
  exampleName: string;
  clips: Record<AnnouncementExampleKey, DemoClip | null>;
}

/**
 * The one charcoal section: warm ivory text and cobalt details. The playback sequence
 * (Music → Station identity → Music → Your offer) is drawn as a line of steps on a frequency
 * line, and the example announcements can be explored with accessible tabs.
 */
export function AnnouncementShowcase({ copy, common, personalizer, exampleName, clips }: AnnouncementShowcaseProps) {
  const [selected, setSelected] = useState<AnnouncementExampleKey>("identity");
  const baseId = useId();
  const example = copy.examples.find((entry) => entry.key === selected) ?? copy.examples[0];
  const [first, second] = copy.titleLines;

  return (
    <section
      id={SECTION_IDS.announcements}
      aria-labelledby="announcements-title"
      className={cn("theme-charcoal relative scroll-mt-24 overflow-hidden bg-canvas text-fg", SECTION_SPACE)}
    >
      <FrequencyLine seed={11} amplitude={0.9} drift className="pointer-events-none absolute inset-x-[-5%] top-8 h-72 w-[110%] text-accent-text/12" />
      <Container className="relative grid gap-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-16">
          <div className="grid gap-5">
            <Eyebrow>{copy.eyebrow}</Eyebrow>
            <h2 id="announcements-title" className="display-lg text-fg">
              <span className="block">{first}</span>
              <span className="block text-accent-text">{second}</span>
            </h2>
          </div>
          <p className="max-w-[48ch] text-lg leading-relaxed text-fg-muted text-pretty sm:text-xl">{copy.lead}</p>
        </div>

        <figure className="grid gap-6">
          <figcaption className="eyebrow text-fg-muted">{copy.sequenceLabel}</figcaption>
          <ol className="relative grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
            <span aria-hidden="true" className="absolute top-7 right-[12.5%] left-[12.5%] hidden h-px bg-border-strong sm:block" />
            {copy.sequence.map((step, index) => {
              const voice = step.kind === "voice";
              const Icon = voice ? Mic : Music2;
              return (
                <li key={`${step.label}-${index}`} className="relative grid justify-items-center gap-3 text-center">
                  <span
                    className={cn(
                      "grid size-14 place-items-center rounded-full border",
                      voice ? "border-accent bg-accent text-accent-fg shadow-[0_12px_28px_-12px_rgb(61_91_255/0.8)]" : "border-border-strong bg-surface text-fg-muted",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-6" />
                  </span>
                  <span className={cn("text-sm font-medium text-balance", voice ? "text-fg" : "text-fg-muted")}>{step.label}</span>
                </li>
              );
            })}
          </ol>
        </figure>

        <div className="grid gap-6 rounded-[28px] border border-border bg-surface/80 p-6 shadow-card sm:p-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-10">
          <div className="grid content-start gap-4">
            <div role="tablist" aria-label={copy.examplesLabel} className="flex flex-wrap gap-2 lg:flex-col lg:items-start">
              {copy.examples.map((entry) => {
                const active = entry.key === selected;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    role="tab"
                    id={`${baseId}-tab-${entry.key}`}
                    aria-selected={active}
                    aria-controls={`${baseId}-panel`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setSelected(entry.key)}
                    onKeyDown={(event) => {
                      const keys = copy.examples.map((item) => item.key);
                      const index = keys.indexOf(selected);
                      const next =
                        event.key === "ArrowDown" || event.key === "ArrowRight"
                          ? keys[(index + 1) % keys.length]
                          : event.key === "ArrowUp" || event.key === "ArrowLeft"
                            ? keys[(index - 1 + keys.length) % keys.length]
                            : event.key === "Home"
                              ? keys[0]
                              : event.key === "End"
                                ? keys[keys.length - 1]
                                : null;
                      if (!next) return;
                      event.preventDefault();
                      setSelected(next);
                      document.getElementById(`${baseId}-tab-${next}`)?.focus();
                    }}
                    className={cn(
                      "inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                      active ? "border-accent bg-accent text-accent-fg" : "border-border-strong bg-transparent text-fg-muted hover:text-fg",
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
            <span className="w-fit rounded-full border border-border-strong px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-fg-muted uppercase">
              {common.exampleBadge}
            </span>
          </div>
          <div key={example.key} role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${example.key}`} className="grid content-between gap-6 motion-safe:animate-fade-up">
            <blockquote className="display-md text-fg">“{fill(example.text, { name: exampleName })}”</blockquote>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <SamplePlayButton
                id={`announcements:${example.key}`}
                clip={clips[example.key]}
                label={personalizer.playExample}
                stopLabel={personalizer.playExample}
                unavailableLabel={personalizer.exampleUnavailable}
                size="md"
              />
              <p className="text-sm text-fg-subtle">{common.illustrativeNote}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 text-base text-fg-muted sm:grid-cols-2 sm:gap-8">
          <p className="text-pretty">{copy.frequencyNote}</p>
          <p className="flex items-start gap-3 text-pretty">
            <LockKeyhole aria-hidden="true" className="mt-1 size-5 shrink-0 text-accent-text" />
            <span className="text-fg">{copy.privacyNote}</span>
          </p>
        </div>
      </Container>
    </section>
  );
}
