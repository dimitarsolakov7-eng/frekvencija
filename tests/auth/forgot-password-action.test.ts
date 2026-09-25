import { AuthApiError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeHeaders, formData } from "./auth-mocks";
import { requestPasswordReset, type ResetRequestState } from "@/app/(auth)/forgot-password/actions";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  consumeRateLimit: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

const INITIAL: ResetRequestState = { ok: false, message: null, fieldErrors: {} };
const resetPasswordForEmail = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.headers.mockResolvedValue(fakeHeaders({ "x-forwarded-for": "198.51.100.4" }));
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, degraded: false });
  mocks.createSupabaseServerClient.mockResolvedValue({ auth: { resetPasswordForEmail } });
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://radio.example.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("CLIENT_IP_HEADER", "");
  vi.stubEnv("TRUSTED_PROXY_HOPS", "");
  vi.stubEnv("VERCEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const submit = (email: string) => requestPasswordReset(INITIAL, formData({ email }));

describe("requestPasswordReset", () => {
  it("sends the reset email with the site origin as redirect target", async () => {
    const state = await submit(" Owner@Example.com ");
    expect(resetPasswordForEmail).toHaveBeenCalledWith("owner@example.com", { redirectTo: "https://radio.example.com" });
    expect(state.ok).toBe(true);
    expect(state.message).toMatch(/If an account exists for owner@example\.com/);
    expect(state.message).toMatch(/expires/);
  });

  it("answers identically when Supabase reports an error (no account enumeration)", async () => {
    const neutral = await submit("owner@example.com");
    resetPasswordForEmail.mockResolvedValue({ data: null, error: new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit") });
    const afterError = await submit("owner@example.com");
    resetPasswordForEmail.mockRejectedValue(new Error("network down"));
    const afterThrow = await submit("owner@example.com");
    for (const state of [afterError, afterThrow]) {
      expect(state.ok).toBe(true);
      expect(state.message).toBe(neutral.message);
    }
  });

  it("answers identically without sending when the per-address limit is reached", async () => {
    const neutral = await submit("owner@example.com");
    resetPasswordForEmail.mockClear();
    mocks.consumeRateLimit.mockClear();
    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, degraded: false }) // IP
      .mockResolvedValueOnce({ allowed: false, reason: "limited" }); // email
    const limited = await submit("owner@example.com");
    expect(limited.message).toBe(neutral.message);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit.mock.calls.map(([options]) => options.key)).toEqual([
      "reset:ip:198.51.100.4",
      "reset:email:owner@example.com",
    ]);
  });

  it("checks the network, the address, then the cap across all visitors (60/hour, fail open)", async () => {
    await submit("owner@example.com");
    expect(mocks.consumeRateLimit.mock.calls.map(([options]) => options)).toEqual([
      { key: "reset:ip:198.51.100.4", max: 20, windowSeconds: 3600, failClosed: false },
      { key: "reset:email:owner@example.com", max: 5, windowSeconds: 3600, failClosed: false },
      { key: "reset:global", max: 60, windowSeconds: 3600, failClosed: false },
    ]);
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it("sends nothing once the global cap is reached, whatever the client IP (SEC-02)", async () => {
    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, degraded: false }) // IP
      .mockResolvedValueOnce({ allowed: true, degraded: false }) // email
      .mockResolvedValueOnce({ allowed: false, reason: "limited" }); // global
    const state = await submit("owner@example.com");
    expect(state).toMatchObject({ ok: false, values: { email: "owner@example.com" } });
    expect(state.message).toMatch(/unusually large number of reset requests/);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("keys the per-network bucket on the last X-Forwarded-For hop, not a forged first one", async () => {
    mocks.headers.mockResolvedValue(fakeHeaders({ "x-forwarded-for": "10.9.8.7, 198.51.100.4" }));
    await submit("owner@example.com");
    expect(mocks.consumeRateLimit.mock.calls[0]?.[0].key).toBe("reset:ip:198.51.100.4");
  });

  it("tells the network when it is sending too many requests", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "limited" });
    const state = await submit("owner@example.com");
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/Too many reset requests/);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("validates the email address", async () => {
    const state = await submit("nope");
    expect(state.ok).toBe(false);
    expect(state.fieldErrors.email).toBeTruthy();
    expect(state.values).toEqual({ email: "nope" });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("says so in setup mode instead of pretending an email was sent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const state = await submit("owner@example.com");
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/not configured/);
    expect(state.values).toEqual({ email: "owner@example.com" });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("reports a missing site URL in production instead of pretending an email was sent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    const state = await submit("owner@example.com");
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/isn’t available right now/);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
