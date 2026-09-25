/**
 * Reusable zod 4 field schemas. Form-oriented helpers accept the string values FormData produces as
 * well as native JSON values, so the same schema serves Server Actions and JSON endpoints.
 */
import { z } from "zod";

/** Postgres uuid (any 8-4-4-4-12 hex form; z.uuid() would reject non-RFC seed ids). */
export const idSchema = z.guid({ error: "Invalid id." });

/** BCP-47-ish language code, same rule as the DB check: "en", "bg", "pt-BR". */
export const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
export const languageCodeSchema = z
  .string({ error: "Language is required." })
  .trim()
  .regex(LANGUAGE_CODE_PATTERN, { error: 'Use a language code such as "en", "bg" or "pt-BR".' });

/** "" (after trimming) becomes null so optional text inputs can be cleared. */
function emptyToNull(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function requiredText(label: string, max: number) {
  return z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, { error: `${label} is required.` })
    .max(max, { error: `${label} must be at most ${max} characters.` });
}

/** Optional free text stored as NULL when blank. */
export function nullableText(label: string, max: number) {
  return z.preprocess(
    emptyToNull,
    z
      .string({ error: `${label} must be text.` })
      .max(max, { error: `${label} must be at most ${max} characters.` })
      .nullable(),
  );
}

export const nullableEmailSchema = z.preprocess(
  emptyToNull,
  z
    .email({ error: "Enter a valid email address." })
    .max(254, { error: "Email addresses must be at most 254 characters." })
    .nullable(),
);

export const emailSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z
    .email({ error: "Enter a valid email address." })
    .max(254, { error: "Email addresses must be at most 254 characters." }),
);

const TRUE_STRINGS = new Set(["true", "on", "1", "yes"]);
const FALSE_STRINGS = new Set(["false", "off", "0", "no", ""]);

function parseBooleanish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (TRUE_STRINGS.has(normalized)) return true;
  if (FALSE_STRINGS.has(normalized)) return false;
  return value;
}

/**
 * Boolean from JSON or FormData ("true"/"on"/"1" ⇒ true, "false"/"off"/"0"/"" ⇒ false).
 * An ABSENT value is not false: create schemas apply their default and update schemas leave the column
 * unchanged. HTML forms must therefore always submit a value, e.g. a hidden "false" input placed
 * before the checkbox (see formDataToObject).
 */
export const formBoolean = z.preprocess(parseBooleanish, z.boolean({ error: "Choose yes or no." }));

function toNumber(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

function numberError(label: string) {
  return (issue: { input?: unknown }) =>
    issue.input === undefined ? `${label} is required.` : `${label} must be a number.`;
}

export function formInteger(label: string, min: number, max: number) {
  return z.preprocess(
    toNumber,
    z
      .number({ error: numberError(label) })
      .int({ error: `${label} must be a whole number.` })
      .min(min, { error: `${label} must be between ${min} and ${max}.` })
      .max(max, { error: `${label} must be between ${min} and ${max}.` }),
  );
}

/** Decimal number rounded to `decimals` places after the range check. */
export function formNumber(label: string, min: number, max: number, decimals = 2) {
  const factor = 10 ** decimals;
  return z
    .preprocess(
      toNumber,
      z
        .number({ error: numberError(label) })
        .min(min, { error: `${label} must be between ${min} and ${max}.` })
        .max(max, { error: `${label} must be between ${min} and ${max}.` }),
    )
    .transform((value) => Math.round(value * factor) / factor);
}

/** De-duplicated list of ids (accepts a single string from FormData too). */
export function idArray(label: string, max: number) {
  return z
    .preprocess(
      (value) => (typeof value === "string" ? (value === "" ? [] : [value]) : value),
      z.array(idSchema, { error: `${label} must be a list.` }).max(max, { error: `Choose at most ${max} ${label.toLowerCase()}.` }),
    )
    .transform((ids) => [...new Set(ids)]);
}
