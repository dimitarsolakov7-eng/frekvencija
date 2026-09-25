"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Info, Send } from "lucide-react";
import { Alert, ButtonLink, Field, Input, Select, SubmitButton, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/actions/state";
import { cn } from "@/lib/utils/cn";
import { FORM_LINK_CLASSES } from "./FormHeading";
import {
  ACCESS_REQUEST_LIMITS,
  BUSINESS_TYPE_OPTIONS,
  EMPTY_REQUEST_ACCESS_VALUES,
  HONEYPOT_FIELD,
  type RequestAccessValues,
} from "./request-access-options";

/** Mirrors `RequestAccessState` of the server action (kept structural so this file stays client-only). */
export type RequestAccessFormState = ActionState<RequestAccessValues> & { outcome?: "sent" | "duplicate" };

export type RequestAccessAction = (
  previous: RequestAccessFormState,
  formData: FormData,
) => Promise<RequestAccessFormState>;

export interface RequestAccessFormProps {
  action: RequestAccessAction;
  /** Owner contact address from platform settings, shown after submitting when configured. */
  contactEmail?: string | null;
}

const INITIAL_STATE: RequestAccessFormState = { ok: false, message: null, fieldErrors: {} };

function WhatHappensNext({ email }: { email: string }) {
  return (
    <ol className="grid gap-3 text-sm text-fg-muted">
      {[
        "We review your request.",
        email ? `We reply to ${email} to talk about your venue.` : "We reply by email to talk about your venue.",
        "If we set up a station for you, you’ll receive an invitation email to choose your own password.",
      ].map((step, index) => (
        <li key={index} className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent/10 text-xs font-semibold text-accent-text"
          >
            {index + 1}
          </span>
          <span className="pt-0.5 text-pretty">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** Result panel that replaces the form after a successful (or duplicate) submission. */
export function RequestAccessResult({
  state,
  contactEmail,
}: {
  state: RequestAccessFormState;
  contactEmail?: string | null;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The form is replaced by this panel: move focus to its heading so the result is announced.
    headingRef.current?.focus();
  }, []);

  const duplicate = state.outcome === "duplicate";
  const email = state.values?.email ?? "";
  const businessName = state.values?.businessName ?? "";

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-12 place-items-center rounded-full",
            duplicate ? "bg-info/10 text-info" : "bg-accent/15 text-accent-text",
          )}
        >
          {duplicate ? <Info className="size-6" /> : <CircleCheck className="size-6" />}
        </span>
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-fg focus:outline-none">
          {duplicate ? "We already have your request" : "Thanks — we’ll be in touch"}
        </h2>
        <p className="text-fg-muted text-pretty">
          {duplicate
            ? `A request from ${email || "this email address"} is already waiting for us, so there’s no need to send another one.`
            : `We’ve received your request${businessName ? ` for ${businessName}` : ""}. No account is created automatically.`}
        </p>
      </div>
      <div className="grid gap-3 rounded-card border border-border bg-surface-2/60 p-5">
        <h3 className="text-sm font-semibold text-fg">What happens next</h3>
        <WhatHappensNext email={email} />
      </div>
      {contactEmail && (
        <p className="text-sm text-fg-muted">
          Questions in the meantime? Email{" "}
          <a href={`mailto:${contactEmail}`} className={FORM_LINK_CLASSES}>
            {contactEmail}
          </a>
          .
        </p>
      )}
      <div>
        <ButtonLink href="/" variant="secondary" icon={<ArrowLeft aria-hidden="true" />}>
          Back to the homepage
        </ButtonLink>
      </div>
    </div>
  );
}

/**
 * The public request-access form (same form system as /login). Native constraints give instant hints;
 * the server action re-validates everything and returns field errors plus the typed values.
 */
export function RequestAccessForm({ action, contactEmail }: RequestAccessFormProps) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const values = state.values ?? EMPTY_REQUEST_ACCESS_VALUES;
  const errors = state.fieldErrors;

  useEffect(() => {
    // After a failed submission, take keyboard and screen-reader users to the first field to fix.
    if (state.ok || !state.nonce) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);

  if (state.ok && state.outcome) return <RequestAccessResult state={state} contactEmail={contactEmail} />;

  return (
    <form ref={formRef} action={formAction} className="grid gap-5">
      {!state.ok && state.message && <Alert key={state.nonce} tone="danger" description={state.message} />}

      <Field label="Business name" error={errors.businessName}>
        <Input
          name="businessName"
          required
          autoComplete="organization"
          maxLength={ACCESS_REQUEST_LIMITS.businessName}
          defaultValue={values.businessName}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Business type" error={errors.businessType}>
          <Select name="businessType" required placeholder="Choose a type" defaultValue={values.businessType}>
            {BUSINESS_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contact name" error={errors.contactName}>
          <Input
            name="contactName"
            required
            autoComplete="name"
            maxLength={ACCESS_REQUEST_LIMITS.contactName}
            defaultValue={values.contactName}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Email address" error={errors.email}>
          <Input
            name="email"
            type="email"
            required
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={ACCESS_REQUEST_LIMITS.email}
            placeholder="you@yourbusiness.com"
            defaultValue={values.email}
          />
        </Field>
        <Field label="Phone" optional error={errors.phone}>
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={ACCESS_REQUEST_LIMITS.phone}
            defaultValue={values.phone}
          />
        </Field>
      </div>

      <Field
        label="Message"
        optional
        hint="Anything that helps us prepare, for example the atmosphere you’re looking for."
        error={errors.message}
      >
        <Textarea name="message" rows={4} maxLength={ACCESS_REQUEST_LIMITS.message} defaultValue={values.message} />
      </Field>

      {/* Anti-spam field: invisible and unreachable for people, filled in by simple bots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] size-px overflow-hidden">
        <label htmlFor={HONEYPOT_FIELD}>Leave this field empty</label>
        <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <SubmitButton size="lg" fullWidth pendingLabel="Sending…" icon={<Send aria-hidden="true" />}>
        Send request
      </SubmitButton>

      <p className="text-sm text-fg-muted text-pretty">
        See our{" "}
        <Link href="/privacy" className={FORM_LINK_CLASSES}>
          Privacy policy
        </Link>{" "}
        for how we handle your details.
      </p>
    </form>
  );
}
