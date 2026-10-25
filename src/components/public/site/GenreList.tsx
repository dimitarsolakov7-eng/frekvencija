import { CoverImage } from "@/components/ui";
import { DEMO_AUDIO } from "@/config/demo-audio";
import { SECTION_IDS } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { PublicGenre } from "@/lib/data/public";
import { fill } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils/cn";
import { Container, SectionHeading } from "./primitives";
import { Reveal } from "./Reveal";
import { SamplePlayButton } from "./SamplePlayButton";
import { SECTION_SPACE } from "./layout";

export interface GenreListProps {
  copy: SiteCopy["genres"];
  genres: readonly PublicGenre[];
}

/** The short atmosphere line of a genre: the website's own text for known genres, else the catalogue's, else a fallback. */
export function genreDescription(genre: Pick<PublicGenre, "slug" | "description">, copy: Pick<SiteCopy["genres"], "descriptions" | "fallbackDescription">): string {
  return copy.descriptions[genre.slug.toLowerCase()] ?? genre.description ?? copy.fallbackDescription;
}

/**
 * Genres as typeset rows — serif name, atmosphere line, artwork — divided by thin rules, like
 * browsing a curated collection. The list is the live catalogue (enabled genres offered to every
 * venue), so it never promises a genre that does not exist. A preview button appears only for
 * genres with a configured demo clip.
 */
export function GenreList({ copy, genres }: GenreListProps) {
  return (
    <section id={SECTION_IDS.genres} aria-labelledby="genres-title" className={cn("scroll-mt-24", SECTION_SPACE)}>
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div className="grid content-start gap-6 lg:sticky lg:top-28 lg:self-start">
          <SectionHeading id="genres-title" eyebrow={copy.eyebrow} title={copy.title} lead={copy.lead} />
          <p className="text-sm text-fg-subtle">{copy.sourceNote}</p>
        </div>
        <Reveal as="ol" className="border-t border-border">
          {genres.map((genre, index) => {
            const clip = DEMO_AUDIO.genrePreviews[genre.slug] ?? null;
            return (
              <li key={genre.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-border py-5 sm:gap-6 sm:py-6">
                <span aria-hidden="true" className="w-8 font-display text-base text-accent-text tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="grid min-w-0 gap-1.5">
                  <h3 className="display-sm text-fg">{genre.name}</h3>
                  <p className="text-base text-fg-muted text-pretty">{genreDescription(genre, copy)}</p>
                  {clip && (
                    <SamplePlayButton
                      id={`genre:${genre.slug}`}
                      clip={clip}
                      label={fill(copy.preview, { genre: genre.name })}
                      stopLabel={fill(copy.preview, { genre: genre.name })}
                      unavailableLabel=""
                      className="mt-2 w-fit"
                    />
                  )}
                </div>
                <CoverImage
                  src={genre.artworkUrl}
                  artworkKey={genre.slug}
                  sizes="96px"
                  className="size-16 rounded-2xl sm:size-24 sm:rounded-[20px]"
                />
              </li>
            );
          })}
        </Reveal>
      </Container>
    </section>
  );
}
