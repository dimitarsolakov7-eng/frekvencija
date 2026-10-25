import { Accordion } from "@/components/ui";
import { SECTION_IDS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { cn } from "@/lib/utils/cn";
import { Container, SectionHeading } from "./primitives";
import { Reveal } from "./Reveal";
import { SECTION_SPACE } from "./layout";

export interface FaqSectionProps {
  copy: SiteCopy["faq"];
}

/** Frequently asked questions on native <details> rows (keyboard and screen-reader support from the browser). */
export function FaqSection({ copy }: FaqSectionProps) {
  return (
    <section id={SECTION_IDS.faq} aria-labelledby="faq-title" className={cn("scroll-mt-24", SECTION_SPACE)}>
      <Container className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <SectionHeading id="faq-title" eyebrow={copy.eyebrow} title={copy.title} className="lg:sticky lg:top-28 lg:self-start" />
        <Reveal>
          <Accordion
            exclusive
            items={copy.items.map((item, index) => ({
              id: `faq-${index + 1}`,
              title: item.question,
              content: item.answer,
              defaultOpen: index === 0,
            }))}
          />
        </Reveal>
      </Container>
    </section>
  );
}
