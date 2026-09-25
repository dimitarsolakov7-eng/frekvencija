import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_CTX, captureRedirect, fakeHeaders, formData, VENUE_CTX } from "./auth-mocks";
import { INVALID_CREDENTIALS_MESSAGE, TOO_MANY_SIGN_IN_ATTEMPTS_MESSAGE } from "@/app/(auth)/_lib/auth-errors";
import { signIn, type SignInState } from "@/app/(auth)/login/actions";
import { EnvError } from "@/lib/env";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  consumeRateLimit: vi.fn(),
  loadSessionContext: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/auth/session", () => ({ loadSessionContext: mocks.loadSessionContext }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", async () => (await import("./auth-mocks")).mockNavigation());

const INITIAL: SignInState = { ok: false, message: null, fieldErrors: {} };
const signInWithPassword = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // The client forged the first hop; the proxy in front of the app appended the address it saw.
  mocks.headers.mockResolvedValue(fakeHeaders({ "x-forwarded-for": "10.9.8.7, 203.0.113.7" }));
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, degraded: false });
  mocks.createSupabaseServerClient.mockResolvedValue({ auth: { signInWithPassword } });
  signInWithPassword.mockResolvedValue({ data: { user: { id: ADMIN_CTX.userId }, session: {} }, error: null });
  mocks.loadSessionContext.mockResolvedValue(ADMIN_CTX);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("CLIENT_IP_HEADER", "");
  vi.stubEnv("TRUSTED_PROXY_HOPS", "");
  vi.stubEnv("VERCEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const submit = (entries: Record<string, string>) => signIn(INITIAL, formData(entries));

describe("signIn", () => {
  it("validates input without calling Supabase and echoes the email only", async () => {
    const state = await submit({ email: "not-an-email", password: "" });
    expect(state.ok).toBe(false);
    expect(state.fieldErrors.email).toBeTruthy();
    expect(state.fieldErrors.password).toBe("Enter your password.");
    expect(state.values).toEqual({ email: "not-an-email" });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("rate-limits per lowercased email and per client IP, failing open", async () => {
    await captureRedirect(() => submit({ email: " Venue@Example.COM ", password: "secret-password" }));
    const calls = mocks.consumeRateLimit.mock.calls.map(([options]) => options);
    expect(calls).toEqual([
      { key: "login:email:venue@example.com", max: 10, windowSeconds: 600, failClosed: false },
      { key: "login:ip:203.0.113.7", max: 50, windowSeconds: 600, failClosed: false },
    ]);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "venue@example.com", password: "secret-password" });
  });

  it("keys the per-IP bucket on the trusted proxy's entry when TRUSTED_PROXY_HOPS is set", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    mocks.headers.mockResolvedValue(fakeHeaders({ "x-forwarded-for": "10.9.8.7, 203.0.113.7, 192.0.2.10" }));
    await captureRedirect(() => submit({ email: "venue@example.com", password: "secret-password" }));
    expect(mocks.consumeRateLimit.mock.calls[1]?.[0].key).toBe("login:ip:203.0.113.7");
  });

  it("stops with a friendly message when either limit is reached", async () => {
    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, degraded: false })
      .mockResolvedValueOnce({ allowed: false, reason: "limited" });
    const state = await submit({ email: "venue@example.com", password: "secret-password" });
    expect(state).toMatchObject({ ok: false, message: TOO_MANY_SIGN_IN_ATTEMPTS_MESSAGE, values: { email: "venue@example.com" } });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("uses one generic message for wrong credentials and keeps the email", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    });
    const state = await submit({ email: "venue@example.com", password: "wrong-password" });
    expect(state.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(state.values).toEqual({ email: "venue@example.com" });
    expect(JSON.stringify(state)).not.toContain("wrong-password");
    expect(typeof state.nonce).toBe("number");
  });

  it("reports an unreachable auth service honestly", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: new AuthRetryableFetchError("fetch failed", 0) });
    const state = await submit({ email: "venue@example.com", password: "secret-password" });
    expect(state.message).toMatch(/temporarily unavailable/);
  });

  it("answers in setup mode without touching the limiter or Supabase", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const state = await submit({ email: "venue@example.com", password: "secret-password" });
    expect(state).toMatchObject({ ok: false, values: { email: "venue@example.com" } });
    expect(state.message).toMatch(/not configured/);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("explains a missing configuration", async () => {
    mocks.createSupabaseServerClient.mockRejectedValue(new EnvError("NEXT_PUBLIC_SUPABASE_URL", "missing"));
    const state = await submit({ email: "venue@example.com", password: "secret-password" });
    expect(state.message).toMatch(/not configured/);
  });

  it("follows a safe next path for the right role", async () => {
    const url = await captureRedirect(() => submit({ email: "admin@example.com", password: "secret-password", next: "/admin/music" }));
    expect(url).toBe("/admin/music");
  });

  it("sends venue users home instead of into the admin area or to an external site", async () => {
    mocks.loadSessionContext.mockResolvedValue(VENUE_CTX);
    expect(await captureRedirect(() => submit({ email: "venue@example.com", password: "secret-password", next: "/admin" }))).toBe("/radio");
    expect(
      await captureRedirect(() => submit({ email: "venue@example.com", password: "secret-password", next: "https://evil.example" })),
    ).toBe("/radio");
  });

  it("never redirects to another site through a dot-segment next (SEC-01)", async () => {
    for (const next of ["/.//evil.example/login", "/%2e//evil.example", "/%2e%2e//evil.example", "/a/..//evil.example"]) {
      mocks.loadSessionContext.mockResolvedValue(VENUE_CTX);
      expect(await captureRedirect(() => submit({ email: "venue@example.com", password: "secret-password", next }))).toBe("/radio");
      mocks.loadSessionContext.mockResolvedValue(ADMIN_CTX);
      expect(await captureRedirect(() => submit({ email: "admin@example.com", password: "secret-password", next }))).toBe("/admin");
    }
  });

  it("falls back to the start page when the role cannot be read", async () => {
    mocks.loadSessionContext.mockRejectedValue(new Error("profile query failed"));
    expect(await captureRedirect(() => submit({ email: "admin@example.com", password: "secret-password" }))).toBe("/");
  });
});
