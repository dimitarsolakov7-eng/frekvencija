import { Plus } from "lucide-react";
import { SECTION_IDS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { Reveal } from "./motion/Reveal";
import { SplitHeading } from "./motion/SplitHeading";
import { Container, SectionLabel } from "./primitives";

export interface FaqProps {
  copy: SiteCopy["faq"];
}

/**
 * Chapter 08: questions on native <details> rows sharing a name (one open at a time, keyboard and
 * screen-reader support from the browser). Rows open smoothly where the browser animates
 * ::details-content, instantly elsewhere.
 */
export function Faq({ copy }: FaqProps) {
  return (
    <section id={SECTION_IDS.faq} aria-labelledby="faq-title" className="relative border-t border-border py-24 sm:py-32 lg:py-36">
      <Container className="grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="grid content-start gap-8 lg:sticky lg:top-28 lg:col-span-4 lg:self-start">
          <SectionLabel index="08">{copy.label}</SectionLabel>
          <SplitHeading id="faq-title" className="display-xl text-fg">
            {copy.title}
          </SplitHeading>
        </div>
        <Reveal items="[data-faq]" stagger={0.06} className="border-t border-border lg:col-span-8">
          {copy.items.map((item, index) => (
            <details key={item.question} name="faq" data-faq="" data-anim="" open={index === 0 || undefined} className="faq-item group border-b border-border">
              <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-6 py-6 text-left [&::-webkit-details-marker]:hidden">
                <span className="text-xl font-semibold tracking-[-0.02em] text-fg transition-colors group-hover:text-accent-text sm:text-2xl">
                  {item.question}
                </span>
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-full border border-border-strong text-fg transition-[transform,background-color,border-color,color] duration-500 ease-expo group-open:rotate-45 group-open:border-accent group-open:bg-accent group-open:text-accent-fg"
                >
                  <Plus className="size-5" />
                </span>
              </summary>
              <p className="max-w-2xl pr-14 pb-8 text-lg leading-relaxed text-fg-muted text-pretty">{item.answer}</p>
            </details>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}
