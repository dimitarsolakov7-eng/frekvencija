import { ChevronDown, Megaphone } from "lucide-react";
import { Card, CoverImage } from "@/components/ui";
import type { PlayerGenre } from "@/lib/api/contracts";
import type { UpcomingTrack } from "@/lib/player/types";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";

export interface ComingUpCardProps {
  /** snapshot.upcoming: the next shuffle picks (read-only, at most 3). */
  upcoming: readonly UpcomingTrack[];
  genre: PlayerGenre | null;
  /** Shown when the list is empty (see comingUpEmptyText). */
  emptyText: string;
  /** "Station voice after N more songs", or null. */
  voiceNote: string | null;
  className?: string;
}

function VoiceNote({ note, className }: { note: string; className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-accent-text sm:text-sm", className)}>
      <Megaphone aria-hidden="true" className="size-4 shrink-0" />
      {note}
    </p>
  );
}

function UpcomingList({ upcoming, genre, emptyText }: Pick<ComingUpCardProps, "upcoming" | "genre" | "emptyText">) {
  if (upcoming.length === 0) return <p className="text-sm text-fg-muted text-pretty">{emptyText}</p>;
  return (
    <ol className="grid">
      {upcoming.map((track, index) => (
        <li key={track.id} className="flex min-h-10 items-center gap-3 border-t border-border py-1.5 first:border-t-0 first:pt-0">
          <span aria-hidden="true" className="w-4 shrink-0 text-center text-sm text-fg-muted tabular-nums">
            {index + 1}
          </span>
          <CoverImage src={genre?.coverUrl} artworkKey={genre?.slug ?? null} sizes="28px" className="size-7 shrink-0 rounded-md" />
          <p className="min-w-0 flex-1 truncate text-sm sm:text-[0.9375rem]">
            <span className="font-medium text-fg">{track.title}</span>
            <span className="text-fg-muted"> · {track.artist}</span>
          </p>
          <span className="shrink-0 text-sm text-fg-muted tabular-nums">
            <span className="sr-only">Length </span>
            {formatDuration(track.durationSeconds)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * "Coming up": the next songs the shuffle will play in this genre, read-only (no reordering or
 * picking), plus when the station voice is next heard. On phones it collapses into a disclosure
 * to keep the genre grid close to the top.
 */
export function ComingUpCard({ className, voiceNote, ...list }: ComingUpCardProps) {
  const count = list.upcoming.length;
  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <details className="group md:hidden">
        <summary className="-m-1 flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-control p-1 [&::-webkit-details-marker]:hidden">
          <span className="text-base font-bold tracking-tight text-fg">
            Coming up{count > 0 && <span className="font-normal text-fg-muted"> · {count} {count === 1 ? "song" : "songs"}</span>}
          </span>
          <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-fg-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-3 pt-3">
          <UpcomingList {...list} />
          {voiceNote && <VoiceNote note={voiceNote} />}
        </div>
      </details>
      <section aria-labelledby="coming-up-title" className="hidden gap-3 md:grid">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 id="coming-up-title" className="text-base font-bold tracking-tight text-fg sm:text-lg">
            Coming up
          </h2>
          {voiceNote && <VoiceNote note={voiceNote} />}
        </div>
        <UpcomingList {...list} />
      </section>
    </Card>
  );
}
