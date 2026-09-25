import {
  AuthApiError,
  AuthPKCECodeVerifierMissingError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthWeakPasswordError,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  AUTH_LINK_ERROR_CODES,
  authLinkErrorCode,
  authLinkErrorFromCallback,
  describeAuthLinkError,
  describePasswordUpdateError,
  describeSignInError,
  describeWeakPasswordReasons,
  INVALID_CREDENTIALS_MESSAGE,
  TOO_MANY_SIGN_IN_ATTEMPTS_MESSAGE,
} from "@/app/(auth)/_lib/auth-errors";

const apiError = (code: string | undefined, status = 400) => new AuthApiError("server message", status, code);

describe("describeAuthLinkError", () => {
  it("explains an expired or used link with the next steps", () => {
    expect(describeAuthLinkError("otp_expired")?.message).toBe(
      "This link has expired or was already used. Ask your administrator for a new invite or use Forgot password.",
    );
  });

  it("has a title and message for every code /auth/confirm can emit", () => {
    for (const code of AUTH_LINK_ERROR_CODES) {
      const notice = describeAuthLinkError(code);
      expect(notice?.code).toBe(code);
      expect(notice?.title.length).toBeGreaterThan(0);
      expect(notice?.message.length).toBeGreaterThan(0);
    }
  });

  it("never renders unknown or attacker-supplied values", () => {
    expect(describeAuthLinkError("<script>alert(1)</script>")).toBeNull();
    expect(describeAuthLinkError("Your account was deleted, call 555-0100")).toBeNull();
    expect(describeAuthLinkError(undefined)).toBeNull();
    expect(describeAuthLinkError(["otp_expired"])?.code).toBe("otp_expired");
  });
});

describe("authLinkErrorCode", () => {
  it("maps verification failures by error code", () => {
    expect(authLinkErrorCode(apiError("otp_expired", 403))).toBe("otp_expired");
    expect(authLinkErrorCode(apiError("flow_state_expired"))).toBe("otp_expired");
    expect(authLinkErrorCode(apiError("flow_state_not_found", 404))).toBe("otp_expired");
    expect(authLinkErrorCode(apiError("bad_code_verifier"))).toBe("link_other_browser");
    expect(authLinkErrorCode(new AuthPKCECodeVerifierMissingError())).toBe("link_other_browser");
    expect(authLinkErrorCode(apiError("validation_failed"))).toBe("link_invalid");
    expect(authLinkErrorCode(apiError("over_request_rate_limit", 429))).toBe("too_many_attempts");
    expect(authLinkErrorCode(new AuthRetryableFetchError("fetch failed", 0))).toBe("auth_unavailable");
    expect(authLinkErrorCode(apiError("something_new"))).toBe("verify_failed");
    expect(authLinkErrorCode(new Error("boom"))).toBe("verify_failed");
  });
});

describe("authLinkErrorFromCallback", () => {
  it("returns null without error parameters and maps known callback codes", () => {
    expect(authLinkErrorFromCallback(undefined, undefined)).toBeNull();
    expect(authLinkErrorFromCallback("otp_expired", "access_denied")).toBe("otp_expired");
    expect(authLinkErrorFromCallback(undefined, "access_denied")).toBe("verify_failed");
  });
});

describe("describeSignInError", () => {
  it("uses one generic message for wrong email, wrong password and account state", () => {
    expect(describeSignInError(apiError("invalid_credentials"))).toEqual({
      message: INVALID_CREDENTIALS_MESSAGE,
      unexpected: false,
    });
    expect(describeSignInError(apiError("user_banned")).message).toBe(INVALID_CREDENTIALS_MESSAGE);
    // Legacy servers: 400 without a code.
    expect(describeSignInError(apiError(undefined, 400)).message).toBe(INVALID_CREDENTIALS_MESSAGE);
  });

  it("explains an unconfirmed account (only reported after the password matched)", () => {
    expect(describeSignInError(apiError("email_not_confirmed")).message).toMatch(/hasn’t been activated/);
  });

  it("reports rate limits and outages honestly", () => {
    expect(describeSignInError(apiError("over_request_rate_limit", 429)).message).toBe(TOO_MANY_SIGN_IN_ATTEMPTS_MESSAGE);
    expect(describeSignInError(apiError(undefined, 429)).message).toBe(TOO_MANY_SIGN_IN_ATTEMPTS_MESSAGE);
    const outage = describeSignInError(new AuthRetryableFetchError("fetch failed", 0));
    expect(outage.unexpected).toBe(true);
    expect(outage.message).toMatch(/temporarily unavailable/);
  });

  it("does not blame the password for unknown failures", () => {
    const unknown = describeSignInError(apiError("unexpected_failure", 500));
    expect(unknown.message).not.toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(unknown.unexpected).toBe(true);
  });
});

describe("describePasswordUpdateError", () => {
  it("lists weak-password reasons on the password field", () => {
    const result = describePasswordUpdateError(new AuthWeakPasswordError("weak", 422, ["length", "pwned"]));
    expect(result.fieldErrors.password).toBe(result.message);
    expect(result.message).toMatch(/shorter than/);
    expect(result.message).toMatch(/data breaches/);
    expect(result.sessionEnded).toBe(false);
  });

  it("asks for a different password when it did not change", () => {
    const result = describePasswordUpdateError(apiError("same_password", 422));
    expect(result.fieldErrors.password).toMatch(/different from your current password/);
  });

  it("explains reauthentication requirements", () => {
    const result = describePasswordUpdateError(apiError("reauthentication_needed", 400));
    expect(result.message).toMatch(/recent sign-in/);
    expect(result.message).toMatch(/Forgot password/);
    expect(result.fieldErrors).toEqual({});
  });

  it("flags an ended session so the form can offer to sign in", () => {
    expect(describePasswordUpdateError(new AuthSessionMissingError()).sessionEnded).toBe(true);
    expect(describePasswordUpdateError(apiError("session_not_found", 403)).sessionEnded).toBe(true);
  });

  it("marks outages and unknown errors as unexpected without claiming success", () => {
    expect(describePasswordUpdateError(new AuthRetryableFetchError("down", 503)).unexpected).toBe(true);
    const unknown = describePasswordUpdateError(new Error("boom"));
    expect(unknown.unexpected).toBe(true);
    expect(unknown.message).toMatch(/could not be saved/);
  });
});

describe("describeWeakPasswordReasons", () => {
  it("falls back to generic advice without reasons and de-duplicates", () => {
    expect(describeWeakPasswordReasons([])).toMatch(/isn’t strong enough/);
    const message = describeWeakPasswordReasons(["characters", "characters"]);
    expect(message.match(/required kind of character/g)).toHaveLength(1);
  });
});
