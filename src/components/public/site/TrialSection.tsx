import type { ReactNode } from "react";
import { PHOTOS } from "@/assets/photos";
import { SECTION_IDS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { Locale } from "@/lib/i18n/locale";
import type { GenreOption } from "@/lib/public/trial-request";
import { Reveal } from "./motion/Reveal";
import { SplitHeading } from "./motion/SplitHeading";
import { Photo } from "./Photo";
import { Container, SectionLabel } from "./primitives";
import { TrialRequestForm, type TrialRequestAction } from "./TrialRequestForm";

export interface TrialSectionProps {
  copy: SiteCopy;
  locale: Locale;
  action: TrialRequestAction;
  genres: readonly GenreOption[];
  contactEmail: string | null;
  /** Replaces the section's own label/title/lead (the standalone /request-access page). */
  heading?: { eyebrow: string; title: string; lead: string; as?: "h1" | "h2" };
  /** Extra content under the lead (e.g. the "already have an account?" line). */
  aside?: ReactNode;
}

/**
 * The climax of the page: a warm photograph under a vermillion glow, the promise in large type with the
 * three next steps, and the request form on a light card. Requests are stored by the server action;
 * nothing is activated or charged automatically.
 */
export function TrialSection({ copy, locale, action, genres, contactEmail, heading, aside }: TrialSectionProps) {
  const label = heading?.eyebrow ?? copy.trial.label;
  const title = heading?.title ?? copy.trial.title;
  const lead = heading?.lead ?? copy.trial.lead;

  return (
    <section id={SECTION_IDS.trial} aria-labelledby="trial-title" className="relative isolate overflow-hidden border-t border-border py-28 sm:py-32 lg:py-36">
      <div aria-hidden="true" className="absolute inset-0 -z-20">
        <Photo src={PHOTOS.friends} alt="" fill sizes="100vw" className="object-cover opacity-30" />
      </div>
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-b from-canvas via-canvas/80 to-canvas" />
      <div aria-hidden="true" className="absolute top-1/4 left-1/2 -z-10 size-[56rem] -translate-x-1/2 rounded-full bg-accent/20 blur-[160px]" />
      <div aria-hidden="true" className="grain absolute inset-0 -z-10" />

      <Container className="grid gap-14 lg:grid-cols-12 lg:gap-12">
        <div className="grid content-start gap-8 lg:sticky lg:top-28 lg:col-span-5 lg:self-start">
          {/* The chapter number belongs to the homepage; the standalone page has no chapters. */}
          <SectionLabel index={heading ? undefined : "09"}>{label}</SectionLabel>
          <SplitHeading as={heading?.as ?? "h2"} id="trial-title" className="display-xl text-fg">
            {title}
          </SplitHeading>
          <p className="max-w-md text-xl leading-relaxed text-fg/85 text-pretty">{lead}</p>
          <ol className="grid gap-4 border-t border-fg/15 pt-7">
            {copy.trial.nextSteps.map((step, index) => (
              <li key={step} className="flex items-start gap-4 text-base text-fg/80">
                <span className="label-mono mt-0.5 text-accent-text">{String(index + 1).padStart(2, "0")}</span>
                <span className="text-pretty">{step}</span>
              </li>
            ))}
          </ol>
          {aside}
        </div>
        <Reveal className="lg:col-span-7">
          <div className="theme-paper rounded-[32px] p-6 shadow-overlay sm:p-10 lg:p-12">
            <TrialRequestForm action={action} locale={locale} copy={copy.trial} genres={genres} contactEmail={contactEmail} />
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
