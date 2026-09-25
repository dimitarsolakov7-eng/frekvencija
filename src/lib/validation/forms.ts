import { z } from "zod";

export type FieldErrors = Record<string, string>;

/**
 * Converts FormData into a plain object for zod parsing in Server Actions.
 * - Keys listed in `arrays` always become string arrays (multi-selects, checkbox groups).
 * - Other repeated keys keep the LAST value, so the "hidden false + checkbox true" pattern works:
 *   `<input type="hidden" name="isActive" value="false"><input type="checkbox" name="isActive" value="true">`.
 * - React's internal `$ACTION_*` fields are dropped. File entries are kept as File objects.
 */
export function formDataToObject(
  formData: FormData,
  options: { arrays?: readonly string[] } = {},
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const arrayKeys = new Set(options.arrays ?? []);
  const result: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const key of arrayKeys) result[key] = [];

  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    if (arrayKeys.has(key)) {
      (result[key] as FormDataEntryValue[]).push(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** First message per top-level field (nested issues are reported under their top-level key). */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const { fieldErrors } = z.flattenError(error);
  const result: FieldErrors = {};
  for (const [field, messages] of Object.entries(fieldErrors) as [string, string[] | undefined][]) {
    const first = messages?.[0];
    if (first) result[field] = first;
  }
  return result;
}

/** A single human-readable sentence describing why validation failed. */
export function summarizeValidationError(error: z.ZodError): string {
  const { formErrors, fieldErrors } = z.flattenError(error);
  if (formErrors[0]) return formErrors[0];
  const fieldMessages = Object.values(fieldErrors as Record<string, string[] | undefined>)
    .map((messages) => messages?.[0])
    .filter((message): message is string => Boolean(message));
  if (fieldMessages.length === 1) return fieldMessages[0];
  if (fieldMessages.length > 1) return "Please correct the highlighted fields.";
  return "The submitted data is invalid.";
}
