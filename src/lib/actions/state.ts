/**
 * Shared result shape for Server Actions used with React's useActionState.
 * Compatible with <FormMessage state={...} /> (it reads `ok` and `message`).
 */
import type { FieldErrors } from "@/lib/validation/forms";

export interface ActionState<Values extends Record<string, string> = Record<string, string>> {
  ok: boolean;
  /** Form-level message; null/empty renders nothing. */
  message: string | null;
  /** Field-level validation messages keyed by form field name. */
  fieldErrors: FieldErrors;
  /**
   * Submitted values echoed back so forms can use them as defaultValue after a failed submit
   * (React resets uncontrolled fields after every action).
   */
  values?: Values;
  /** Monotonic marker so identical consecutive results still re-render/announce. */
  nonce?: number;
}

export const IDLE_ACTION_STATE: ActionState = { ok: false, message: null, fieldErrors: {} };

export function actionSuccess(message: string | null = null): ActionState {
  return { ok: true, message, fieldErrors: {} };
}

export function actionError<Values extends Record<string, string> = Record<string, string>>(
  message: string,
  fieldErrors: FieldErrors = {},
  values?: Values,
): ActionState<Values> {
  return { ok: false, message, fieldErrors, values };
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/**
 * Translate a Postgres/PostgREST error into an honest, user-facing sentence.
 * Never leaks SQL; unknown errors get a generic message (log the original server-side).
 */
export function describeDbError(error: PostgrestLikeError | null | undefined, fallback = "Something went wrong. Please try again."): string {
  switch (error?.code) {
    case "42501":
      return "You don't have permission to do that.";
    case "23505":
      return "An item with the same name already exists.";
    case "23503":
      return "A referenced item no longer exists. Refresh the page and try again.";
    case "23514":
    case "22023":
    case "22004":
    case "22P02":
      return "Some values are invalid. Check the form and try again.";
    case "PGRST116":
      return "The item was not found. It may have been deleted.";
    default:
      return fallback;
  }
}
