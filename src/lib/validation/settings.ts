import { z } from "zod";
import { formInteger, nullableEmailSchema } from "./fields";

/** Limits identical to the `platform_settings` column checks (supabase/migrations/20260926000100_frekvencija.sql). */
export const PLATFORM_SETTINGS_LIMITS = {
  contactEmail: 254,
  contactPhone: 40,
  policyText: 50_000,
  minAnnouncementEveryNTracks: 1,
  maxAnnouncementEveryNTracks: 50,
} as const;

/** Digits, spaces and the usual phone punctuation (+ ( ) - . /), with at least one digit. */
export const CONTACT_PHONE_PATTERN = /^(?=.*\d)[+()\d\s./-]+$/;

/**
 * Browsers submit textarea line breaks as CRLF. Store plain LF (so lengths match what the admin
 * typed and the public pages split paragraphs reliably), trim the ends, and turn blank text into null.
 */
export function normalizeLongText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized === "" ? null : normalized;
}

function nullableLongText(label: string, max: number) {
  return z.preprocess(
    normalizeLongText,
    z
      .string({ error: `${label} must be text.` })
      .max(max, { error: `${label} must be at most ${max.toLocaleString("en-US")} characters.` })
      .nullable(),
  );
}

const contactPhoneSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() || null : value),
  z
    .string({ error: "The phone number must be text." })
    .max(PLATFORM_SETTINGS_LIMITS.contactPhone, {
      error: `The phone number must be at most ${PLATFORM_SETTINGS_LIMITS.contactPhone} characters.`,
    })
    .regex(CONTACT_PHONE_PATTERN, { error: "Use digits, spaces and + ( ) - . / only, e.g. +389 70 123 456." })
    .nullable(),
);

/**
 * /admin/settings form. Every field is always submitted; blank optional fields are stored as NULL
 * (the public pages then show their honest "not published yet" state).
 */
export const platformSettingsSchema = z.object({
  contactEmail: nullableEmailSchema,
  contactPhone: contactPhoneSchema,
  defaultAnnouncementEveryNTracks: formInteger(
    "The default announcement frequency",
    PLATFORM_SETTINGS_LIMITS.minAnnouncementEveryNTracks,
    PLATFORM_SETTINGS_LIMITS.maxAnnouncementEveryNTracks,
  ),
  privacyPolicy: nullableLongText("The privacy policy", PLATFORM_SETTINGS_LIMITS.policyText),
  termsOfService: nullableLongText("The terms of service", PLATFORM_SETTINGS_LIMITS.policyText),
});
export type PlatformSettingsInput = z.output<typeof platformSettingsSchema>;

/** Field names of the settings form, in display order. */
export const PLATFORM_SETTINGS_FIELDS = [
  "contactEmail",
  "contactPhone",
  "defaultAnnouncementEveryNTracks",
  "privacyPolicy",
  "termsOfService",
] as const;
export type PlatformSettingsField = (typeof PLATFORM_SETTINGS_FIELDS)[number];
