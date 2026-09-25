/**
 * Parsing of the /auth/confirm link parameters (pure). The same parser runs on the page's
 * searchParams and again inside the Server Action on the submitted hidden fields, because hidden
 * fields are user input too.
 */
import { safeNextPath } from "@/lib/auth/redirects";
import { authLinkErrorFromCallback, type AuthLinkErrorCode } from "./auth-errors";

/** Email link types this app sends (invite / recovery) or may receive from other templates. */
export const CONFIRM_OTP_TYPES = ["invite", "recovery", "email", "magiclink"] as const;
export type ConfirmOtpType = (typeof CONFIRM_OTP_TYPES)[number];

export type ConfirmRequest =
  | { kind: "otp"; tokenHash: string; type: ConfirmOtpType; next: string }
  /** PKCE code (same-browser flows). `next` is null when the link did not name one. */
  | { kind: "code"; code: string; flowId: string | null; next: string | null }
  | { kind: "error"; errorCode: AuthLinkErrorCode }
  | { kind: "invalid" };

/** Token hashes are hex digests, optionally prefixed with "pkce_". */
const TOKEN_PATTERN = /^[A-Za-z0-9_.-]{8,512}$/;
/** Auth codes are UUIDs; accept any compact URL-safe token. */
const CODE_PATTERN = /^[A-Za-z0-9_.-]{8,512}$/;
/** Same rule as auth-js PKCE_FLOW_ID_PATTERN. */
const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

type ParamSource = Record<string, unknown>;

function readParam(source: ParamSource, key: string): string | undefined {
  const raw = source[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function isConfirmOtpType(value: unknown): value is ConfirmOtpType {
  return typeof value === "string" && (CONFIRM_OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Invite and recovery links end on /reset-password (where the user chooses a password); other link
 * types go to the homepage. An explicit safe `next` in the link always wins, so older email templates
 * with `next=/set-password` keep working (that page permanently redirects to /reset-password).
 */
export function defaultConfirmDestination(type: ConfirmOtpType | "recovery-code" | null): string {
  return type === "invite" || type === "recovery" || type === "recovery-code" ? "/reset-password" : "/";
}

export function parseConfirmParams(source: ParamSource): ConfirmRequest {
  const callbackError = authLinkErrorFromCallback(readParam(source, "error_code"), readParam(source, "error"));
  const tokenHash = readParam(source, "token_hash");
  const code = readParam(source, "code");

  if (callbackError && !tokenHash && !code) return { kind: "error", errorCode: callbackError };

  const nextRaw = readParam(source, "next");
  if (tokenHash !== undefined) {
    const type = readParam(source, "type");
    if (!TOKEN_PATTERN.test(tokenHash) || !isConfirmOtpType(type)) return { kind: "invalid" };
    return { kind: "otp", tokenHash, type, next: safeNextPath(nextRaw, defaultConfirmDestination(type)) };
  }

  if (code !== undefined) {
    if (!CODE_PATTERN.test(code)) return { kind: "invalid" };
    const flowId = readParam(source, "sb_flow_id");
    const next = nextRaw === undefined ? "" : safeNextPath(nextRaw, "");
    return {
      kind: "code",
      code,
      flowId: flowId && FLOW_ID_PATTERN.test(flowId) ? flowId : null,
      next: next === "" ? null : next,
    };
  }

  return { kind: "invalid" };
}

/** Parameters the homepage forwards to /auth/confirm when an email link lands on "/". */
export const CONFIRM_FORWARD_PARAMS = [
  "token_hash",
  "type",
  "next",
  "code",
  "sb_flow_id",
  "error",
  "error_code",
] as const;

/**
 * Query string for /auth/confirm when an auth callback landed on the homepage (e.g. an email
 * template that points at the site root), or null when there is nothing to forward.
 */
export function confirmForwardQuery(source: ParamSource): string | null {
  const params = new URLSearchParams();
  for (const key of CONFIRM_FORWARD_PARAMS) {
    const value = readParam(source, key);
    if (value !== undefined && value.length <= 2048) params.set(key, value);
  }
  if (!params.has("token_hash") && !params.has("code") && !params.has("error_code") && !params.has("error")) {
    return null;
  }
  return params.toString();
}

export interface ConfirmPurpose {
  title: string;
  description: string;
  buttonLabel: string;
}

export function describeConfirmPurpose(request: ConfirmRequest): ConfirmPurpose {
  if (request.kind === "otp") {
    switch (request.type) {
      case "invite":
        return {
          title: "Accept your invitation",
          description: "Continue to activate your account. Next, you’ll choose your own password.",
          buttonLabel: "Continue",
        };
      case "recovery":
        return {
          title: "Reset your password",
          description: "Continue to confirm it’s you. Next, you’ll choose a new password.",
          buttonLabel: "Continue",
        };
      case "email":
        return {
          title: "Confirm your email address",
          description: "Continue to confirm this email address for your account.",
          buttonLabel: "Continue",
        };
      case "magiclink":
        return {
          title: "Sign in",
          description: "Continue to sign in with this one-time link.",
          buttonLabel: "Continue",
        };
    }
  }
  return {
    title: "Continue signing in",
    description: "Continue to finish signing in with this link.",
    buttonLabel: "Continue",
  };
}
