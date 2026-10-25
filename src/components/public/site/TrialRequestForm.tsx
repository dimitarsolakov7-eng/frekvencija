"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Info, Send } from "lucide-react";
import { Alert, Button, ButtonLink, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui";
import { VENUE_TYPES } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";
import type { ActionState } from "@/lib/actions/state";
import type { Locale } from "@/lib/i18n/locale";
import {
  EMPTY_TRIAL_REQUEST_VALUES,
  GENRE_RECOMMENDATION,
  HONEYPOT_FIELD,
  TRIAL_REQUEST_LIMITS,
  type GenreOption,
  type TrialRequestValues,
} from "@/lib/public/trial-request";
import { cn } from "@/lib/utils/cn";
import { TEXT_LINK_CLASSES } from "./layout";

/** Mirrors `TrialRequestState` of the server action (kept structural so this file stays client-only). */
export type TrialRequestFormState = ActionState<TrialRequestValues> & { outcome?: "sent" | "duplicate" };

export type TrialRequestAction = (previous: TrialRequestFormState, formData: FormData) => Promise<TrialRequestFormState>;

export interface TrialRequestFormProps {
  action: TrialRequestAction;
  locale: Locale;
  copy: SiteCopy["trial"];
  /** Catalogue genres offered in the preferred-genre select. */
  genres: readonly GenreOption[];
  /** Owner contact address from platform settings, shown after submitting when configured. */
  contactEmail?: string | null;
}

const INITIAL_STATE: TrialRequestFormState = { ok: false, message: null, fieldErrors: {} };

/** Taller, rounder fields for the website's form card. */
const FIELD_CLASSES = "h-12! rounded-xl!";

/** Result panel that replaces the form after a stored (or duplicate) request. */
export function TrialRequestResult({
  state,
  copy,
  contactEmail,
  onReset,
}: {
  state: TrialRequestFormState;
  copy: SiteCopy["trial"];
  contactEmail?: string | null;
  onReset?: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The form is replaced by this panel: move focus to its heading so the result is announced.
    headingRef.current?.focus();
  }, []);
  const duplicate = state.outcome === "duplicate";
  const [before, after] = copy.questions.split("{email}");

  return (
    <div className="grid gap-7" data-outcome={state.outcome}>
      <div className="grid gap-4">
        <span aria-hidden="true" className={cn("grid size-14 place-items-center rounded-full", duplicate ? "bg-info/10 text-info" : "bg-accent/15 text-accent-text")}>
          {duplicate ? <Info className="size-7" /> : <CircleCheck className="size-7" />}
        </span>
        <h3 ref={headingRef} tabIndex={-1} className="display-md text-fg focus:outline-none">
          {duplicate ? copy.duplicateTitle : copy.successTitle}
        </h3>
        <p className="text-lg text-fg-muted text-pretty">{duplicate ? copy.duplicateBody : copy.successBody}</p>
      </div>
      <div className="grid gap-4 rounded-[22px] border border-border bg-surface-2 p-6">
        <h4 className="label-mono text-fg-muted">{copy.nextStepsTitle}</h4>
        <ol className="grid gap-3 text-base text-fg/85">
          {copy.nextSteps.map((step, index) => (
            <li key={step} className="flex items-start gap-3">
              <span className="label-mono mt-0.5 text-accent-text">{String(index + 1).padStart(2, "0")}</span>
              <span className="text-pretty">{step}</span>
            </li>
          ))}
        </ol>
      </div>
      {contactEmail && (
        <p className="text-sm text-fg-muted">
          {before}
          <a href={`mailto:${contactEmail}`} className={TEXT_LINK_CLASSES}>
            {contactEmail}
          </a>
          {after}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/" variant="secondary" className="rounded-full!" icon={<ArrowLeft aria-hidden="true" />}>
          {copy.backHome}
        </ButtonLink>
        {onReset && (
          <Button variant="ghost" className="rounded-full!" onClick={onReset}>
            {copy.sendAnother}
          </Button>
        )}
      </div>
    </div>
  );
}

function FormInstance({ action, locale, copy, genres, contactEmail, onReset }: TrialRequestFormProps & { onReset: () => void }) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const values = state.values ?? EMPTY_TRIAL_REQUEST_VALUES;
  const errors = state.fieldErrors;
  const form = copy.form;

  useEffect(() => {
    // After a failed submission, take keyboard and screen-reader users to the first field to fix.
    if (state.ok || !state.nonce) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  if (state.ok && state.outcome) return <TrialRequestResult state={state} copy={copy} contactEmail={contactEmail} onReset={onReset} />;

  const [privacyBefore, privacyAfter] = form.privacyNote.split("{privacy}");

  return (
    <form ref={formRef} action={formAction} className="grid gap-5">
      <input type="hidden" name="locale" value={locale} />
      {!state.ok && state.message && <Alert key={state.nonce} tone="danger" description={state.message} />}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={form.venueName} error={errors.venueName}>
          <Input
            name="venueName"
            required
            autoComplete="organization"
            maxLength={TRIAL_REQUEST_LIMITS.venueName}
            placeholder={form.venueNamePlaceholder}
            defaultValue={values.venueName}
            className={FIELD_CLASSES}
          />
        </Field>
        <Field label={form.venueType} error={errors.venueType}>
          <Select name="venueType" required placeholder={form.venueTypePlaceholder} defaultValue={values.venueType} className="[&_select]:h-12! [&_select]:rounded-xl!">
            {VENUE_TYPES.map((venue) => (
              <option key={venue.key} value={venue.businessType}>
                {form.venueTypes[venue.key]}
              </option>
            ))}
            <option value="other">{form.otherType}</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={form.city} error={errors.city}>
          <Input
            name="city"
            required
            autoComplete="address-level2"
            maxLength={TRIAL_REQUEST_LIMITS.city}
            placeholder={form.cityPlaceholder}
            defaultValue={values.city}
            className={FIELD_CLASSES}
          />
        </Field>
        <Field label={form.contactName} error={errors.contactName}>
          <Input name="contactName" required autoComplete="name" maxLength={TRIAL_REQUEST_LIMITS.contactName} defaultValue={values.contactName} className={FIELD_CLASSES} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={form.email} error={errors.email}>
          <Input
            name="email"
            type="email"
            required
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={TRIAL_REQUEST_LIMITS.email}
            placeholder={form.emailPlaceholder}
            defaultValue={values.email}
            className={FIELD_CLASSES}
          />
        </Field>
        <Field label={form.phone} optional optionalLabel={form.optional} error={errors.phone}>
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={TRIAL_REQUEST_LIMITS.phone}
            defaultValue={values.phone}
            className={FIELD_CLASSES}
          />
        </Field>
      </div>

      <Field label={form.preferredGenre} error={errors.preferredGenre}>
        <Select
          name="preferredGenre"
          required
          placeholder={form.preferredGenrePlaceholder}
          defaultValue={values.preferredGenre}
          className="[&_select]:h-12! [&_select]:rounded-xl!"
        >
          <option value={GENRE_RECOMMENDATION}>{form.recommendationOption}</option>
          {genres.map((genre) => (
            <option key={genre.slug} value={genre.slug}>
              {genre.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={form.message} optional optionalLabel={form.optional} hint={form.messageHint} error={errors.message}>
        <Textarea name="message" rows={4} maxLength={TRIAL_REQUEST_LIMITS.message} defaultValue={values.message} className="rounded-xl!" />
      </Field>

      {/* Anti-spam field: invisible and unreachable for people, filled in by simple bots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] size-px overflow-hidden">
        <label htmlFor={HONEYPOT_FIELD}>{form.honeypotLabel}</label>
        <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <SubmitButton size="lg" fullWidth className="h-14! rounded-full! text-base!" pendingLabel={form.submitting} icon={<Send aria-hidden="true" />}>
        {form.submit}
      </SubmitButton>

      <p className="text-sm text-fg-muted text-pretty">
        {privacyBefore}
        <Link href="/privacy" className={TEXT_LINK_CLASSES}>
          {form.privacyLinkLabel}
        </Link>
        {privacyAfter}
      </p>
      <p className="text-sm text-fg-subtle text-pretty">{copy.activationNote}</p>
    </form>
  );
}

/**
 * The trial-request form (3 days free). Native constraints give instant hints; the server action
 * re-validates everything in the visitor's language and returns field errors plus the typed values. After
 * a stored request the form is replaced by the result; "send another" starts fresh.
 */
export function TrialRequestForm(props: TrialRequestFormProps) {
  const [attempt, setAttempt] = useState(0);
  return <FormInstance key={attempt} {...props} onReset={() => setAttempt((count) => count + 1)} />;
}
