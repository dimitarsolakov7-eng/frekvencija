import { Play } from "lucide-react";
import { EqualizerBars } from "@/components/brand";
import { CoverImage, Spinner } from "@/components/ui";
import type { PlayerGenre } from "@/lib/api/contracts";
import type { PlayerSnapshot } from "@/lib/player/types";
import { cn } from "@/lib/utils/cn";
import { genreCardState, type GenreCardState } from "./player-view";

export interface GenreGridProps {
  genres: readonly PlayerGenre[];
  snapshot: Pick<PlayerSnapshot, "genreId" | "status">;
  /** Card body: select the genre and keep the current paused/playing state. */
  onSelect(genreId: string): void;
  /** "Play {genre}": select and start. Call the engine directly (user gesture). */
  onPlay(genreId: string): void;
  className?: string;
}

const ACTION_BASE = "inline-flex shrink-0 items-center justify-center gap-1.5 transition-colors duration-150 [&_svg]:shrink-0";

/** The round outline "Play {genre}" look (IconButton variant="outline" round, md). */
const ACTION_PLAY =
  "size-11 rounded-full border border-fg/60 text-fg hover:border-accent hover:bg-surface-2 hover:text-accent-text active:bg-surface-3 [&_svg]:size-5";

/** "Loading" / "Playing" read as status text, not as a button to press. */
const ACTION_STATUS = "h-11 cursor-default rounded-full px-2 text-sm font-medium";

/**
 * The card's action control. It is the same <button> in every state — "Play {genre}", then the
 * loading spinner, then "Playing" with the equaliser — so pressing Play never unmounts the element
 * that has keyboard focus. While loading or playing it is aria-disabled with a status label
 * ("Jazz is playing"): it stays focusable, and pressing it again does nothing.
 */
export function GenreCardAction({ card, onPlay }: { card: GenreCardState; onPlay(): void }) {
  if (card.indicator === "none" || card.actionLabel === null) return null;
  const offersPlay = card.indicator === "play";
  return (
    <button
      type="button"
      aria-label={card.actionLabel}
      aria-disabled={offersPlay ? undefined : true}
      title={card.actionLabel}
      onClick={() => {
        if (offersPlay) onPlay();
      }}
      className={cn(
        ACTION_BASE,
        offersPlay ? ACTION_PLAY : ACTION_STATUS,
        card.indicator === "playing" ? "text-accent-text" : card.indicator === "loading" && "text-fg-muted",
      )}
    >
      {card.indicator === "playing" && (
        <>
          <EqualizerBars playing size="sm" />
          <span>Playing</span>
        </>
      )}
      {card.indicator === "loading" && (
        <>
          <Spinner size="sm" decorative />
          <span className="hidden sm:inline">Loading</span>
        </>
      )}
      {offersPlay && <Play aria-hidden="true" fill="currentColor" />}
    </button>
  );
}

/**
 * "Find your atmosphere" (screens 03/04): artwork cards, three columns on desktop and two on
 * tablets and phones. Each card has two distinct controls: the card itself is a toggle button that
 * only selects the genre (aria-pressed; playback keeps its paused/playing state), and a separate
 * labelled "Play {genre}" button selects and starts it. The selected card has the emerald outline;
 * "Playing" with the moving equaliser appears only while that genre is actually playing. Genres
 * without music are disabled with "No tracks yet".
 */
export function GenreGrid({ genres, snapshot, onSelect, onPlay, className }: GenreGridProps) {
  return (
    <ul className={cn("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3", className)}>
      {genres.map((genre) => {
        const card = genreCardState(genre, snapshot);
        const descriptionId = `genre-${genre.id}-description`;
        return (
          <li
            key={genre.id}
            className={cn(
              "relative flex flex-col overflow-hidden rounded-card border bg-surface shadow-card transition-colors",
              card.selected ? "border-accent ring-1 ring-accent/50 ring-inset" : "border-border hover:border-border-strong",
              !card.selectable && "opacity-60",
            )}
          >
            <CoverImage
              src={genre.coverUrl}
              artworkKey={genre.slug}
              sizes="(max-width: 1024px) 50vw, 33vw"
              className="aspect-[5/2] shrink-0 sm:aspect-[3/1] lg:aspect-[4/1]"
            />
            <div className="flex flex-1 items-center gap-2 p-3 sm:gap-3 sm:p-4">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <h3 className="text-[0.9375rem] leading-snug font-semibold text-fg sm:text-base">
                  <button
                    type="button"
                    aria-pressed={card.selected}
                    aria-label={`Select ${genre.name}`}
                    aria-describedby={descriptionId}
                    disabled={!card.selectable}
                    onClick={() => onSelect(genre.id)}
                    className={cn(
                      // The pseudo-element stretches the button over the whole card (image included).
                      "text-left after:absolute after:inset-0 after:rounded-card after:content-['']",
                      "focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring",
                      card.selectable ? "cursor-pointer" : "cursor-not-allowed",
                    )}
                  >
                    {genre.name}
                  </button>
                </h3>
                <p id={descriptionId} className="grid gap-0.5 text-xs text-fg-muted sm:text-sm">
                  {genre.description && <span className="line-clamp-2 text-pretty">{genre.description}</span>}
                  <span className={card.empty ? "text-warning" : "text-fg-subtle"}>
                    {card.meta}
                    {card.selected && card.indicator !== "playing" && <span className="sr-only">, selected</span>}
                  </span>
                </p>
              </div>

              <div className="relative z-10 flex shrink-0 items-center">
                <GenreCardAction card={card} onPlay={() => onPlay(genre.id)} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
