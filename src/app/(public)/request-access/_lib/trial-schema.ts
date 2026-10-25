/** zod schema of the public trial-request form (kept out of the 'use server' file). Messages come from the visitor's language. */
import { z } from "zod";
import type { TrialFormMessages } from "@/content/site/types";
import { fill } from "@/lib/i18n/locale";
import {
  BUSINESS_TYPE_VALUES,
  EMPTY_TRIAL_REQUEST_VALUES,
  GENRE_RECOMMENDATION,
  TRIAL_REQUEST_LIMITS,
  type TrialRequestValues,
} from "@/lib/public/trial-request";

/** Digits, spaces and + ( ) . / - only, with at least five digits. */
const PHONE_CHARACTERS = /^[0-9+().\s/-]+$/;

function emptyToNull(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function requiredText(requiredMessage: string, max: number, tooLong: string) {
  return z
    .string({ error: requiredMessage })
    .trim()
    .min(1, { error: requiredMessage })
    .max(max, { error: fill(tooLong, { max }) });
}

function optionalText(max: number, tooLong: string) {
  return z.preprocess(emptyToNull, z.string().max(max, { error: fill(tooLong, { max }) }).nullable());
}

/**
 * The form's schema. `genreSlugs` are the catalogue genres currently offered, so a submitted genre
 * is always one the venue could really get (or the recommendation option).
 */
export function buildTrialRequestSchema(messages: TrialFormMessages, genreSlugs: readonly string[]) {
  const allowedGenres = new Set([GENRE_RECOMMENDATION, ...genreSlugs]);
  return z.object({
    venueName: requiredText(messages.venueNameRequired, TRIAL_REQUEST_LIMITS.venueName, messages.tooLong),
    venueType: z.enum(BUSINESS_TYPE_VALUES, { error: messages.venueTypeRequired }),
    city: requiredText(messages.cityRequired, TRIAL_REQUEST_LIMITS.city, messages.tooLong),
    contactName: requiredText(messages.contactNameRequired, TRIAL_REQUEST_LIMITS.contactName, messages.tooLong),
    email: z.preprocess(
      (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
      z.email({ error: messages.emailInvalid }).max(TRIAL_REQUEST_LIMITS.email, { error: messages.emailInvalid }),
    ),
    phone: optionalText(TRIAL_REQUEST_LIMITS.phone, messages.tooLong).refine(
      (value) => value === null || (PHONE_CHARACTERS.test(value) && (value.match(/\d/g)?.length ?? 0) >= 5),
      { error: messages.phoneInvalid },
    ),
    preferredGenre: z
      .string({ error: messages.genreRequired })
      .trim()
      .refine((value) => allowedGenres.has(value), { error: messages.genreRequired }),
    message: optionalText(TRIAL_REQUEST_LIMITS.message, messages.tooLong),
  });
}

export type TrialRequestInput = z.output<ReturnType<typeof buildTrialRequestSchema>>;

/** The submitted values as typed (trimmed and capped) for echoing back into the form after an error. */
export function echoTrialRequestValues(formData: FormData): TrialRequestValues {
  const read = (key: keyof TrialRequestValues, max: number): string => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  };
  return {
    ...EMPTY_TRIAL_REQUEST_VALUES,
    venueName: read("venueName", TRIAL_REQUEST_LIMITS.venueName * 2),
    venueType: read("venueType", 20),
    city: read("city", TRIAL_REQUEST_LIMITS.city * 2),
    contactName: read("contactName", TRIAL_REQUEST_LIMITS.contactName * 2),
    email: read("email", TRIAL_REQUEST_LIMITS.email),
    phone: read("phone", TRIAL_REQUEST_LIMITS.phone * 2),
    preferredGenre: read("preferredGenre", TRIAL_REQUEST_LIMITS.preferredGenre * 2),
    message: read("message", TRIAL_REQUEST_LIMITS.message * 2),
  };
}
