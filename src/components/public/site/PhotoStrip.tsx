import Image from "next/image";
import { HERO_PHOTOS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import { cn } from "@/lib/utils/cn";
import { Container } from "./primitives";

export interface PhotoStripProps {
  copy: Pick<SiteCopy["hero"], "photoAlt">;
}

const OFFSETS = ["lg:mt-12", "lg:mt-0", "lg:mt-16", "lg:mt-4"] as const;
const RATIOS = ["aspect-[4/5]", "aspect-[4/5] lg:aspect-[3/4]", "aspect-[4/5]", "aspect-[4/5] lg:aspect-[3/4]"] as const;

/** A composed strip of hospitality photography under the console: four frames at staggered heights. */
export function PhotoStrip({ copy }: PhotoStripProps) {
  return (
    <section aria-label={copy.photoAlt[0]} className="pt-6 pb-4 sm:pt-10">
      <Container>
        <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4 lg:items-start">
          {HERO_PHOTOS.map((photo, index) => (
            <li key={`${photo.src}-${index}`} className={cn("relative overflow-hidden rounded-[22px] bg-surface-2", RATIOS[index % RATIOS.length], OFFSETS[index % OFFSETS.length])}>
              <Image
                src={photo.src}
                alt={copy.photoAlt[index] ?? ""}
                fill
                sizes="(min-width: 1024px) 25vw, 50vw"
                className="object-cover transition-transform duration-700 ease-out hover:scale-[1.03]"
                style={{ objectPosition: photo.position }}
                draggable={false}
              />
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
