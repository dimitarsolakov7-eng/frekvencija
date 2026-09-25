import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureRedirect, formData } from "./auth-mocks";
import { confirmEmailLink } from "@/app/auth/confirm/actions";

const mocks = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("next/navigation", async () => (await import("./auth-mocks")).mockNavigation());

const HASH = "0123456789abcdef0123456789abcdef0123456789abcdef01234567";
const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.createSupabaseServerClient.mockResolvedValue({ auth: { verifyOtp, exchangeCodeForSession } });
  verifyOtp.mockResolvedValue({ data: { user: {}, session: {} }, error: null });
  exchangeCodeForSession.mockResolvedValue({ data: { user: {}, session: {}, redirectType: null }, error: null });
});

const confirm = (entries: Record<string, string>) => captureRedirect(() => confirmEmailLink(formData(entries)));

describe("confirmEmailLink", () => {
  it("verifies an invite token and continues to /reset-password", async () => {
    expect(await confirm({ token_hash: HASH, type: "invite", next: "/reset-password" })).toBe("/reset-password");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: HASH });
  });

  it("keeps honouring an explicit next=/set-password from older email templates", async () => {
    expect(await confirm({ token_hash: HASH, type: "invite", next: "/set-password" })).toBe("/set-password");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: HASH });
  });

  it("uses the type's default destination when next is unsafe", async () => {
    expect(await confirm({ token_hash: HASH, type: "recovery", next: "https://evil.example" })).toBe("/reset-password");
    expect(await confirm({ token_hash: HASH, type: "email", next: "//evil.example" })).toBe("/");
  });

  it("never continues to another site through a dot-segment next (SEC-01)", async () => {
    for (const next of ["/.//evil.example", "/%2e//evil.example", "/%2e%2e//evil.example", "/a/..//evil.example"]) {
      expect(await confirm({ token_hash: HASH, type: "recovery", next })).toBe("/reset-password");
      expect(await confirm({ token_hash: HASH, type: "magiclink", next })).toBe("/");
      expect(await confirm({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225", next })).toBe("/");
    }
  });

  it("sends expired or used links to /login with an explanation code", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: new AuthApiError("expired", 403, "otp_expired") });
    expect(await confirm({ token_hash: HASH, type: "invite" })).toBe("/login?error=otp_expired");
  });

  it("maps an unreachable auth service", async () => {
    verifyOtp.mockRejectedValue(new AuthRetryableFetchError("fetch failed", 0));
    expect(await confirm({ token_hash: HASH, type: "invite" })).toBe("/login?error=auth_unavailable");
  });

  it("rejects tampered hidden fields without calling Supabase", async () => {
    expect(await confirm({ token_hash: HASH, type: "signup" })).toBe("/login?error=link_invalid");
    expect(await confirm({ token_hash: "bad token!", type: "invite" })).toBe("/login?error=link_invalid");
    expect(await confirm({})).toBe("/login?error=link_invalid");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("exchanges a PKCE code (with flow id) and routes recovery codes to /reset-password", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: {}, session: {}, redirectType: "recovery" }, error: null });
    expect(await confirm({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225", sb_flow_id: "abcdef0123456789" })).toBe("/reset-password");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("34e770dd-9ff9-416c-87fa-43b31d7ef225", { flowId: "abcdef0123456789" });
  });

  it("sends other code sign-ins to the start page or their safe next", async () => {
    expect(await confirm({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225" })).toBe("/");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("34e770dd-9ff9-416c-87fa-43b31d7ef225", undefined);
    expect(await confirm({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225", next: "/account" })).toBe("/account");
  });

  it("explains a code opened in another browser", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null, session: null, redirectType: null },
      error: new AuthApiError("verifier missing", 400, "pkce_code_verifier_not_found"),
    });
    expect(await confirm({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225" })).toBe("/login?error=link_other_browser");
  });
});
