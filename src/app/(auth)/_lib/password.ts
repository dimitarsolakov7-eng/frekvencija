/**
 * New-password rules for /reset-password (pure; shared by the Server Action and its tests).
 * Supabase stores passwords with bcrypt, which only uses the first 72 bytes, and its Auth server
 * rejects longer ones — so the byte limit is checked here to give a clear message.
 */
import type { FieldErrors } from "@/lib/validation/forms";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;

export type NewPasswordCheck = { ok: true; password: string } | { ok: false; fieldErrors: FieldErrors };

function characterCount(value: string): number {
  // Code points, so an emoji or accented letter counts as one character, as users expect.
  return Array.from(value).length;
}

export function validateNewPassword(password: unknown, confirmation: unknown): NewPasswordCheck {
  const fieldErrors: FieldErrors = {};
  const value = typeof password === "string" ? password : "";
  const repeat = typeof confirmation === "string" ? confirmation : "";

  if (value.length === 0) {
    fieldErrors.password = "Enter a new password.";
  } else if (value.trim().length === 0) {
    fieldErrors.password = "A password can’t consist only of spaces.";
  } else if (characterCount(value) < PASSWORD_MIN_LENGTH) {
    fieldErrors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) {
    fieldErrors.password = `Use at most ${PASSWORD_MAX_BYTES} characters (fewer if you use accented letters or emoji).`;
  }

  if (repeat.length === 0) {
    fieldErrors.confirmPassword = "Type the new password again to confirm it.";
  } else if (repeat !== value) {
    fieldErrors.confirmPassword = "The two passwords don’t match.";
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, password: value };
}

/** Why the user is on /reset-password, derived from the session's `amr` (authentication methods) claim. */
export type PasswordPageMode = "invite" | "recovery" | "change";

export function passwordPageMode(amr: unknown): PasswordPageMode {
  if (!Array.isArray(amr)) return "change";
  const methods = new Set(
    amr
      .map((entry: unknown) =>
        entry && typeof entry === "object" && "method" in entry ? (entry as { method: unknown }).method : entry,
      )
      .filter((method): method is string => typeof method === "string"),
  );
  if (methods.has("invite")) return "invite";
  if (methods.has("recovery")) return "recovery";
  return "change";
}
