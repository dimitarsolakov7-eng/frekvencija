"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { CoverImage } from "@/components/ui";
import type { PublicGenre } from "@/lib/data/public";
import { cn } from "@/lib/utils/cn";
import { PUBLIC_CONTAINER, SECTION_TITLE_CLASSES } from "./layout";

/** Genres shown before "Explore all genres" is pressed: three photo cards and three compact cards. */
export const INITIAL_GENRE_COUNT = 6;
const FEATURED_COUNT = 3;

/**
 * Round play affordance. Public visitors cannot listen here (the catalogue is private), so it opens
 * the sign-in page; the accessible name says so. Signed-in visitors are sent on to their own area.
 */
function PlayLink({ genreName, className }: { genreName: string; className?: string }) {
  return (
    <Link
      href="/login"
      aria-label={`Log in to play ${genreName}`}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full border border-fg/70 text-fg transition-colors",
        "hover:border-accent hover:bg-accent hover:text-accent-fg",
        className,
      )}
    >
      <Play aria-hidden="true" className="ml-0.5 size-4 fill-current" />
    </Link>
  );
}

function FeaturedGenreCard({ genre }: { genre: PublicGenre }) {
  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
      {/* Owner covers are short-lived signed URLs (shown as-is); a broken one falls back to the default artwork. */}
      <CoverImage
        src={genre.artworkUrl}
        artworkKey={genre.slug}
        sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
        className="aspect-[16/7]"
      />
      <div className="flex flex-1 items-center gap-4 px-5 py-4">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h3 className="truncate text-lg font-semibold text-fg">{genre.name}</h3>
          {genre.description && <p className="line-clamp-2 text-sm text-fg-muted">{genre.description}</p>}
        </div>
        <PlayLink genreName={genre.name} />
      </div>
    </li>
  );
}

function CompactGenreCard({ genre }: { genre: PublicGenre }) {
  return (
    <li className="flex min-h-20 items-stretch overflow-hidden rounded-card border border-border bg-surface">
      <CoverImage src={genre.artworkUrl} artworkKey={genre.slug} sizes="112px" className="w-24 shrink-0 sm:w-28" />
      <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h3 className="truncate font-semibold text-fg">{genre.name}</h3>
          {genre.description && <p className="line-clamp-2 text-sm text-fg-muted">{genre.description}</p>}
        </div>
        <PlayLink genreName={genre.name} />
      </div>
    </li>
  );
}

export interface GenreCollectionProps {
  genres: readonly PublicGenre[];
}

/**
 * "A sound for every space." — the public genre collection (target of the header's "Genres" link).
 * Shows names, descriptions and artwork only; the music itself stays behind sign-in.
 */
export function GenreCollection({ genres }: GenreCollectionProps) {
  const [expanded, setExpanded] = useState(false);
  const moreId = useId();
  const featured = genres.slice(0, FEATURED_COUNT);
  const compact = genres.slice(FEATURED_COUNT, INITIAL_GENRE_COUNT);
  const more = genres.slice(INITIAL_GENRE_COUNT);

  return (
    <section id="genres" aria-labelledby="genres-title" className="scroll-mt-4 pb-16 sm:pb-20">
      <div className={PUBLIC_CONTAINER}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <h2 id="genres-title" className={SECTION_TITLE_CLASSES}>
            A sound for every space.
          </h2>
          {more.length > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={moreId}
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex h-11 items-center gap-2 rounded-control px-1 text-sm font-medium text-accent-text transition-colors hover:text-accent-hover"
            >
              {expanded ? "Show fewer genres" : "Explore all genres"}
              <ArrowRight aria-hidden="true" className={cn("size-4 transition-transform", expanded && "rotate-90")} />
            </button>
          )}
        </div>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((genre) => (
            <FeaturedGenreCard key={genre.key} genre={genre} />
          ))}
        </ul>
        {compact.length > 0 && (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {compact.map((genre) => (
              <CompactGenreCard key={genre.key} genre={genre} />
            ))}
          </ul>
        )}
        {more.length > 0 && (
          <ul id={moreId} hidden={!expanded} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {more.map((genre) => (
              <CompactGenreCard key={genre.key} genre={genre} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
