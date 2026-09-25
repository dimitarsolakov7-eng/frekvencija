/**
 * Supabase Auth error → user-facing message mapping for the sign-in, email-link and password flows.
 * Branches on `error.code` / error classes (never on message text). Pure, so it is unit-tested.
 */
import {
  isAuthError,
  isAuthPKCECodeVerifierMissingError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  isAuthWeakPasswordError,
} from "@supabase/supabase-js";
import type { FieldErrors } from "@/lib/validation/forms";

// ---------------------------------------------------------------------------
// Email links (/auth/confirm → /login?error=<code>)
// ---------------------------------------------------------------------------

/** The only values /auth/confirm ever puts into `/login?error=`. */
export const AUTH_LINK_ERROR_CODES = [
  "otp_expired",
  "link_invalid",
  "link_other_browser",
  "auth_unavailable",
  "too_many_attempts",
  "verify_failed",
  "session_expired",
] as const;

export type AuthLinkErrorCode = (typeof AUTH_LINK_ERROR_CODES)[number];

export interface AuthNotice {
  code: AuthLinkErrorCode;
  title: string;
  message: string;
}

const AUTH_LINK_NOTICES: Record<AuthLinkErrorCode, Omit<AuthNotice, "code">> = {
  otp_expired: {
    title: "This link can’t be used any more",
    message:
      "This link has expired or was already used. Ask your administrator for a new invite or use Forgot password.",
  },
  link_invalid: {
    title: "This link is incomplete",
    message:
      "The link is missing information or was changed. Open the most recent email and use its button, or ask your administrator for a new invite. You can also use Forgot password.",
  },
  link_other_browser: {
    title: "Open the link in the same browser",
    message:
      "This link only works in the browser where it was requested. Open it there, or use Forgot password to get a new link in this browser.",
  },
  auth_unavailable: {
    title: "Sign-in service unavailable",
    message: "The sign-in service could not be reached. Please try again in a moment.",
  },
  too_many_attempts: {
    title: "Too many attempts",
    message: "Too many attempts from this network. Please wait a few minutes and try again.",
  },
  verify_failed: {
    title: "We couldn’t verify this link",
    message:
      "The link could not be confirmed. Ask your administrator for a new invite, or use Forgot password to get a new link.",
  },
  session_expired: {
    title: "Your session has ended",
    message: "Please sign in again to continue.",
  },
};

export function isAuthLinkErrorCode(value: unknown): value is AuthLinkErrorCode {
  return typeof value === "string" && (AUTH_LINK_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Notice for a `?error=` query value. Unknown values yield null: the raw parameter is attacker
 * controlled and is never rendered.
 */
export function describeAuthLinkError(code: unknown): AuthNotice | null {
  const value = Array.isArray(code) ? code[0] : code;
  if (!isAuthLinkErrorCode(value)) return null;
  return { code: value, ...AUTH_LINK_NOTICES[value] };
}

function codeOf(error: unknown): string | undefined {
  if (isAuthError(error)) return error.code ?? undefined;
  return undefined;
}

/** Maps a verifyOtp / exchangeCodeForSession failure (returned or thrown) to a link error code. */
export function authLinkErrorCode(error: unknown): AuthLinkErrorCode {
  if (isAuthRetryableFetchError(error)) return "auth_unavailable";
  if (isAuthPKCECodeVerifierMissingError(error)) return "link_other_browser";
  switch (codeOf(error)) {
    case "otp_expired":
    case "flow_state_expired":
    case "flow_state_not_found":
      return "otp_expired";
    case "bad_code_verifier":
    case "pkce_code_verifier_not_found":
      return "link_other_browser";
    case "validation_failed":
    case "bad_json":
      return "link_invalid";
    case "over_request_rate_limit":
      return "too_many_attempts";
    case "request_timeout":
    case "hook_timeout":
    case "hook_timeout_after_retry":
      return "auth_unavailable";
    default:
      return "verify_failed";
  }
}

/**
 * Maps the error parameters Supabase appends to a redirect (`?error=…&error_code=…`) to our codes.
 * Returns null when there is no error in the parameters.
 */
export function authLinkErrorFromCallback(errorCode: string | undefined, error: string | undefined): AuthLinkErrorCode | null {
  if (!errorCode && !error) return null;
  switch (errorCode) {
    case "otp_expired":
    case "flow_state_expired":
    case "flow_state_not_found":
      return "otp_expired";
    case "bad_code_verifier":
      return "link_other_browser";
    case "over_request_rate_limit":
      return "too_many_attempts";
    case "validation_failed":
      return "link_invalid";
    default:
      return "verify_failed";
  }
}

// ---------------------------------------------------------------------------
// Password sign-in
// ---------------------------------------------------------------------------

/** Deliberately generic: never reveal whether the email or the password was wrong. */
export const INVALID_CREDENTIALS_MESSAGE = "Email or password is incorrect.";
export const TOO_MANY_SIGN_IN_ATTEMPTS_MESSAGE =
  "Too many sign-in attempts. Please wait a few minutes and try again.";
export const AUTH_UNAVAILABLE_MESSAGE =
  "The sign-in service is temporarily unavailable. Please try again in a moment.";

export interface SignInFailure {
  message: string;
  /** false for expected outcomes (wrong password, rate limit); true when worth logging server-side. */
  unexpected: boolean;
}

export function describeSignInError(error: unknown): SignInFailure {
  if (isAuthRetryableFetchError(error)) return { message: AUTH_UNAVAILABLE_MESSAGE, unexpected: true };
  const code = codeOf(error);
  switch (code) {
    case "invalid_credentials":
    // A banned account is reported like a wrong password so account state is never revealed.
    case "user_banned":
    case "user_not_found":
      return { message: INVALID_CREDENTIALS_MESSAGE, unexpected: false };
    case "email_not_confirmed":
      // Supabase only reports this after the password matched, so it reveals nothing to a guesser.
      return {
        message:
          "This account hasn’t been activated yet. Open your invitation email and choose a password there, or ask your administrator for a new invite.",
        unexpected: false,
      };
    case "over_request_rate_limit":
      return { message: TOO_MANY_SIGN_IN_ATTEMPTS_MESSAGE, unexpected: false };
    case "request_timeout":
      return { message: AUTH_UNAVAILABLE_MESSAGE, unexpected: true };
    default:
      break;
  }
  // Older Auth servers send a plain 400 without a code for wrong credentials.
  if (isAuthError(error) && code === undefined && error.status === 400) {
    return { message: INVALID_CREDENTIALS_MESSAGE, unexpected: false };
  }
  if (isAuthError(error) && error.status === 429) {
    return { message: TOO_MANY_SIGN_IN_ATTEMPTS_MESSAGE, unexpected: false };
  }
  return { message: "Sign-in failed because of an unexpected problem. Please try again.", unexpected: true };
}

// ---------------------------------------------------------------------------
// Password update (/reset-password)
// ---------------------------------------------------------------------------

export interface PasswordUpdateFailure {
  message: string;
  fieldErrors: FieldErrors;
  /** The session is gone: the user must open the email link again or sign in. */
  sessionEnded: boolean;
  unexpected: boolean;
}

const WEAK_REASON_TEXT: Record<string, string> = {
  length: "it is shorter than this site’s password policy requires",
  characters:
    "it doesn’t contain every required kind of character (for example lowercase and uppercase letters, digits and symbols)",
  pwned: "it appears in a list of passwords exposed in data breaches",
};

/** "This password isn't strong enough: it … and it …." */
export function describeWeakPasswordReasons(reasons: readonly string[]): string {
  const parts = [...new Set(reasons)].map((reason) => WEAK_REASON_TEXT[reason]).filter(Boolean);
  if (parts.length === 0) return "This password isn’t strong enough. Choose a longer, less common password.";
  return `This password isn’t strong enough: ${parts.join("; and ")}. Choose a different password.`;
}

export function describePasswordUpdateError(error: unknown): PasswordUpdateFailure {
  const base = { fieldErrors: {}, sessionEnded: false, unexpected: false };
  if (isAuthWeakPasswordError(error)) {
    const message = describeWeakPasswordReasons(error.reasons ?? []);
    return { ...base, message, fieldErrors: { password: message } };
  }
  if (isAuthSessionMissingError(error)) {
    return {
      ...base,
      sessionEnded: true,
      message: "Your session has ended. Open the link from your email again, or sign in and try again.",
    };
  }
  if (isAuthRetryableFetchError(error)) {
    return {
      ...base,
      unexpected: true,
      message: "The sign-in service is temporarily unavailable, so your password was not changed. Please try again.",
    };
  }
  switch (codeOf(error)) {
    case "weak_password": {
      const message = describeWeakPasswordReasons([]);
      return { ...base, message, fieldErrors: { password: message } };
    }
    case "same_password": {
      const message = "Your new password must be different from your current password.";
      return { ...base, message, fieldErrors: { password: message } };
    }
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return {
        ...base,
        message:
          "For security, changing a password requires a recent sign-in. Sign out and sign in again, then change it — or use “Forgot password?” on the sign-in page to get a reset link and choose the new password from there.",
      };
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
    case "bad_jwt":
    case "user_not_found":
      return {
        ...base,
        sessionEnded: true,
        message: "Your session has ended. Open the link from your email again, or sign in and try again.",
      };
    case "over_request_rate_limit":
      return { ...base, message: "Too many attempts. Please wait a few minutes and try again." };
    case "validation_failed":
      return {
        ...base,
        message: "The sign-in service rejected this password. Use 10 to 72 characters and try again.",
        fieldErrors: { password: "The sign-in service rejected this password." },
      };
    default:
      return { ...base, unexpected: true, message: "Your password could not be saved. Please try again." };
  }
}
