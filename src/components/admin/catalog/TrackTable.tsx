"use client";

import type { MouseEvent } from "react";
import { Archive, ArchiveRestore, FileUp, Music, Pencil, Play, Power, PowerOff, Trash2 } from "lucide-react";
import {
  CoverImage,
  DropdownMenu,
  GenreChip,
  StatusPill,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  VisuallyHidden,
  type DropdownMenuItem,
} from "@/components/ui";
import type { AdminTrack } from "@/lib/api/contracts";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";
import { trackGenres } from "./track-helpers";
import { TRACK_STATE_LABELS, trackState, trackStateTone } from "./track-query";
import type { GenreOption } from "./types";

export type TrackRowIntent = "edit" | "preview";

export interface TrackTableProps {
  tracks: readonly AdminTrack[];
  genres: readonly GenreOption[];
  /** Describes the table for screen readers, e.g. "Tracks: All statuses, newest first". */
  caption: string;
  /** The track open in the "Selected track" editor (highlighted row). */
  selectedTrackId: string | null;
  /** Rows ticked for a bulk action. */
  checkedIds: readonly string[];
  /** Rows with an action in flight (dimmed, menu disabled). */
  busyTrackIds: ReadonlySet<string>;
  onCheckedChange: (trackId: string, checked: boolean) => void;
  onCheckAll: (checked: boolean) => void;
  onOpen: (track: AdminTrack, intent: TrackRowIntent) => void;
  onReplace: (track: AdminTrack) => void;
  onSetActive: (track: AdminTrack, active: boolean) => void;
  onRemove: (track: AdminTrack) => void;
  onRestore: (track: AdminTrack) => void;
  onDelete: (track: AdminTrack) => void;
}

/** Clicks on these never select the row (they have their own meaning). */
const INTERACTIVE = "button, a, input, label, select, textarea, [role='menu'], [role='menuitem'], [popover]";

/**
 * The selection column: the 20px checkbox sits in a label that fills the whole cell (48px wide, the
 * full row or header height), so a tap anywhere in the cell toggles it — a ≥44×44px target — and a
 * near miss never opens the track editor (labels are INTERACTIVE).
 */
const CHECK_CELL = "relative w-12";
const CHECK_LABEL = "absolute inset-0 flex cursor-pointer items-center justify-center";
const CHECKBOX = "size-5 cursor-pointer rounded accent-accent";

/** First genre's artwork (uploaded cover or default), or a neutral tile for a track without a genre. */
export function TrackThumb({ genre, className }: { genre: GenreOption | undefined; className?: string }) {
  if (!genre) {
    return (
      <span
        aria-hidden="true"
        className={cn("flex shrink-0 items-center justify-center rounded-control bg-surface-2 text-fg-muted [&_svg]:size-5", className)}
      >
        <Music />
      </span>
    );
  }
  return <CoverImage src={genre.coverUrl} artworkKey={genre.slug} sizes="56px" className={cn("shrink-0 rounded-control", className)} />;
}

function GenreChips({ genres }: { genres: readonly GenreOption[] }) {
  if (genres.length === 0) {
    return <StatusPill tone="warning" size="sm" label="No genre" title="Tracks without a genre don't play anywhere" />;
  }
  return (
    <>
      {genres.map((genre) => (
        <GenreChip
          key={genre.id}
          genreKey={genre.slug}
          size="sm"
          name={genre.isEnabled ? genre.name : `${genre.name} (inactive)`}
          className={genre.isEnabled ? undefined : "opacity-70"}
        />
      ))}
    </>
  );
}

function TrackStatus({ track, size = "md" }: { track: AdminTrack; size?: "sm" | "md" }) {
  const state = trackState(track);
  return <StatusPill tone={trackStateTone(state)} size={size} label={TRACK_STATE_LABELS[state]} />;
}

/**
 * The library table (screen 05): selection checkbox, first-genre artwork, title + artist, genre chips,
 * duration, status and a "…" menu. It sits in a container query context, so narrow containers (the
 * editor panel beside it, tablets, phones) fold the genres, duration and status into the track cell
 * instead of scrolling sideways; column labels stay with their data.
 */
export function TrackTable({
  tracks,
  genres,
  caption,
  selectedTrackId,
  checkedIds,
  busyTrackIds,
  onCheckedChange,
  onCheckAll,
  onOpen,
  onReplace,
  onSetActive,
  onRemove,
  onRestore,
  onDelete,
}: TrackTableProps) {
  const checked = new Set(checkedIds);
  const checkedCount = tracks.filter((track) => checked.has(track.id)).length;
  const allChecked = tracks.length > 0 && checkedCount === tracks.length;
  const someChecked = checkedCount > 0 && !allChecked;

  function menuItems(track: AdminTrack): DropdownMenuItem[] {
    const state = trackState(track);
    const items: DropdownMenuItem[] = [
      { key: "edit", label: "Edit", icon: Pencil, onSelect: () => onOpen(track, "edit") },
      { key: "preview", label: "Preview", icon: Play, onSelect: () => onOpen(track, "preview") },
      { key: "replace", label: "Replace file", icon: FileUp, onSelect: () => onReplace(track) },
      track.isActive
        ? {
            key: "deactivate",
            label: "Deactivate",
            description: "Keep it, but don't play it",
            icon: PowerOff,
            onSelect: () => onSetActive(track, false),
          }
        : {
            key: "activate",
            label: "Activate",
            description: state === "removed" ? "Takes effect once restored" : "Play it at venues again",
            icon: Power,
            onSelect: () => onSetActive(track, true),
          },
      { type: "separator", key: "separator" },
    ];
    if (state === "removed") {
      items.push(
        { key: "restore", label: "Restore", description: "Back into the catalogue", icon: ArchiveRestore, onSelect: () => onRestore(track) },
        {
          key: "delete",
          label: "Delete permanently",
          description: "Also deletes the audio file",
          icon: Trash2,
          tone: "danger",
          onSelect: () => onDelete(track),
        },
      );
    } else {
      items.push({
        key: "remove",
        label: "Remove from playback",
        description: "Stops it everywhere, even when queued",
        icon: Archive,
        tone: "danger",
        onSelect: () => onRemove(track),
      });
    }
    return items;
  }

  function handleRowClick(event: MouseEvent<HTMLTableRowElement>, track: AdminTrack) {
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    onOpen(track, "edit");
  }

  return (
    <Table caption={caption} wrapperClassName="@container">
      <THead>
        <TR>
          <TH className={CHECK_CELL}>
            <label className={CHECK_LABEL}>
              <input
                type="checkbox"
                aria-label="Select all tracks on this page"
                checked={allChecked}
                ref={(element) => {
                  if (element) element.indeterminate = someChecked;
                }}
                onChange={(event) => onCheckAll(event.currentTarget.checked)}
                disabled={tracks.length === 0}
                className={CHECKBOX}
              />
            </label>
          </TH>
          {/* The widest column: it takes whatever the others leave. */}
          <TH className="w-full">Track</TH>
          <TH className="hidden @xl:table-cell">Genres</TH>
          <TH numeric className="hidden @2xl:table-cell">
            Duration
          </TH>
          <TH className="hidden @lg:table-cell">Status</TH>
          <TH className="w-14 pl-0! pr-3!">
            <VisuallyHidden>Actions</VisuallyHidden>
          </TH>
        </TR>
      </THead>
      <TBody>
        {tracks.map((track) => {
          const assigned = trackGenres(track, genres);
          const selected = track.id === selectedTrackId;
          const busy = busyTrackIds.has(track.id);
          const duration = formatDuration(track.durationSeconds);
          return (
            <TR
              key={track.id}
              selected={selected}
              aria-busy={busy || undefined}
              onClick={(event) => handleRowClick(event, track)}
              className={cn("cursor-pointer", busy && "opacity-60")}
            >
              <TD className={CHECK_CELL}>
                <label className={CHECK_LABEL}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${track.title}`}
                    checked={checked.has(track.id)}
                    onChange={(event) => onCheckedChange(track.id, event.currentTarget.checked)}
                    className={CHECKBOX}
                  />
                </label>
              </TD>
              <TD>
                <div className="flex min-w-0 items-center gap-3 @md:gap-4">
                  <TrackThumb genre={assigned[0]} className="size-12 @md:size-14" />
                  <div className="grid min-w-0 gap-1">
                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      onClick={() => onOpen(track, "edit")}
                      className="min-w-0 justify-self-start truncate rounded-sm text-left font-semibold text-fg underline-offset-4 hover:underline"
                      title={track.title}
                    >
                      <VisuallyHidden>Edit </VisuallyHidden>
                      {track.title}
                    </button>
                    <p className="flex min-w-0 gap-1 text-sm text-fg-muted">
                      <span className="truncate" title={track.artist}>
                        {track.artist}
                      </span>
                      <span className="shrink-0 @2xl:hidden">
                        <span aria-hidden="true">· </span>
                        <VisuallyHidden>, duration </VisuallyHidden>
                        <span className="tabular-nums">{duration}</span>
                      </span>
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 @xl:hidden">
                      <GenreChips genres={assigned} />
                      <span className="@lg:hidden">
                        <TrackStatus track={track} size="sm" />
                      </span>
                    </div>
                  </div>
                </div>
              </TD>
              <TD className="hidden @xl:table-cell">
                <div className="flex max-w-64 flex-wrap gap-1.5">
                  <GenreChips genres={assigned} />
                </div>
              </TD>
              <TD numeric className="hidden text-fg-muted @2xl:table-cell">
                {duration}
              </TD>
              <TD className="hidden @lg:table-cell">
                <TrackStatus track={track} />
              </TD>
              <TD className="w-14 pl-0! pr-3!">
                <DropdownMenu label={`Actions for ${track.title}`} items={menuItems(track)} disabled={busy} />
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
