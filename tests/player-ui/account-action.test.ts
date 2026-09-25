import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendAccountPasswordReset } from "@/app/(venue)/account/actions";

const mocks = vi.hoisted(() => ({
  requireBusinessUserPage: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  consumeRateLimit: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireBusinessUserPage: mocks.requireBusinessUserPage }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));

const resetPasswordForEmail = vi.fn();

function fakeHeaders(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.requireBusinessUserPage.mockResolvedValue({
    userId: "user-1",
    email: "Manager@EmeraldBar.example",
    role: "business_user",
    business: { id: "biz-1", name: "EmeraldBar", stationName: "EmeraldBar Radio", isActive: true },
  });
  mocks.headers.mockResolvedValue(fakeHeaders({ "x-forwarded-for": "198.51.100.4" }));
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, degraded: false });
  mocks.createSupabaseServerClient.mockResolvedValue({ auth: { resetPasswordForEmail } });
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://frekvencija.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendAccountPasswordReset", () => {
  it("emails the signed-in user's own address (never a submitted one) with the site origin as redirect", async () => {
    const state = await sendAccountPasswordReset();
    expect(mocks.requireBusinessUserPage).toHaveBeenCalledWith("/account");
    expect(resetPasswordForEmail).toHaveBeenCalledWith("manager@emeraldbar.example", { redirectTo: "https://frekvencija.example" });
    expect(state.ok).toBe(true);
    expect(state.message).toMatch(/manager@emeraldbar\.example/);
    expect(state.message).toMatch(/expires after about an hour/);
  });

  it("uses the Forgot password rate-limit buckets (per IP, then per email)", async () => {
    await sendAccountPasswordReset();
    const keys = mocks.consumeRateLimit.mock.calls.map((call) => (call[0] as { key: string }).key);
    expect(keys).toEqual(["reset:ip:198.51.100.4", "reset:email:manager@emeraldbar.example"]);
  });

  it("stops at the rate limits without calling Supabase", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "limited" });
    const byIp = await sendAccountPasswordReset();
    expect(byIp).toMatchObject({ ok: false, message: expect.stringMatching(/too many reset requests/i) });

    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: true, degraded: false }).mockResolvedValueOnce({ allowed: false, reason: "limited" });
    const byEmail = await sendAccountPasswordReset();
    expect(byEmail).toMatchObject({ ok: false, message: expect.stringMatching(/wait up to an hour/i) });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("stays neutral when Supabase reports an error or throws", async () => {
    const neutral = await sendAccountPasswordReset();
    resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: { code: "over_email_send_rate_limit", status: 429 } });
    const afterError = await sendAccountPasswordReset();
    resetPasswordForEmail.mockRejectedValueOnce(new Error("network down"));
    const afterThrow = await sendAccountPasswordReset();
    for (const state of [afterError, afterThrow]) {
      expect(state.ok).toBe(true);
      expect(state.message).toBe(neutral.message);
    }
  });

  it("answers honestly when the service is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const state = await sendAccountPasswordReset();
    expect(state).toMatchObject({ ok: false, message: expect.stringMatching(/not configured/i) });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("refuses accounts without an email address", async () => {
    mocks.requireBusinessUserPage.mockResolvedValueOnce({ userId: "u", email: "", role: "business_user", business: null });
    const state = await sendAccountPasswordReset();
    expect(state).toMatchObject({ ok: false, message: expect.stringMatching(/no email address/i) });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
