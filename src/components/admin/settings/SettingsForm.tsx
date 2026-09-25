"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { ExternalLink, Save } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FormMessage,
  Input,
  Textarea,
  useToast,
} from "@/components/ui";
import { useFocusAfterFailure, useRestoreFocusAfterPending } from "@/components/admin/businesses/form-focus";
import { useFormChangeTracking } from "@/components/admin/businesses/unsaved-changes";
import { useUnsavedChangesGuard } from "@/components/admin/shell/unsaved-changes";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import { PLATFORM_SETTINGS_LIMITS } from "@/lib/validation/settings";
import type { PlatformSettingsFormData, PlatformSettingsState, PlatformSettingsValues, SavePlatformSettingsAction } from "./types";

export interface SettingsFormProps {
  settings: PlatformSettingsFormData;
  action: SavePlatformSettingsAction;
  privacyHref: string;
  termsHref: string;
}

const INITIAL_STATE: PlatformSettingsState = { ok: false, message: null, fieldErrors: {} };
const numberFormat = new Intl.NumberFormat("en-US");

function toValues(settings: PlatformSettingsFormData): PlatformSettingsValues {
  return {
    contactEmail: settings.contactEmail ?? "",
    contactPhone: settings.contactPhone ?? "",
    defaultAnnouncementEveryNTracks: String(settings.defaultAnnouncementEveryNTracks),
    privacyPolicy: settings.privacyPolicy ?? "",
    termsOfService: settings.termsOfService ?? "",
  };
}

function Section({ id, title, description, children }: { id: string; title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardHeader>
          <CardTitle id={id}>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">{children}</CardContent>
      </Card>
    </section>
  );
}

function PolicyField({
  name,
  label,
  defaultValue,
  error,
  viewHref,
  viewLabel,
}: {
  name: "privacyPolicy" | "termsOfService";
  label: string;
  defaultValue: string;
  error?: string;
  viewHref: string;
  viewLabel: string;
}) {
  const [length, setLength] = useState(defaultValue.length);
  return (
    <Field
      label={label}
      optional
      error={error}
      labelAside={
        <Link
          href={viewHref as Route}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-accent-text underline-offset-4 hover:underline"
        >
          {viewLabel}
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </Link>
      }
      hint={`Plain text: leave a blank line between paragraphs; no formatting or HTML. Leave it empty to show “not published yet”. ${numberFormat.format(length)} / ${numberFormat.format(PLATFORM_SETTINGS_LIMITS.policyText)} characters.`}
    >
      <Textarea
        name={name}
        rows={10}
        maxLength={PLATFORM_SETTINGS_LIMITS.policyText}
        defaultValue={defaultValue}
        onChange={(event) => setLength(event.currentTarget.value.length)}
        className="min-h-48"
      />
    </Field>
  );
}

/**
 * /admin/settings form: platform contact, default announcement frequency and the legal texts, saved
 * together. The form stays mounted across results (A11Y-07): after a failure the typed values stay,
 * the message is announced by its live region and focus moves to the first invalid field (or the
 * message); unsaved edits ask before leaving through any admin link.
 */
export function SettingsForm({ settings, action, privacyHref, termsHref }: SettingsFormProps) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const { track, markSaved, dirty } = useFormChangeTracking(formRef);
  useUnsavedChangesGuard(dirty, { message: "Your settings changes haven’t been saved." });
  const [state, formAction, pending] = useActionState(async (previous: PlatformSettingsState, formData: FormData) => {
    const result = await action(previous, formData);
    if (result.ok) {
      markSaved();
      toast.success("Settings saved", { description: "Venues and the public pages use the new details right away." });
    }
    return result;
  }, INITIAL_STATE);
  useFocusAfterFailure(state, formRef, messageRef);
  useRestoreFocusAfterPending(pending, submitRef);
  const values = !state.ok && state.values ? state.values : toValues(settings);
  const errors = state.fieldErrors;
  const showsMessage = !state.ok && Boolean(state.message?.trim());

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Submitted from here (not <form action>) so React does not reset the fields afterwards.
    event.preventDefault();
    if (pending || settings.rowMissing) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <>
      {settings.rowMissing && (
        <Alert
          tone="danger"
          className="mb-6"
          title="The settings row is missing"
          description="Apply supabase/migrations/20260926000100_frekvencija.sql in the Supabase SQL editor; it creates the row. Until then these settings can’t be saved."
        />
      )}
      <form ref={formRef} onSubmit={handleSubmit} onChange={track} aria-busy={pending || undefined} className="grid gap-6">
        <Section
          id="settings-contact"
          title="Platform contact"
          description="Shown to venues on their Help page and when their venue is inactive, and used as the contact on the privacy and terms pages."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Contact email" error={errors.contactEmail} optional hint="Where venues and visitors can reach you.">
              <Input
                type="email"
                name="contactEmail"
                defaultValue={values.contactEmail}
                maxLength={PLATFORM_SETTINGS_LIMITS.contactEmail}
                autoComplete="email"
                spellCheck={false}
              />
            </Field>
            <Field label="Contact phone" error={errors.contactPhone} optional hint="Include the country code, e.g. +389 70 123 456.">
              <Input
                type="tel"
                name="contactPhone"
                defaultValue={values.contactPhone}
                maxLength={PLATFORM_SETTINGS_LIMITS.contactPhone}
                autoComplete="tel"
              />
            </Field>
          </div>
        </Section>
  
        <Section
          id="settings-defaults"
          title="Defaults"
          description="Used when a new venue is added. Each venue’s own setting can be changed later on its Announcements page."
        >
          <Field
            label="Default announcement frequency"
            error={errors.defaultAnnouncementEveryNTracks}
            required
            hint={`Play a station announcement after this many completed songs (${PLATFORM_SETTINGS_LIMITS.minAnnouncementEveryNTracks}–${PLATFORM_SETTINGS_LIMITS.maxAnnouncementEveryNTracks}). Skipped songs don’t count.`}
          >
            <Input
              type="number"
              name="defaultAnnouncementEveryNTracks"
              inputMode="numeric"
              min={PLATFORM_SETTINGS_LIMITS.minAnnouncementEveryNTracks}
              max={PLATFORM_SETTINGS_LIMITS.maxAnnouncementEveryNTracks}
              step={1}
              defaultValue={values.defaultAnnouncementEveryNTracks}
              className="max-w-40"
            />
          </Field>
        </Section>
  
        <Section
          id="settings-legal"
          title="Legal pages"
          description="The text of the public privacy policy and terms of service pages. You are responsible for their content."
        >
          <PolicyField
            name="privacyPolicy"
            label="Privacy policy"
            defaultValue={values.privacyPolicy}
            error={errors.privacyPolicy}
            viewHref={privacyHref}
            viewLabel="View /privacy"
          />
          <PolicyField
            name="termsOfService"
            label="Terms of service"
            defaultValue={values.termsOfService}
            error={errors.termsOfService}
            viewHref={termsHref}
            viewLabel="View /terms"
          />
        </Section>
  
        <div className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-card sm:flex sm:items-center sm:justify-between sm:p-5">
          <div className="grid gap-1 text-sm" aria-live="polite">
            {dirty ? <p className="font-medium text-warning">You have unsaved changes.</p> : null}
            <p className="text-fg-muted">
              {settings.updatedAt
                ? `Last saved ${formatDateTime(settings.updatedAt)}${settings.updatedByEmail ? ` by ${settings.updatedByEmail}` : ""}.`
                : "Not saved yet."}
            </p>
          </div>
          <Button
            ref={submitRef}
            type="submit"
            loading={pending}
            loadingText="Saving…"
            icon={<Save aria-hidden="true" />}
            disabled={settings.rowMissing}
          >
            Save changes
          </Button>
        </div>
        <div ref={messageRef} tabIndex={-1} className={cn("focus:outline-none", !showsMessage && "sr-only")}>
          <FormMessage state={state.ok ? null : state} />
        </div>
      </form>
    </>
  );
}
