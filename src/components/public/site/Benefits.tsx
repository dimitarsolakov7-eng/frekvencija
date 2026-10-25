import Image from "next/image";
import { SECTION_IDS, VENUE_TYPES } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { cn } from "@/lib/utils/cn";
import { FrequencyLine } from "./FrequencyLine";
import { Container, Eyebrow, Rule } from "./primitives";
import { Reveal } from "./Reveal";
import { SECTION_SPACE } from "./layout";

export interface BenefitsProps {
  copy: SiteCopy["benefits"];
  /** Alt texts for the four photographs, in order. */
  photoAlts: readonly string[];
}

/**
 * Editorial storytelling: a full-width statement, then four benefits in alternating compositions
 * (photo + text, a full-width text row, photo + text, text + photo) with serif numerals and headlines.
 */
export function Benefits({ copy, photoAlts }: BenefitsProps) {
  const photos = VENUE_TYPES.map((venue) => venue.photo);
  return (
    <section id={SECTION_IDS.benefits} aria-labelledby="benefits-title" className={cn("scroll-mt-24", SECTION_SPACE)}>
      <Container className="grid gap-16 lg:gap-24">
        <Reveal className="grid justify-items-center gap-8 text-center">
          <Eyebrow tick={false}>{copy.eyebrow}</Eyebrow>
          <h2 id="benefits-title" className="display-lg max-w-[20ch] text-fg">
            {copy.statement}
          </h2>
          <FrequencyLine seed={7} amplitude={0.6} className="h-10 w-full max-w-md text-accent-text/60" />
        </Reveal>

        <ol className="grid gap-16 lg:gap-24">
          {copy.items.map((item, index) => {
            const numeral = String(index + 1).padStart(2, "0");
            const photo = photos[index % photos.length];
            const alt = photoAlts[index] ?? "";
            if (index === 1) {
              return (
                <Reveal as="li" key={item.title} className="grid gap-6">
                  <Rule />
                  <div className="grid gap-6 pt-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-12">
                    <div className="flex items-start gap-5">
                      <span aria-hidden="true" className="font-display text-xl text-accent-text tabular-nums">
                        {numeral}
                      </span>
                      <h3 className="display-lg text-fg">{item.title}</h3>
                    </div>
                    <p className="max-w-[48ch] self-end text-lg leading-relaxed text-fg-muted text-pretty lg:pb-2">{item.body}</p>
                  </div>
                </Reveal>
              );
            }
            const reversed = index === 3;
            return (
              <Reveal as="li" key={item.title} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
                <figure className={cn("relative aspect-[5/4] overflow-hidden rounded-[26px] bg-surface-2", reversed && "lg:order-last")}>
                  <Image
                    src={photo.src}
                    alt={alt}
                    fill
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    className="object-cover"
                    style={{ objectPosition: photo.position }}
                    draggable={false}
                  />
                </figure>
                <div className="grid max-w-[52ch] gap-5">
                  <span aria-hidden="true" className="font-display text-xl text-accent-text tabular-nums">
                    {numeral}
                  </span>
                  <h3 className="display-md text-fg">{item.title}</h3>
                  <p className="text-lg leading-relaxed text-fg-muted text-pretty">{item.body}</p>
                </div>
              </Reveal>
            );
          })}
        </ol>
      </Container>
    </section>
  );
}
