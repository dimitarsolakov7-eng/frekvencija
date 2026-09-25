"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import type { Route } from "next";
import { ListMusic, Power, PowerOff, TriangleAlert } from "lucide-react";
import { Alert, Button, ButtonLink, CoverImage, Field, FormMessage, Input, Select, Switch, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/actions/state";
import { slugify } from "@/lib/validation/genres";
import { BusinessPicker } from "./BusinessPicker";
import { describeFieldProblems, focusFirstInvalidField } from "./form-feedback";
import {
  GENRE_AVAILABILITY_LABELS,
  GENRE_DESCRIPTION_MAX,
  GENRE_NAME_MAX,
  genreDraftProblems,
  type GenreAvailability,
  type GenreDraft,
} from "./genre-draft";
import { describeTrackCounts, normalizeSlugInput, slugProblem } from "./genre-helpers";
import type { AdminGenreItem, BusinessOption } from "./types";

export interface GenreEditorProps {
  mode: "create" | "edit";
  /** The genre being edited (edit mode). */
  genre: AdminGenreItem | null;
  businesses: readonly BusinessOption[];
  draft: GenreDraft;
  onDraftChange: (draft: GenreDraft) => void;
  dirty: boolean;
  saving: boolean;
  /** Result of the last failed save; null hides it. */
  error: ActionState | null;
  onSave: () => void;
  onDiscard: () => void;
  /** The cover section (edit mode), rendered above the fields. */
  cover?: ReactNode;
  /** Activate (immediately) or deactivate (after confirmation) the saved genre. */
  onToggleActive: () => void;
  togglingActive?: boolean;
  /** /admin/music?genre=<id>. */
  manageTracksHref: string | null;
  businessesHref?: string;
  nameInputRef?: RefObject<HTMLInputElement | null>;
}

const AVAILABILITIES: GenreAvailability[] = ["all", "selected"];

function isAvailability(value: string): value is GenreAvailability {
  return value === "all" || value === "selected";
}

/**
 * "Edit genre" / "Add genre" form (screen 08 right column; a drawer on small screens): cover, Genre
 * name, Description, Availability (All businesses / Selected businesses with a business picker),
 * Status, Manage tracks, Save changes and Deactivate genre. Nothing is saved until Save changes;
 * deactivating never deletes tracks or audio.
 */
export function GenreEditor({
  mode,
  genre,
  businesses,
  draft,
  onDraftChange,
  dirty,
  saving,
  error,
  onSave,
  onDiscard,
  cover,
  onToggleActive,
  togglingActive = false,
  manageTracksHref,
  businessesHref,
  nameInputRef,
}: GenreEditorProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  // Problems of untouched fields show only after a save attempt. Remount (key) per genre.
  const [attempted, setAttempted] = useState(false);
  // A save refused for invalid fields: what the live region says, and a counter per attempt (it
  // re-announces a repeated message and moves focus to the first invalid field again).
  const [blocked, setBlocked] = useState({ count: 0, message: "" });
  const problems = genreDraftProblems(draft);
  const fieldErrors = error?.fieldErrors ?? {};
  const slugIssue = slugProblem(draft.slug);
  const derivedSlug = slugify(draft.name);
  const creating = mode === "create";
  const nameChanged = !creating && genre !== null && draft.name.trim() !== genre.name;

  // After the render that marks the fields invalid (aria-invalid + the error in aria-describedby).
  useEffect(() => {
    if (blocked.count > 0) focusFirstInvalidField(formRef.current);
  }, [blocked.count]);

  function set<K extends keyof GenreDraft>(key: K, value: GenreDraft[K]) {
    onDraftChange({ ...draft, [key]: value });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (saving) return;
    const summary = describeFieldProblems(
      [
        { label: "Genre name", message: problems.name },
        { label: "Description", message: problems.description },
        { label: "Link name (slug)", message: slugIssue },
      ],
      creating ? "creating the genre" : "saving",
    );
    if (summary) {
      setBlocked((current) => ({ count: current.count + 1, message: summary }));
      return;
    }
    setBlocked((current) => (current.message ? { ...current, message: "" } : current));
    onSave();
  }

  let slugHint: string;
  if (creating) slugHint = draft.slug.trim() ? "Custom link name." : derivedSlug ? `Leave blank to use “${derivedSlug}”.` : "Needed when the name has no letters a–z.";
  else slugHint = draft.slug.trim() ? "The new link name is saved with the genre." : `Leave blank to keep “${genre?.slug ?? ""}”.`;

  return (
    <div className="grid content-start gap-5">
      {creating ? (
        <div className="grid gap-2">
          <CoverImage artworkKey={derivedSlug || "new-genre"} sizes="22rem" className="aspect-[16/9] rounded-card border border-border" />
          <p className="text-sm text-fg-muted">You can add a cover image once the genre is created. Until then it shows default artwork.</p>
        </div>
      ) : (
        cover
      )}

      <form
        ref={formRef}
        id={`${id}form`}
        onSubmit={handleSubmit}
        noValidate
        className="grid gap-4"
        aria-label={creating ? "New genre" : `Details of ${genre?.name ?? "genre"}`}
      >
        <Field label="Genre name" required error={fieldErrors.name ?? (attempted || draft.name ? problems.name : null)}>
          <Input
            ref={nameInputRef}
            name="name"
            value={draft.name}
            onChange={(event) => set("name", event.currentTarget.value)}
            maxLength={GENRE_NAME_MAX}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Description"
          error={fieldErrors.description ?? problems.description}
          hint={`${draft.description.trim().length}/${GENRE_DESCRIPTION_MAX} · Shown to venues when they choose a genre.`}
        >
          <Textarea
            name="description"
            value={draft.description}
            onChange={(event) => set("description", event.currentTarget.value)}
            maxLength={GENRE_DESCRIPTION_MAX}
            rows={3}
          />
        </Field>

        <Field label="Availability" error={fieldErrors.availableToAll}>
          <Select
            name="availability"
            value={draft.availability}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (isAvailability(value)) set("availability", value);
            }}
          >
            {AVAILABILITIES.map((availability) => (
              <option key={availability} value={availability}>
                {GENRE_AVAILABILITY_LABELS[availability]}
              </option>
            ))}
          </Select>
        </Field>

        {draft.availability === "selected" && (
          <div className="grid gap-2">
            <BusinessPicker
              legend="Businesses with access"
              businesses={businesses}
              value={draft.businessIds}
              onChange={(businessIds) => set("businessIds", businessIds)}
              error={fieldErrors.businessIds}
              hint="Only these businesses can choose this genre, and only while they are active."
              businessesHref={businessesHref}
            />
            {businesses.length > 0 && draft.businessIds.length === 0 && (
              <p className="flex items-start gap-1.5 text-sm text-warning">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                No business selected: no venue can choose this genre.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-4 rounded-control border border-border bg-control px-3.5 py-2.5">
          <span id={`${id}status`} className="text-sm font-medium text-fg">
            Status
          </span>
          <span className="flex items-center gap-3">
            <Switch
              aria-labelledby={`${id}status`}
              aria-describedby={`${id}status-text`}
              checked={draft.isEnabled}
              onCheckedChange={(checked) => set("isEnabled", checked)}
            />
            <span id={`${id}status-text`} className="w-16 text-sm text-fg">
              {draft.isEnabled ? "Active" : "Inactive"}
            </span>
          </span>
        </div>

        <details className="group rounded-control border border-border px-3.5 py-2.5 open:pb-4">
          <summary className="cursor-pointer text-sm font-medium text-fg-muted marker:text-fg-muted hover:text-fg">More settings</summary>
          <div className="pt-3">
            <Field label="Link name (slug)" optional error={slugIssue ?? fieldErrors.slug} hint={slugHint}>
              <Input
                name="slug"
                value={draft.slug}
                onChange={(event) => set("slug", normalizeSlugInput(event.currentTarget.value))}
                placeholder={creating ? derivedSlug || "e.g. chill-out" : genre?.slug}
                maxLength={60}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
          </div>
        </details>

        {nameChanged && <p className="text-sm text-fg-muted">Venues see the new name from their next page load.</p>}

        {!creating && genre && (
          <div className="grid gap-2">
            {manageTracksHref && (
              <ButtonLink href={manageTracksHref as Route} variant="secondary" fullWidth icon={<ListMusic aria-hidden="true" />}>
                Manage tracks
              </ButtonLink>
            )}
            <p className="text-center text-sm text-fg-muted">{describeTrackCounts(genre.playableCount, genre.totalCount)}</p>
            {genre.isEnabled && genre.playableCount === 0 && (
              <Alert
                tone="warning"
                title="No playable music"
                description="Venues can choose this genre, but nothing will play until it has active tracks."
              />
            )}
          </div>
        )}

        <FormMessage state={error && !error.ok ? error : null} />
        <p className="sr-only" aria-live="polite">
          {/* A new node per attempt, so the same message is announced again. */}
          <span key={blocked.count}>{blocked.message}</span>
        </p>

        <div className="grid gap-2">
          <Button type="submit" fullWidth loading={saving} loadingText={creating ? "Creating…" : "Saving…"} disabled={!creating && !dirty}>
            {creating ? "Create genre" : "Save changes"}
          </Button>
          <p aria-live="polite" className="min-h-5 text-center text-sm text-fg-muted">
            {dirty ? (
              <>
                {creating ? "Not created yet" : "Unsaved changes"} ·{" "}
                <button
                  type="button"
                  onClick={onDiscard}
                  disabled={saving}
                  className="rounded-sm font-medium text-fg underline-offset-4 hover:underline disabled:opacity-50"
                >
                  {creating ? "Clear" : "Discard"}
                </button>
              </>
            ) : creating ? (
              ""
            ) : (
              "All changes saved"
            )}
          </p>
        </div>
      </form>

      {!creating && genre && (
        <div className="border-t border-border pt-4">
          <Button
            variant="ghost"
            fullWidth
            icon={genre.isEnabled ? <PowerOff aria-hidden="true" /> : <Power aria-hidden="true" />}
            onClick={onToggleActive}
            loading={togglingActive}
            disabled={saving}
          >
            {genre.isEnabled ? "Deactivate genre" : "Activate genre"}
          </Button>
          <p className="mt-1 text-center text-xs text-fg-muted">
            {genre.isEnabled ? "Hides it from venues. Its tracks and audio are kept." : "Venues with access can choose it again."}
          </p>
        </div>
      )}
    </div>
  );
}
