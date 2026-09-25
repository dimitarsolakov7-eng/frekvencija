"use client";

import { startTransition, useActionState, useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, KeyRound, Megaphone, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import { useUnsavedChangesGuard } from "@/components/admin/shell/unsaved-changes";
import { Alert, Button, ButtonLink, ConfirmDialog, Field, FormMessage, Input, Select, useToast } from "@/components/ui";
import type { AdminBusinessRecord, GenreAccessOption } from "@/lib/data/admin/businesses";
import { cn } from "@/lib/utils/cn";
import { IDLE_STATE, type BusinessDetailActions, type BusinessProfileState } from "./action-types";
import { useBusinessDialogs } from "./BusinessActionDialogs";
import {
  BUSINESS_FIELD_MAX_LENGTH,
  BUSINESS_TYPE_OPTIONS,
  brandingDiffers,
  lastFormString,
  suggestStationName,
  type BrandingValues,
} from "./business-form";
import type { BusinessStatusView } from "./business-status";
import { useFocusAfterFailure, useRestoreFocusAfterPending } from "./form-focus";
import { GenreAccessTiles } from "./GenreAccessTiles";
import { LanguageField } from "./LanguageField";
import {
  isProfileDirty,
  joinGenreIds,
  markProfileSaved,
  newProfileDraft,
  PROFILE_FIELD_LABELS,
  profileValuesFromForm,
  profileValuesOf,
  rebaseProfileDraft,
  sameProfileValues,
  setProfileValue,
  splitGenreIds,
  takeSavedValuesForConflicts,
  type ProfileField,
} from "./profile-draft";

export interface BusinessProfileFormProps {
  business: AdminBusinessRecord;
  genres: readonly GenreAccessOption[];
  status: BusinessStatusView;
  /** Every announcement of the venue (all are marked for review on a branding change). */
  announcementCount: number;
  memberCount: number;
  memberEmails: readonly string[];
  saveBusinessProfile: BusinessDetailActions["saveBusinessProfile"];
  genresHref: string;
  announcementsHref: string;
}

const INITIAL_STATE: BusinessProfileState = { ...IDLE_STATE };

function brandingOf(business: AdminBusinessRecord): BrandingValues {
  return {
    name: business.name,
    stationName: business.stationName,
    namePronunciation: business.namePronunciation,
    stationNamePronunciation: business.stationNamePronunciation,
  };
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={cn("block size-2.5 rounded-full", active ? "bg-accent" : "bg-fg-muted")} />;
}

function fieldList(fields: readonly ProfileField[]): string {
  const labels = fields.map((field) => PROFILE_FIELD_LABELS[field]);
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * The Profile tab form (screen 06): business details, status and genre access, persisted together by
 * one "Save changes". Deactivating asks for confirmation first, and leaving with unsaved edits asks
 * too. The form stays mounted while the venue is open (BIZ-01): when the venue changes elsewhere (a
 * logo upload, Activate/Deactivate from the menu), untouched fields take the new saved values and
 * the admin's edits are kept (see ./profile-draft), with a notice when both changed the same field.
 */
export function BusinessProfileForm({
  business,
  genres,
  status,
  announcementCount,
  memberCount,
  memberEmails,
  saveBusinessProfile,
  genresHref,
  announcementsHref,
}: BusinessProfileFormProps) {
  const toast = useToast();
  const dialogs = useBusinessDialogs();
  const saved = profileValuesOf(business, genres);
  const [draft, setDraft] = useState(() => newProfileDraft(saved));
  // Newer saved data (the page was refreshed): merge it in without losing the admin's edits.
  if (!sameProfileValues(draft.server, saved)) setDraft(rebaseProfileDraft(draft, saved));
  const values = draft.values;
  const dirty = isProfileDirty(draft);
  useUnsavedChangesGuard(dirty, { message: `Your changes to ${business.name} haven’t been saved.` });

  const [state, dispatch, pending] = useActionState(async (previous: BusinessProfileState, formData: FormData) => {
    const submitted = profileValuesFromForm(formData);
    const result = await saveBusinessProfile(previous, formData);
    if (result.ok) {
      setDraft((current) => markProfileSaved(current, submitted));
      toast.success("Changes saved", { description: result.message ?? undefined });
    } else if (result.saved) {
      // The venue row was saved; only the genre access was not.
      setDraft((current) => markProfileSaved(current, { ...submitted, genreIds: current.baseline.genreIds }));
      toast.warning("Saved, with a problem", { description: result.message ?? undefined });
    }
    return result;
  }, INITIAL_STATE);
  const [confirming, setConfirming] = useState<FormData | null>(null);
  const genreHeadingId = useId();
  const detailsHeadingId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  useFocusAfterFailure(state, formRef, messageRef);
  useRestoreFocusAfterPending(pending, submitRef);

  const errors = state.fieldErrors;
  const suggestion = suggestStationName(values.name);
  const hasPronunciation = Boolean(business.namePronunciation || business.stationNamePronunciation);
  const brandingDirty = brandingDiffers(brandingOf(business), {
    name: values.name,
    stationName: values.stationName,
    namePronunciation: values.namePronunciation,
    stationNamePronunciation: values.stationNamePronunciation,
  });
  const checkedGenres = new Set(splitGenreIds(values.genreIds));
  const resetDisabledReason =
    dialogs.accessUnavailableReason ?? (memberCount === 0 ? "No staff account yet: invite the contact from the Access tab." : null);

  function update(field: ProfileField, value: string) {
    setDraft((current) => setProfileValue(current, field, value));
  }

  function toggleGenre(genreId: string, checked: boolean) {
    setDraft((current) => {
      const ids = new Set(splitGenreIds(current.values.genreIds));
      if (checked) ids.add(genreId);
      else ids.delete(genreId);
      return setProfileValue(current, "genreIds", joinGenreIds(ids));
    });
  }

  function submit(formData: FormData) {
    startTransition(() => dispatch(formData));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    const deactivating = business.isActive && lastFormString(formData, "isActive") === "false";
    if (deactivating) setConfirming(formData);
    else submit(formData);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} aria-busy={pending || undefined} className="grid gap-6">
      <input type="hidden" name="businessId" value={business.id} />

      {/* A polite live region that is always present, so the notice is announced when it appears. */}
      <div aria-live="polite" className={draft.conflicts.length > 0 ? undefined : "sr-only"}>
        {draft.conflicts.length > 0 && (
          <Alert
            role="none"
            tone="warning"
            title="Changed elsewhere while you were editing"
            description={`${fieldList(draft.conflicts)} ${draft.conflicts.length === 1 ? "was" : "were"} changed since you started editing. Your unsaved values are kept: saving replaces the newer ones.`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setDraft(takeSavedValuesForConflicts)}>
                Use the saved values
              </Button>
            }
          />
        )}
      </div>

      <section aria-labelledby={detailsHeadingId} className="grid gap-4">
        <h3 id={detailsHeadingId} className="text-lg font-semibold text-fg">
          Business details
        </h3>

        <div className="grid gap-4 @md:grid-cols-2">
          <Field label="Business name" error={errors.name} required>
            <Input
              name="name"
              value={values.name}
              onChange={(event) => update("name", event.currentTarget.value)}
              maxLength={BUSINESS_FIELD_MAX_LENGTH.name}
              autoComplete="off"
            />
          </Field>
          <Field label="Business type" error={errors.businessType} required>
            <Select name="businessType" value={values.businessType} onChange={(event) => update("businessType", event.currentTarget.value)}>
              {BUSINESS_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Station name"
          hint={suggestion && suggestion !== business.stationName ? `Shown on the player, e.g. “${suggestion}”.` : "Shown on the player."}
          error={errors.stationName}
          required
        >
          <Input
            name="stationName"
            value={values.stationName}
            onChange={(event) => update("stationName", event.currentTarget.value)}
            maxLength={BUSINESS_FIELD_MAX_LENGTH.stationName}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Contact email"
          hint="Used to invite the venue; it doesn’t give anyone access by itself."
          error={errors.contactEmail}
          optional
        >
          <Input
            type="email"
            name="contactEmail"
            value={values.contactEmail}
            onChange={(event) => update("contactEmail", event.currentTarget.value)}
            maxLength={BUSINESS_FIELD_MAX_LENGTH.contactEmail}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <div className="grid gap-4 @md:grid-cols-2">
          <LanguageField
            value={values.announcementLanguage}
            onValueChange={(code) => update("announcementLanguage", code)}
            error={errors.announcementLanguage}
            hint={null}
          />
          <Field
            label="Business status"
            hint={values.isActive === "true" && status.status === "invited" ? "Shown as Invited until a staff account accepts its invitation." : undefined}
            error={errors.isActive}
            required
          >
            <Select
              name="isActive"
              value={values.isActive}
              onChange={(event) => update("isActive", event.currentTarget.value)}
              leading={<StatusDot active={values.isActive === "true"} />}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </Field>
        </div>

        <details
          open={hasPronunciation || Boolean(errors.namePronunciation || errors.stationNamePronunciation) || undefined}
          className="group rounded-control border border-border bg-control/40"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-control px-3.5 py-2.5 text-sm font-semibold text-fg [&::-webkit-details-marker]:hidden">
            <span>Pronunciation for announcements</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-4 px-3.5 pt-1 pb-4 @xl:grid-cols-2">
            <Field
              label="Name pronunciation"
              hint="How the voice says the name, e.g. “Emerald Bar”. Blank: read as written."
              error={errors.namePronunciation}
              optional
            >
              <Input
                name="namePronunciation"
                value={values.namePronunciation}
                onChange={(event) => update("namePronunciation", event.currentTarget.value)}
                maxLength={BUSINESS_FIELD_MAX_LENGTH.namePronunciation}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Station name pronunciation"
              hint="How the voice says the station name. Blank: read as written."
              error={errors.stationNamePronunciation}
              optional
            >
              <Input
                name="stationNamePronunciation"
                value={values.stationNamePronunciation}
                onChange={(event) => update("stationNamePronunciation", event.currentTarget.value)}
                maxLength={BUSINESS_FIELD_MAX_LENGTH.stationNamePronunciation}
                autoComplete="off"
              />
            </Field>
          </div>
        </details>

        <p className="flex items-start gap-2 text-sm text-fg-muted" aria-live="polite">
          <TriangleAlert aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", brandingDirty ? "text-warning" : "text-fg-subtle")} />
          <span className={brandingDirty ? "text-warning" : undefined}>
            {brandingDirty
              ? announcementCount > 0
                ? `Branding changed: saving marks ${announcementCount === 1 ? "its announcement" : `all ${announcementCount} of its announcements`} for review, and approved ones stop playing until they are approved again.`
                : "Branding changed: this venue has no announcements yet, so nothing needs review."
              : "Changing the name, station name or a pronunciation marks this venue’s announcements for review."}
          </span>
        </p>
      </section>

      <div className="border-t border-border pt-5">
        <GenreAccessTiles
          genres={genres}
          checkedIds={checkedGenres}
          onCheckedChange={toggleGenre}
          genresHref={genresHref}
          headingId={genreHeadingId}
        />
      </div>

      <div className="border-t border-border pt-5">
        <ButtonLink href={announcementsHref as Route} variant="outline" fullWidth icon={<Megaphone aria-hidden="true" />}>
          Manage announcements
        </ButtonLink>
      </div>

      <div ref={messageRef} tabIndex={-1} className={cn("focus:outline-none", (state.ok || !state.message?.trim()) && "sr-only")}>
        <FormMessage state={state.ok ? null : state} />
      </div>

      <div className="grid gap-3">
        <div className="grid gap-3 @sm:grid-cols-2">
          <Button ref={submitRef} type="submit" loading={pending} loadingText="Saving…">
            Save changes
          </Button>
          <Button
            variant="outline"
            icon={<KeyRound aria-hidden="true" />}
            disabled={resetDisabledReason !== null}
            onClick={() =>
              dialogs.openPasswordReset({ id: business.id, name: business.name, isActive: business.isActive, memberCount, memberEmails })
            }
          >
            Send password reset
          </Button>
        </div>
        <p className="text-sm text-fg-muted" aria-live="polite">
          {dirty ? <span className="font-medium text-warning">You have unsaved changes. </span> : null}
          Passwords are managed securely by the business.
          {resetDisabledReason ? ` ${resetDisabledReason}` : ""}
        </p>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const formData = confirming;
          setConfirming(null);
          if (formData) submit(formData);
        }}
        title={`Deactivate ${business.name}?`}
        description="Saving these changes makes the venue inactive: its players stop when the current song ends and staff see that the venue is not active. Nothing is deleted, and you can activate it again at any time."
        confirmLabel="Deactivate and save"
      />
    </form>
  );
}
