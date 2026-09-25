import { AuthApiError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_CTX, captureRedirect, formData, VENUE_CTX } from "./auth-mocks";
import { resetPassword, type ResetPasswordState } from "@/app/(auth)/reset-password/actions";
import { EnvError } from "@/lib/env";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  loadSessionContext: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("@/lib/auth/session", () => ({ loadSessionContext: mocks.loadSessionContext }));
vi.mock("next/navigation", async () => (await import("./auth-mocks")).mockNavigation());

const INITIAL: ResetPasswordState = { ok: false, message: null, fieldErrors: {} };
const updateUser = vi.fn();
const GOOD = "a long enough passphrase";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  mocks.createSupabaseServerClient.mockResolvedValue({ auth: { updateUser } });
  mocks.loadSessionContext.mockResolvedValue(VENUE_CTX);
  updateUser.mockResolvedValue({ data: { user: {} }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const submit = (password: string, confirmPassword = password) =>
  resetPassword(INITIAL, formData({ password, confirmPassword }));

describe("resetPassword", () => {
  it("requires a session and returns to /reset-password after logging in", async () => {
    mocks.loadSessionContext.mockResolvedValue(null);
    expect(await captureRedirect(() => submit(GOOD))).toBe("/login?next=%2Freset-password");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("answers in setup mode without touching Supabase", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const state = await submit(GOOD);
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/not configured/);
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("treats a configuration error from the client factory as setup mode", async () => {
    mocks.createSupabaseServerClient.mockRejectedValue(new EnvError("NEXT_PUBLIC_SUPABASE_URL", "missing"));
    expect((await submit(GOOD)).message).toMatch(/not configured/);
  });

  it("validates before calling Supabase and never echoes passwords", async () => {
    const state = await submit("short", "shorter");
    expect(state.ok).toBe(false);
    expect(state.fieldErrors).toMatchObject({ password: "Use at least 10 characters." });
    expect(state.fieldErrors.confirmPassword).toBeTruthy();
    expect(state.values).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("shorter");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("updates the password and sends venue users to /radio and admins to /admin", async () => {
    expect(await captureRedirect(() => submit(GOOD))).toBe("/radio");
    expect(updateUser).toHaveBeenCalledWith({ password: GOOD });
    mocks.loadSessionContext.mockResolvedValue(ADMIN_CTX);
    expect(await captureRedirect(() => submit(GOOD))).toBe("/admin");
  });

  it("explains weak passwords using Supabase's reasons", async () => {
    updateUser.mockResolvedValue({ data: { user: null }, error: new AuthWeakPasswordError("weak", 422, ["pwned"]) });
    const state = await submit(GOOD);
    expect(state.fieldErrors.password).toMatch(/data breaches/);
  });

  it("explains same-password and reauthentication errors", async () => {
    updateUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("same", 422, "same_password") });
    expect((await submit(GOOD)).fieldErrors.password).toMatch(/different/);
    updateUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("reauth", 400, "reauthentication_needed") });
    expect((await submit(GOOD)).message).toMatch(/recent sign-in/);
  });

  it("flags an ended session so the form can offer a new link", async () => {
    updateUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("gone", 403, "session_not_found") });
    const state = await submit(GOOD);
    expect(state.sessionEnded).toBe(true);
    expect(state.message).toMatch(/session has ended/);
  });

  it("reports a failed session lookup without changing anything", async () => {
    mocks.loadSessionContext.mockRejectedValue(new Error("db down"));
    const state = await submit(GOOD);
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/not changed/);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("does not claim success when updateUser throws", async () => {
    updateUser.mockRejectedValue(new Error("boom"));
    const state = await submit(GOOD);
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/could not be saved/);
  });
});
