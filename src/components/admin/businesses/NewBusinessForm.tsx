"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Inbox, Plus } from "lucide-react";
import { useUnsavedChangesGuard } from "@/components/admin/shell/unsaved-changes";
import { Alert, Button, ButtonLink, Card, Field, FormMessage, Input, Select, Switch, useToast } from "@/components/ui";
import type { GenreAccessOption } from "@/lib/data/admin/businesses";
import { cn } from "@/lib/utils/cn";
import { AccessLinkDialog } from "./AccessLinkDialog";
import type { AccessRequestPrefill } from "./access-request-rules";
import type { CreateBusinessAction, NewBusinessState, NewBusinessValues } from "./action-types";
import {
  BUSINESS_FIELD_MAX_LENGTH,
  BUSINESS_TYPE_OPTIONS,
  EMPTY_BUSINESS_FORM_VALUES,
  suggestStationName,
} from "./business-form";
import { useFocusAfterFailure, useRestoreFocusAfterPending } from "./form-focus";
import { GenreAccessTiles } from "./GenreAccessTiles";
import { LanguageField } from "./LanguageField";
import { useFormChangeTracking } from "./unsaved-changes";

export interface NewBusinessFormProps {
  action: CreateBusinessAction;
  genres: readonly GenreAccessOption[];
  /** Prefill from an access request ("Create business from request"). */
  prefill: AccessRequestPrefill | null;
  /** Honest notes shown above the form (the request it came from is closed, genres couldn't load…). */
  notices: readonly string[];
  /** Announcement frequency new venues start with (platform settings). */
  defaultFrequency: { everyNTracks: number; fromSettings: boolean };
  /** Why invitations can't be sent (no secret key / site URL), or null. */
  invitesUnavailableReason: string | null;
  basePath: string;
  settingsHref: string;
  genresHref: string;
}

const INITIAL_STATE: NewBusinessState = { ok: false, message: null, fieldErrors: {}, created: null, link: null, warnings: [] };

function initialValues(prefill: AccessRequestPrefill | null, invitesAvailable: boolean): NewBusinessValues {
  return {
    ...EMPTY_BUSINESS_FORM_VALUES,
    name: prefill?.name ?? "",
    stationName: prefill?.stationName ?? "",
    contactEmail: prefill?.contactEmail ?? "",
    businessType: prefill?.businessType ?? "",
    isActive: "true",
    genreIds: "",
    inviteContact: invitesAvailable ? "true" : "false",
    inviteDelivery: "email",
    fromRequest: prefill?.requestId ?? "",
  };
}

/**
 * "Add business" (screen 06 add form). "Add another business" starts a fresh form (without the
 * access-request prefill, which belongs to the business just created).
 */
export function NewBusinessForm(props: NewBusinessFormProps) {
  const [round, setRound] = useState(0);
  return (
    <NewBusinessFormBody
      key={round}
      {...props}
      prefill={round === 0 ? props.prefill : null}
      notices={round === 0 ? props.notices : []}
      onAddAnother={() => setRound((current) => current + 1)}
    />
  );
}

/**
 * The form itself: name, station name ("<name> Radio" suggested), contact
 * email, type, language, status, genre access and "Invite the contact now". Once the business
 * exists the form is replaced by the result, so it can never be created twice; anything that did
 * not complete afterwards (genres, request status, invitation) is listed honestly.
 */
function NewBusinessFormBody({
  action,
  genres,
  prefill,
  notices,
  defaultFrequency,
  invitesUnavailableReason,
  basePath,
  settingsHref,
  genresHref,
  onAddAnother,
}: NewBusinessFormProps & { onAddAnother: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const invitesAvailable = invitesUnavailableReason === null;
  const [link, setLink] = useState<{ url: string; type: "invite" | "recovery"; email: string } | null>(null);
  const [state, formAction, pending] = useActionState(async (previous: NewBusinessState, formData: FormData) => {
    const result = await action(previous, formData);
    if (result.created && !result.link && result.warnings.length === 0) {
      toast.success(`${result.created.name} created`, { description: result.message ?? undefined });
      // The form's values are saved, so this navigation needs no "discard changes?" check.
      router.replace(`${basePath}/${result.created.id}?created=1` as Route);
    } else if (result.link) {
      setLink(result.link);
    }
    return result;
  }, INITIAL_STATE);

  const values = state.values ?? initialValues(prefill, invitesAvailable);
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const createdHeadingRef = useRef<HTMLHeadingElement>(null);
  const { track, dirty } = useFormChangeTracking(formRef);
  // Once the business exists, nothing typed here is unsaved any more.
  useUnsavedChangesGuard(dirty && !state.created, { message: "The new business hasn’t been created yet." });
  // The form stays mounted after a failure (A11Y-07): its message region announces the result, and
  // focus moves to the first invalid field or to the message.
  useFocusAfterFailure(state, formRef, messageRef);
  useRestoreFocusAfterPending(pending, submitRef);
  const createdId = state.created?.id ?? null;
  useEffect(() => {
    if (createdId) createdHeadingRef.current?.focus();
  }, [createdId]);
  const [nameValue, setNameValue] = useState(values.name);
  const [invite, setInvite] = useState(values.inviteContact === "true");
  const genreHeadingId = useId();
  const suggestion = suggestStationName(nameValue);
  const echoedGenres = state.values ? new Set(state.values.genreIds.split(",").filter(Boolean)) : null;
  const errors = state.fieldErrors;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Submitted from here (not <form action>) so React does not reset the fields afterwards.
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  if (state.created) {
    const created = state.created;
    const detailHref = `${basePath}/${created.id}?created=1`;
    return (
      <Card className="grid gap-5 p-5 sm:p-6">
        <div className="grid gap-1">
          <h2 ref={createdHeadingRef} tabIndex={-1} data-detail-heading="new" className="text-2xl font-bold tracking-tight text-fg focus:outline-none">
            {created.name} was created
          </h2>
          <p className="text-fg-muted">{state.message}</p>
        </div>
        {state.warnings.length > 0 && (
          <Alert
            tone="warning"
            title="Not everything finished"
            description={
              <ul className="grid list-disc gap-1 pl-5">
                {state.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            }
          />
        )}
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={detailHref as Route} iconRight={<ArrowRight aria-hidden="true" />}>
            Open {created.name}
          </ButtonLink>
          <Button variant="secondary" icon={<Plus aria-hidden="true" />} onClick={onAddAnother}>
            Add another business
          </Button>
        </div>
        <AccessLinkDialog
          link={link}
          onClose={() => {
            setLink(null);
            if (state.warnings.length === 0) router.replace(detailHref as Route);
          }}
        />
      </Card>
    );
  }

  return (
    <Card className="@container p-5 sm:p-6">
      <div className="grid gap-1 pb-5">
        <h2 tabIndex={-1} data-detail-heading="new" className="text-2xl font-bold tracking-tight text-fg focus:outline-none">
          Add business
        </h2>
        <p className="text-sm text-fg-muted">
          Create the venue and its station. New venues play an announcement after every{" "}
          {defaultFrequency.everyNTracks === 1 ? "completed song" : `${defaultFrequency.everyNTracks} completed songs`}
          {defaultFrequency.fromSettings ? " (" : " (the built-in default; "}
          <Link href={settingsHref as Route} className="rounded-sm font-medium text-accent-text underline underline-offset-4">
            change it in Settings
          </Link>
          ).
        </p>
      </div>

      {prefill && (
        <Alert
          tone="info"
          icon={<Inbox />}
          className="mb-5"
          title={`From the access request of ${prefill.contactName || prefill.contactEmail}`}
          description="Name, type and contact email are filled in from the request. It is marked approved once the business is created."
        />
      )}
      {notices.map((notice) => (
        <Alert key={notice} tone="warning" className="mb-5" description={notice} />
      ))}

      <form ref={formRef} onSubmit={handleSubmit} onChange={track} aria-busy={pending || undefined} className="grid gap-6">
        <input type="hidden" name="fromRequest" value={values.fromRequest} />

        <div className="grid gap-4 @md:grid-cols-2">
          <Field label="Business name" hint="The venue’s real name, as guests know it." error={errors.name} required>
            <Input
              name="name"
              defaultValue={values.name}
              maxLength={BUSINESS_FIELD_MAX_LENGTH.name}
              autoComplete="off"
              onChange={(event) => setNameValue(event.currentTarget.value)}
            />
          </Field>
          <Field label="Business type" error={errors.businessType} required>
            <Select name="businessType" defaultValue={values.businessType} placeholder="Choose a type" required>
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
          hint={suggestion ? `Shown on the player. Leave blank to use “${suggestion}”.` : "Shown on the player. Leave blank to use “<business name> Radio”."}
          error={errors.stationName}
        >
          <Input
            name="stationName"
            defaultValue={values.stationName}
            placeholder={suggestion || undefined}
            maxLength={BUSINESS_FIELD_MAX_LENGTH.stationName}
            autoComplete="off"
          />
        </Field>

        <div className="grid gap-4 @md:grid-cols-2">
          <Field
            label="Contact email"
            hint="The person who will sign in for the venue."
            error={errors.contactEmail}
            required={invite}
            optional={!invite}
          >
            <Input
              type="email"
              name="contactEmail"
              defaultValue={values.contactEmail}
              maxLength={BUSINESS_FIELD_MAX_LENGTH.contactEmail}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Business status" hint="Active venues can play as soon as their contact signs in." error={errors.isActive} required>
            <Select name="isActive" defaultValue={values.isActive === "false" ? "false" : "true"}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </Field>
        </div>

        <LanguageField defaultValue={values.announcementLanguage || "en"} error={errors.announcementLanguage} />

        <div className="border-t border-border pt-5">
          <GenreAccessTiles
            genres={genres}
            checkedIds={echoedGenres}
            genresHref={genresHref}
            headingId={genreHeadingId}
            description="Genres available to every venue are always included. Tick the exclusive genres this venue may also play."
          />
        </div>

        <div className="grid gap-3 rounded-card border border-border bg-control p-4">
          {/* Always submit a value: the hidden "false" is overridden by the switch's "true" when on. */}
          <input type="hidden" name="inviteContact" value="false" />
          <Switch
            name="inviteContact"
            value="true"
            checked={invite}
            onCheckedChange={setInvite}
            disabled={!invitesAvailable}
            label="Invite the contact now"
            description={
              invitesAvailable
                ? "They get an invitation to choose their own password. You never see or set it."
                : invitesUnavailableReason
            }
          />
          <fieldset className={cn("grid gap-2", !invite && "hidden")} disabled={!invite}>
            <legend className="mb-1 text-sm font-medium text-fg">How to invite</legend>
            <label className="flex items-start gap-3 text-sm text-fg">
              <input type="radio" name="inviteDelivery" value="email" defaultChecked={values.inviteDelivery !== "link"} className="mt-0.5 size-5 accent-accent" />
              <span>
                <span className="font-medium">Send an invitation email</span>
                <span className="block text-fg-muted">Sent by Supabase Auth (its built-in email service only reaches your Supabase team).</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-fg">
              <input type="radio" name="inviteDelivery" value="link" defaultChecked={values.inviteDelivery === "link"} className="mt-0.5 size-5 accent-accent" />
              <span>
                <span className="font-medium">Create a one-time invite link</span>
                <span className="block text-fg-muted">Shown once after creating; deliver it to the contact privately.</span>
              </span>
            </label>
          </fieldset>
        </div>

        <div ref={messageRef} tabIndex={-1} className={cn("focus:outline-none", !state.message?.trim() && "sr-only")}>
          <FormMessage state={state} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button ref={submitRef} type="submit" size="lg" loading={pending} loadingText="Creating…" icon={<Plus aria-hidden="true" />}>
            Create business
          </Button>
          <ButtonLink href={basePath as Route} variant="ghost" size="lg">
            Cancel
          </ButtonLink>
        </div>
      </form>
    </Card>
  );
}
