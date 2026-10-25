import type { ReactNode } from "react";
import { SECTION_IDS, type VenueTypeKey } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { Locale } from "@/lib/i18n/locale";
import type { GenreOption } from "@/lib/public/trial-request";
import { cn } from "@/lib/utils/cn";
import { FrequencyLine } from "./FrequencyLine";
import { Container, Eyebrow } from "./primitives";
import { TrialRequestForm, type TrialRequestAction } from "./TrialRequestForm";
import { SECTION_SPACE } from "./layout";

export interface TrialSectionProps {
  copy: SiteCopy;
  locale: Locale;
  action: TrialRequestAction;
  genres: readonly GenreOption[];
  contactEmail: string | null;
  /** Replaces the section's own eyebrow/title/lead (the standalone /request-access page). */
  heading?: { eyebrow: string; title: string; lead: string; as?: "h1" | "h2" };
  /** Extra content under the lead (e.g. the "already have an account?" line). */
  aside?: ReactNode;
}

/** English "Other" is the only venue type without a website translation; it stays as the app spells it. */
const OTHER_TYPE_NAME: Record<Locale, string> = { mk: "Друго", en: "Other" };

/**
 * The conversion section: cobalt background, white editorial copy on the left and the light form
 * panel on the right (the panel re-enters the ivory theme so its controls look like the rest of the
 * site). Requests are stored by the server action; nothing is activated or charged automatically.
 */
export function TrialSection({ copy, locale, action, genres, contactEmail, heading, aside }: TrialSectionProps) {
  const Heading = heading?.as ?? "h2";
  const eyebrow = heading?.eyebrow ?? copy.trial.eyebrow;
  const title = heading?.title ?? copy.trial.title;
  const lead = heading?.lead ?? copy.trial.lead;
  const venueTypeNames = Object.fromEntries(
    (Object.keys(copy.venues.items) as VenueTypeKey[]).map((key) => [key, copy.venues.items[key].name]),
  ) as Record<VenueTypeKey, string>;

  return (
    <section
      id={SECTION_IDS.trial}
      aria-labelledby="trial-title"
      className={cn("theme-cobalt relative scroll-mt-24 overflow-hidden bg-canvas text-fg", SECTION_SPACE)}
    >
      <FrequencyLine seed={13} amplitude={0.8} drift className="pointer-events-none absolute inset-x-[-5%] bottom-0 h-64 w-[110%] text-white/12" />
      <Container className="relative grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-16">
        <div className="grid content-start gap-6 lg:sticky lg:top-28">
          <Eyebrow className="text-fg">{eyebrow}</Eyebrow>
          <Heading id="trial-title" className="display-lg text-fg">
            {title}
          </Heading>
          <p className="max-w-[46ch] text-lg leading-relaxed text-fg-muted text-pretty sm:text-xl">{lead}</p>
          <ol className="grid gap-3 border-t border-border pt-6 text-base text-fg-muted">
            {copy.trial.nextSteps.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full border border-border-strong text-xs font-semibold text-fg">
                  {index + 1}
                </span>
                <span className="pt-0.5 text-pretty">{step}</span>
              </li>
            ))}
          </ol>
          {aside}
        </div>
        <div className="theme-public rounded-[28px] bg-surface p-6 text-fg shadow-overlay sm:p-8 lg:p-10">
          <TrialRequestForm
            action={action}
            locale={locale}
            copy={copy.trial}
            venueTypeNames={venueTypeNames}
            otherTypeName={OTHER_TYPE_NAME[locale]}
            genres={genres}
            contactEmail={contactEmail}
          />
        </div>
      </Container>
    </section>
  );
}
