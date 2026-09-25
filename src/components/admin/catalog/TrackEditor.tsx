"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import type { Route } from "next";
import Link from "next/link";
import { FileUp, Play, RotateCcw, Square, TriangleAlert } from "lucide-react";
import {
  Alert,
  Button,
  Checkbox,
  CoverImage,
  Field,
  FormMessage,
  GenreDot,
  Input,
  StatusPill,
} from "@/components/ui";
import type { ActionState } from "@/lib/actions/state";
import type { AdminTrack } from "@/lib/api/contracts";
import { cn } from "@/lib/utils/cn";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/utils/format";
import { UNKNOWN_ARTIST } from "@/lib/validation/tracks";
import { describeFieldProblems, focusFirstInvalidField } from "./form-feedback";
import { toggleGenre, TRACK_TEXT_MAX, trackDraftProblems, type TrackDraft } from "./track-helpers";
import { TRACK_STATE_LABELS, trackState, trackStateTone } from "./track-query";
import type { GenreOption } from "./types";

/** The single admin audio preview (one at a time, for the selected track). */
export type TrackPreviewState =
  | { status: "loading"; trackId: string }
  | { status: "ready"; trackId: string; url: string }
  | { status: "error"; trackId: string; message: string };

export interface TrackEditorProps {
  track: AdminTrack;
  genres: readonly GenreOption[];
  draft: TrackDraft;
  onDraftChange: (draft: TrackDraft) => void;
  dirty: boolean;
  saving: boolean;
  /** Result of the last failed save (field errors + message); null hides it. */
  error: ActionState | null;
  onSave: () => void;
  /** Throws away unsaved edits. */
  onDiscard: () => void;
  onReplace: () => void;
  preview: TrackPreviewState | null;
  onPreview: () => void;
  onStopPreview: () => void;
  onPreviewFailed: () => void;
  /**
   * Whether this copy of the editor may hold the <audio> element. The desktop panel and the mobile
   * drawer render the same editor, but only the visible one may play, so audio never doubles up.
   */
  allowAudio: boolean;
  /** Shown when the track is not part of the current list (e.g. filtered out while being edited). */
  notListed?: boolean;
  titleInputRef?: RefObject<HTMLInputElement | null>;
  /** Link for "Create a genre" when the catalogue has none. */
  genresHref: string;
  className?: string;
}

/**
 * "Selected track" editor (screen 05 right column; the mobile drawer shows the same form): artwork of
 * the first genre, Title, Artist, Genres (multiple), a preview player, Replace file and Save changes.
 * Nothing is saved until Save changes.
 */
export function TrackEditor({
  track,
  genres,
  draft,
  onDraftChange,
  dirty,
  saving,
  error,
  onSave,
  onDiscard,
  onReplace,
  preview,
  onPreview,
  onStopPreview,
  onPreviewFailed,
  allowAudio,
  notListed = false,
  titleInputRef,
  genresHref,
  className,
}: TrackEditorProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  // A save refused for invalid fields: the live-region text (for the track it was about) and a
  // counter per attempt, which re-announces a repeated message and moves focus again.
  const [blocked, setBlocked] = useState<{ count: number; trackId: string | null; message: string }>({
    count: 0,
    trackId: null,
    message: "",
  });
  const problems = trackDraftProblems(draft);
  const firstGenre = genres.find((genre) => draft.genreIds.includes(genre.id));
  const state = trackState(track);
  const trackPreview = preview?.trackId === track.id ? preview : null;
  const fieldErrors = error?.fieldErrors ?? {};
  const blockedMessage = blocked.trackId === track.id ? blocked.message : "";

  // The title and artist errors are already shown (aria-invalid + aria-describedby) while typing.
  useEffect(() => {
    if (blocked.count > 0) focusFirstInvalidField(formRef.current);
  }, [blocked.count]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const summary = describeFieldProblems([
      { label: "Title", message: problems.title },
      { label: "Artist", message: problems.artist },
    ]);
    if (summary) {
      setBlocked((current) => ({ count: current.count + 1, trackId: track.id, message: summary }));
      return;
    }
    setBlocked((current) => (current.message ? { ...current, message: "" } : current));
    onSave();
  }

  return (
    <div className={cn("grid content-start gap-5", className)}>
      <CoverImage
        src={firstGenre?.coverUrl}
        artworkKey={firstGenre?.slug ?? null}
        sizes="(min-width: 1280px) 22rem, (min-width: 1024px) 18rem, 100vw"
        className="aspect-[4/3] rounded-card border border-border"
      >
        <div className="absolute top-3 left-3">
          <StatusPill tone={trackStateTone(state)} size="sm" label={TRACK_STATE_LABELS[state]} className="bg-canvas/80! backdrop-blur-sm" />
        </div>
      </CoverImage>

      {notListed && (
        <Alert
          tone="info"
          title="Not in the current list"
          description="This track doesn't match the current filters, but your unsaved changes are kept here."
        />
      )}

      <section aria-label="Preview" className="grid gap-2">
        {trackPreview?.status === "ready" && allowAudio ? (
          <div className="grid gap-2">
            <audio
              key={trackPreview.url}
              src={trackPreview.url}
              controls
              autoPlay
              preload="auto"
              aria-label={`Preview of ${track.title}`}
              className="h-10 w-full"
              onError={onPreviewFailed}
            />
            <Button variant="ghost" size="sm" icon={<Square aria-hidden="true" />} onClick={onStopPreview} className="justify-self-start">
              Stop preview
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            fullWidth
            icon={<Play aria-hidden="true" />}
            loading={trackPreview?.status === "loading"}
            loadingText="Loading preview…"
            onClick={onPreview}
            aria-label={`Preview ${track.title}`}
          >
            Preview
          </Button>
        )}
        {trackPreview?.status === "error" && (
          <Alert
            tone="danger"
            title="The preview couldn’t be played"
            description={trackPreview.message}
            action={
              <Button variant="secondary" size="sm" icon={<RotateCcw aria-hidden="true" />} onClick={onPreview}>
                Try again
              </Button>
            }
          />
        )}
      </section>

      <form ref={formRef} id={`${id}form`} onSubmit={handleSubmit} noValidate className="grid gap-4" aria-label={`Details of ${track.title}`}>
        <Field label="Title" required error={fieldErrors.title ?? problems.title}>
          <Input
            ref={titleInputRef}
            name="title"
            value={draft.title}
            onChange={(event) => onDraftChange({ ...draft, title: event.currentTarget.value })}
            maxLength={TRACK_TEXT_MAX}
            autoComplete="off"
          />
        </Field>
        <Field label="Artist" error={fieldErrors.artist ?? problems.artist} hint={`Leave blank for “${UNKNOWN_ARTIST}”.`}>
          <Input
            name="artist"
            value={draft.artist}
            onChange={(event) => onDraftChange({ ...draft, artist: event.currentTarget.value })}
            maxLength={TRACK_TEXT_MAX}
            autoComplete="off"
          />
        </Field>

        <fieldset className="grid min-w-0 gap-2" aria-describedby={`${id}genres-hint`}>
          <legend className="mb-1.5 text-sm font-medium text-fg">Genres</legend>
          <p id={`${id}genres-hint`} className="-mt-1 text-sm text-fg-muted">
            Venues hear the track in every genre ticked here.
          </p>
          {genres.length === 0 ? (
            <p className="rounded-control border border-dashed border-border-strong px-3 py-3 text-sm text-fg-muted">
              No genres yet.{" "}
              <Link href={genresHref as Route} className="font-medium text-accent-text underline-offset-4 hover:underline">
                Create a genre
              </Link>{" "}
              first.
            </p>
          ) : (
            <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2", genres.length > 8 && "max-h-72 overflow-y-auto p-0.5")}>
              {genres.map((genre) => (
                <Checkbox
                  key={genre.id}
                  variant="tile"
                  checked={draft.genreIds.includes(genre.id)}
                  onChange={(event) => onDraftChange({ ...draft, genreIds: toggleGenre(draft.genreIds, genre.id, event.currentTarget.checked, genres) })}
                  label={
                    <span className="flex min-w-0 items-center gap-2">
                      <GenreDot genreKey={genre.slug} />
                      <span className="truncate">{genre.name}</span>
                      {!genre.isEnabled && <span className="shrink-0 text-xs font-normal text-fg-muted">(inactive)</span>}
                    </span>
                  }
                />
              ))}
            </div>
          )}
          {fieldErrors.genreIds && <p className="text-sm text-danger">{fieldErrors.genreIds}</p>}
          {genres.length > 0 && draft.genreIds.length === 0 && (
            <p className="flex items-start gap-1.5 text-sm text-warning">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Without a genre this track won’t play anywhere.
            </p>
          )}
        </fieldset>

        <FormMessage state={error && !error.ok ? error : null} />
        <p className="sr-only" aria-live="polite">
          {/* A new node per attempt, so the same message is announced again. */}
          <span key={blocked.count}>{blockedMessage}</span>
        </p>

        <div className="grid gap-2 border-t border-border pt-4">
          <Button type="submit" fullWidth loading={saving} loadingText="Saving…" disabled={!dirty}>
            Save changes
          </Button>
          <p aria-live="polite" className="min-h-5 text-center text-sm text-fg-muted">
            {dirty ? (
              <>
                Unsaved changes ·{" "}
                <button
                  type="button"
                  onClick={onDiscard}
                  disabled={saving}
                  className="rounded-sm font-medium text-fg underline-offset-4 hover:underline disabled:opacity-50"
                >
                  Discard
                </button>
              </>
            ) : (
              "All changes saved"
            )}
          </p>
        </div>
      </form>

      <div className="grid gap-3 border-t border-border pt-4">
        <Button variant="outline" fullWidth icon={<FileUp aria-hidden="true" />} onClick={onReplace}>
          Replace file
        </Button>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-fg-muted">File</dt>
          <dd className="truncate text-fg" title={track.originalFilename ?? undefined}>
            {track.originalFilename ?? "Unknown file name"}
          </dd>
          <dt className="text-fg-muted">Length</dt>
          <dd className="text-fg tabular-nums">{formatDuration(track.durationSeconds)}</dd>
          <dt className="text-fg-muted">Size</dt>
          <dd className="text-fg tabular-nums">
            {formatBytes(track.fileSizeBytes)}
            {track.bitrateKbps ? ` · ${track.bitrateKbps} kbps` : ""}
          </dd>
          <dt className="text-fg-muted">Added</dt>
          <dd className="text-fg">
            <time dateTime={track.createdAt}>{formatDateTime(track.createdAt, { dateOnly: true })}</time>
          </dd>
        </dl>
      </div>
    </div>
  );
}
