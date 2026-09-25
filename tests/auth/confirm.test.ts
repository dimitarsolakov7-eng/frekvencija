import { describe, expect, it } from "vitest";
import {
  confirmForwardQuery,
  defaultConfirmDestination,
  describeConfirmPurpose,
  parseConfirmParams,
} from "@/app/(auth)/_lib/confirm";

const HASH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";

describe("parseConfirmParams", () => {
  it("parses an invite link and defaults to /reset-password", () => {
    expect(parseConfirmParams({ token_hash: HASH, type: "invite" })).toEqual({
      kind: "otp",
      tokenHash: HASH,
      type: "invite",
      next: "/reset-password",
    });
  });

  it("accepts every supported link type with the right default destination", () => {
    expect(parseConfirmParams({ token_hash: HASH, type: "recovery" })).toMatchObject({ next: "/reset-password" });
    expect(parseConfirmParams({ token_hash: HASH, type: "email" })).toMatchObject({ next: "/" });
    expect(parseConfirmParams({ token_hash: HASH, type: "magiclink" })).toMatchObject({ next: "/" });
  });

  it("accepts PKCE-prefixed token hashes", () => {
    expect(parseConfirmParams({ token_hash: `pkce_${HASH}`, type: "recovery" })).toMatchObject({ kind: "otp" });
  });

  it("honours a safe next and rejects unsafe ones", () => {
    expect(parseConfirmParams({ token_hash: HASH, type: "invite", next: "/set-password?welcome=1" })).toMatchObject({
      next: "/set-password?welcome=1",
    });
    expect(parseConfirmParams({ token_hash: HASH, type: "invite", next: "https://evil.example" })).toMatchObject({
      next: "/reset-password",
    });
    expect(parseConfirmParams({ token_hash: HASH, type: "recovery", next: "//evil.example" })).toMatchObject({
      next: "/reset-password",
    });
    // Older email templates name the former page explicitly; it permanently redirects to /reset-password.
    expect(parseConfirmParams({ token_hash: HASH, type: "recovery", next: "/set-password" })).toMatchObject({
      next: "/set-password",
    });
  });

  it.each(["/.//evil.example", "/%2e//evil.example", "/%2e%2e//evil.example", "/a/..//evil.example"])(
    "replaces next=%j (normalises to a protocol-relative URL) with the type's default (SEC-01)",
    (next) => {
      for (const type of ["invite", "recovery", "email", "magiclink"] as const) {
        expect(parseConfirmParams({ token_hash: HASH, type, next })).toEqual({
          kind: "otp",
          tokenHash: HASH,
          type,
          next: defaultConfirmDestination(type),
        });
      }
      expect(parseConfirmParams({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225", next })).toMatchObject({ kind: "code", next: null });
    },
  );

  it("rejects unsupported types and malformed tokens", () => {
    expect(parseConfirmParams({ token_hash: HASH, type: "signup" })).toEqual({ kind: "invalid" });
    expect(parseConfirmParams({ token_hash: HASH, type: "email_change" })).toEqual({ kind: "invalid" });
    expect(parseConfirmParams({ token_hash: HASH })).toEqual({ kind: "invalid" });
    expect(parseConfirmParams({ token_hash: "abc def", type: "invite" })).toEqual({ kind: "invalid" });
    expect(parseConfirmParams({ token_hash: "<script>", type: "invite" })).toEqual({ kind: "invalid" });
    expect(parseConfirmParams({ token_hash: "x".repeat(600), type: "invite" })).toEqual({ kind: "invalid" });
    expect(parseConfirmParams({})).toEqual({ kind: "invalid" });
  });

  it("parses a PKCE code with an optional flow id and next", () => {
    expect(parseConfirmParams({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225" })).toEqual({
      kind: "code",
      code: "34e770dd-9ff9-416c-87fa-43b31d7ef225",
      flowId: null,
      next: null,
    });
    expect(
      parseConfirmParams({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225", sb_flow_id: "abcdef0123456789", next: "/account" }),
    ).toMatchObject({ flowId: "abcdef0123456789", next: "/account" });
    expect(parseConfirmParams({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225", sb_flow_id: "bad id!" })).toMatchObject({
      flowId: null,
    });
    expect(parseConfirmParams({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225", next: "//evil" })).toMatchObject({ next: null });
  });

  it("turns Supabase callback errors into our codes", () => {
    expect(parseConfirmParams({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid" })).toEqual({
      kind: "error",
      errorCode: "otp_expired",
    });
    expect(parseConfirmParams({ error: "server_error" })).toEqual({ kind: "error", errorCode: "verify_failed" });
  });

  it("reads the first value of repeated parameters and FormData-like values", () => {
    expect(parseConfirmParams({ token_hash: [HASH, "other"], type: ["invite"] })).toMatchObject({ kind: "otp", tokenHash: HASH });
    expect(parseConfirmParams({ token_hash: `  ${HASH}  `, type: "invite", next: null })).toMatchObject({ tokenHash: HASH });
  });
});

describe("defaultConfirmDestination", () => {
  it("sends password flows to /reset-password", () => {
    expect(defaultConfirmDestination("invite")).toBe("/reset-password");
    expect(defaultConfirmDestination("recovery")).toBe("/reset-password");
    expect(defaultConfirmDestination("recovery-code")).toBe("/reset-password");
    expect(defaultConfirmDestination("email")).toBe("/");
    expect(defaultConfirmDestination(null)).toBe("/");
  });
});

describe("confirmForwardQuery", () => {
  it("forwards only auth callback parameters", () => {
    const query = confirmForwardQuery({ token_hash: HASH, type: "recovery", next: "/reset-password", utm_source: "mail" });
    expect(query).not.toBeNull();
    const params = new URLSearchParams(query ?? "");
    expect(params.get("token_hash")).toBe(HASH);
    expect(params.get("type")).toBe("recovery");
    expect(params.has("utm_source")).toBe(false);
  });

  it("returns null when there is nothing to confirm", () => {
    expect(confirmForwardQuery({})).toBeNull();
    expect(confirmForwardQuery({ next: "/admin", type: "invite" })).toBeNull();
  });

  it("forwards codes and callback errors", () => {
    expect(confirmForwardQuery({ code: "abc12345" })).toBe("code=abc12345");
    expect(confirmForwardQuery({ error: "access_denied", error_code: "otp_expired" })).toBe("error=access_denied&error_code=otp_expired");
  });
});

describe("describeConfirmPurpose", () => {
  it("words the page for the link type", () => {
    expect(describeConfirmPurpose({ kind: "otp", tokenHash: HASH, type: "invite", next: "/reset-password" }).title).toBe(
      "Accept your invitation",
    );
    expect(describeConfirmPurpose({ kind: "otp", tokenHash: HASH, type: "recovery", next: "/reset-password" }).title).toBe(
      "Reset your password",
    );
    expect(describeConfirmPurpose({ kind: "code", code: "abc12345", flowId: null, next: null }).buttonLabel).toBe("Continue");
  });
});
