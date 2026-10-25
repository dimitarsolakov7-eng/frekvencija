import { Info } from "lucide-react";
import { SECTION_IDS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { cn } from "@/lib/utils/cn";
import { Container, SectionHeading } from "./primitives";
import { Reveal } from "./Reveal";
import { SECTION_SPACE } from "./layout";

export interface HowItWorksProps {
  copy: SiteCopy["howItWorks"];
}

/** Four numbered steps from request to decision, with the honest note about when the three days start. */
export function HowItWorks({ copy }: HowItWorksProps) {
  return (
    <section id={SECTION_IDS.howItWorks} aria-labelledby="how-it-works-title" className={cn("scroll-mt-24", SECTION_SPACE)}>
      <Container className="grid gap-12">
        <SectionHeading id="how-it-works-title" eyebrow={copy.eyebrow} title={copy.title} />
        <Reveal as="ol" className="grid gap-10 border-t border-border pt-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {copy.steps.map((step, index) => (
            <li key={step.title} className="grid content-start gap-4">
              <span aria-hidden="true" className="font-display text-4xl text-accent-text tabular-nums sm:text-5xl">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-xl font-semibold text-fg text-balance">
                <span className="sr-only">{index + 1}. </span>
                {step.title}
              </h3>
              <p className="text-base leading-relaxed text-fg-muted text-pretty">{step.body}</p>
            </li>
          ))}
        </Reveal>
        <p className="flex max-w-3xl items-start gap-3 rounded-[20px] border border-border bg-surface p-5 text-base text-fg-muted text-pretty">
          <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent-text" />
          <span>{copy.note}</span>
        </p>
      </Container>
    </section>
  );
}
