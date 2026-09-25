"use client";

import { useId, type Ref } from "react";
import { CircleAlert, CircleCheck, FileAudio, Music, Plus, RotateCcw, X } from "lucide-react";
import { Button, Card, FileDropzone, GenreDot, IconButton } from "@/components/ui";
import type { AdminTrack } from "@/lib/api/contracts";
import { isActivePhase, isCancellable, type UploadQueueItem } from "@/lib/uploads/queue";
import { cn } from "@/lib/utils/cn";
import { AUDIO_ACCEPT, checkUploadFile, MAX_TRACK_BYTES } from "@/lib/validation/limits";
import { describeUploadPhase, toggleGenre, uploadFileMeta, uploadPercent } from "./track-helpers";
import type { GenreOption } from "./types";

export const UPLOAD_HINT = "Add music whenever you like. No website update needed.";

export interface UploadQueuePanelProps {
  items: readonly UploadQueueItem[];
  /** `compact`: the panel under the library (screen 05). `full`: the Uploads tab, with a drop zone. */
  variant: "compact" | "full";
  genres: readonly GenreOption[];
  /** Genres new uploads are added to (applied when files are added). */
  uploadGenreIds: readonly string[];
  onUploadGenreIdsChange: (genreIds: string[]) => void;
  /** Opens the file picker. */
  onChooseFiles: () => void;
  /** Files dropped on (or picked from) the drop zone of the full variant. */
  onFiles: (files: File[]) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onClearFinished: () => void;
  /** Opens a finished upload in the track editor. */
  onOpenUploaded: (track: AdminTrack) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  className?: string;
}

function uploadedTrack(item: UploadQueueItem): AdminTrack | null {
  return item.result && (item.result.kind === "track" || item.result.kind === "track-replace") ? item.result.track : null;
}

/**
 * "Upload queue" (screen 05 bottom panel, and the Uploads tab): one row per file with its type and
 * size, a progress bar with percentage, the phase, and Cancel / Retry / Remove. Transfers can be
 * cancelled until the file is stored; the server then checks it and adds it to the library.
 */
export function UploadQueuePanel({
  items,
  variant,
  genres,
  uploadGenreIds,
  onUploadGenreIdsChange,
  onChooseFiles,
  onFiles,
  onCancel,
  onRetry,
  onRemove,
  onClearFinished,
  onOpenUploaded,
  headingRef,
  className,
}: UploadQueuePanelProps) {
  const headingId = `upload-queue-heading-${variant}`;
  const active = items.filter((item) => item.phase === "queued" || isActivePhase(item.phase)).length;
  const failed = items.filter((item) => item.phase === "error").length;
  const done = items.filter((item) => item.phase === "done").length;
  const finished = items.filter((item) => item.phase === "done" || item.phase === "cancelled").length;
  const summary = [
    active > 0 ? `${active} in progress` : null,
    done > 0 ? `${done} added` : null,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className={cn("grid gap-5 p-4 sm:p-6", className)} role="region" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="section-title font-bold text-fg focus:outline-none">
            Upload queue
          </h2>
          <p className="text-sm text-fg-muted">{UPLOAD_HINT}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-fg-muted" aria-live="polite">
            {summary}
          </p>
          {finished > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearFinished}>
              Clear finished
            </Button>
          )}
          {variant === "compact" && (
            <Button variant="secondary" size="sm" icon={<Plus aria-hidden="true" />} onClick={onChooseFiles}>
              Add files
            </Button>
          )}
        </div>
      </div>

      {variant === "full" && (
        <FileDropzone
          label="Choose MP3 files"
          description="or drag and drop them here"
          hint="MP3 audio"
          accept={AUDIO_ACCEPT}
          multiple
          maxSizeBytes={MAX_TRACK_BYTES}
          icon={<FileAudio />}
          onFiles={onFiles}
        />
      )}

      <UploadGenrePicker genres={genres} value={uploadGenreIds} onChange={onUploadGenreIdsChange} />

      {items.length === 0 ? (
        <p className="rounded-control border border-dashed border-border-strong px-4 py-4 text-sm text-fg-muted">
          No uploads yet. Choose MP3 files with “Upload music”; each file is checked on the server and appears in the library
          as soon as it is ready. Only upload music you are licensed to play in venues.
        </p>
      ) : (
        <ul className="grid gap-3" aria-label="Files">
          {items.map((item) => (
            <UploadRow
              key={item.id}
              item={item}
              onCancel={() => onCancel(item.id)}
              onRetry={() => onRetry(item.id)}
              onRemove={() => onRemove(item.id)}
              onOpen={onOpenUploaded}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

interface UploadGenrePickerProps {
  genres: readonly GenreOption[];
  value: readonly string[];
  onChange: (genreIds: string[]) => void;
}

/** Toggle chips choosing the genres new uploads go into (none ⇒ assign later in the editor). */
function UploadGenrePicker({ genres, value, onChange }: UploadGenrePickerProps) {
  const id = useId();
  if (genres.length === 0) return null;
  const selected = new Set(value);
  return (
    <div className="grid gap-2">
      <p id={`${id}label`} className="text-sm font-medium text-fg">
        Add new uploads to
      </p>
      <div role="group" aria-labelledby={`${id}label`} aria-describedby={`${id}hint`} className="flex flex-wrap gap-2">
        {genres.map((genre) => {
          const on = selected.has(genre.id);
          return (
            <button
              key={genre.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(toggleGenre(value, genre.id, !on, genres))}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors",
                on ? "border-accent/60 bg-accent/15 text-fg" : "border-border bg-control text-fg-muted hover:border-border-strong hover:text-fg",
              )}
            >
              <GenreDot genreKey={genre.slug} />
              {genre.name}
            </button>
          );
        })}
      </div>
      <p id={`${id}hint`} className="text-xs text-fg-muted">
        {value.length === 0
          ? "No genre chosen: new tracks won’t play anywhere until you give them one in the editor."
          : "Applied to files as you add them. Change it between batches."}
      </p>
    </div>
  );
}

interface UploadRowProps {
  item: UploadQueueItem;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onOpen: (track: AdminTrack) => void;
}

function RowIcon({ phase }: { phase: UploadQueueItem["phase"] }) {
  if (phase === "done") return <CircleCheck className="text-accent-text" />;
  if (phase === "error") return <CircleAlert className="text-danger" />;
  return <Music className="text-fg" />;
}

function UploadRow({ item, onCancel, onRetry, onRemove, onOpen }: UploadRowProps) {
  const percent = uploadPercent(item);
  const inFlight = isActivePhase(item.phase);
  const indeterminate = item.phase === "signing" || item.phase === "validating" || item.phase === "queued";
  const track = uploadedTrack(item);
  const phaseText = item.phase === "done" && track ? `Added as “${track.title}”` : describeUploadPhase(item.phase);
  // A file the browser already refused (wrong type, too large) fails the same way on every retry.
  const retryable =
    item.phase === "cancelled" || (item.phase === "error" && checkUploadFile(item.kind, { name: item.name, size: item.size, type: "" }).ok);

  return (
    <li className="grid gap-2 rounded-card border border-border bg-control p-3 sm:p-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-4 md:grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)_auto]">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-2 [&_svg]:size-5">
          <RowIcon phase={item.phase} />
        </span>
        <div className="grid min-w-0">
          <p className="truncate text-sm font-semibold text-fg" title={item.name}>
            {item.name}
          </p>
          <p className="truncate text-xs text-fg-muted">{uploadFileMeta(item)}</p>
        </div>

        <div className="col-span-3 row-start-2 flex min-w-0 items-center gap-3 md:col-span-1 md:row-start-auto">
          <div
            role="progressbar"
            aria-label={`${item.name}: ${phaseText}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            aria-valuetext={percent === null ? phaseText : `${percent}%`}
            className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3"
          >
            {percent !== null ? (
              <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
            ) : indeterminate && item.phase !== "queued" ? (
              <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-accent motion-safe:animate-progress-indeterminate motion-reduce:w-full motion-reduce:opacity-40" />
            ) : item.phase === "error" ? (
              <div className="h-full w-full rounded-full bg-danger/60" />
            ) : null}
          </div>
          <span aria-hidden="true" className="w-10 shrink-0 text-right text-sm text-fg tabular-nums">
            {percent !== null ? `${percent}%` : ""}
          </span>
          <span className={cn("hidden w-40 shrink-0 truncate text-sm sm:block", item.phase === "error" ? "text-danger" : "text-fg-muted")}>
            {phaseText}
          </span>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          {inFlight && isCancellable(item.phase) && (
            <Button variant="outline" size="sm" onClick={onCancel} aria-label={`Cancel upload of ${item.name}`}>
              Cancel
            </Button>
          )}
          {retryable && (
            <Button variant="outline" size="sm" icon={<RotateCcw aria-hidden="true" />} onClick={onRetry} aria-label={`Retry ${item.name}`}>
              Retry
            </Button>
          )}
          {item.phase === "done" && track && (
            <Button variant="secondary" size="sm" onClick={() => onOpen(track)} aria-label={`Edit ${track.title}`}>
              Edit
            </Button>
          )}
          {item.phase === "queued" && (
            <Button variant="outline" size="sm" onClick={onRemove} aria-label={`Remove ${item.name} from the queue`}>
              Remove
            </Button>
          )}
          {!inFlight && item.phase !== "queued" && (
            <IconButton size="sm" icon={<X />} onClick={onRemove} aria-label={`Remove ${item.name} from the list`} />
          )}
        </div>
      </div>
      <p className={cn("text-sm sm:hidden", item.phase === "error" ? "text-danger" : "text-fg-muted")}>{phaseText}</p>
      {item.phase === "validating" && (
        <p className="text-xs text-fg-muted">The file is stored and being checked; this step can’t be cancelled.</p>
      )}
      {item.error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {item.error}
        </p>
      )}
    </li>
  );
}
