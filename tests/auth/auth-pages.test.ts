/**
 * Server-render tests for the redesigned auth pages (screen 02 form system): copy, accessible structure,
 * the signed-in redirects, the expired-link recovery path and setup mode.
 */
import { createElement as h, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_CTX, captureRedirect, captureRedirectSignal, VENUE_CTX } from "./auth-mocks";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import AuthLayout from "@/app/(auth)/layout";
import LoginPage from "@/app/(auth)/login/page";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import SetPasswordPage from "@/app/(auth)/set-password/page";
import ConfirmPage from "@/app/auth/confirm/page";
import { SessionLookupError } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSessionContext: mocks.getSessionContext,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getClaims: mocks.getClaims } })),
}));
vi.mock("next/navigation", async () => (await import("./auth-mocks")).mockNavigation());

const render = (element: ReactElement) => renderToString(element);
const props = (searchParams: Record<string, string | string[]> = {}) => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve(searchParams),
});

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  mocks.getSessionContext.mockResolvedValue(null);
  mocks.getClaims.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth layout (split photo/form shell)", () => {
  it("renders the photo panel copy, the logo home link, the main landmark and the domain footer", () => {
    const html = render(h(AuthLayout, { params: Promise.resolve({}), children: h("p", null, "form") }));
    expect(html.indexOf('href="#main-content"')).toBeLessThan(html.indexOf("<main"));
    expect(html).toMatch(/<main[^>]*id="main-content"/);
    expect(html).toContain('aria-label="Frekvencija home"');
    expect(html).toContain("Your atmosphere.");
    expect(html).toContain("One click away.");
    expect(html).toContain("Sign in and let your station take over.");
    expect(html).toContain("frekvencija.online");
    expect(html).toContain("venue-hero.jpg");
  });
});

describe("login page", () => {
  it("matches screen 02: heading, labelled fields, forgot link, Log in, request-access link", async () => {
    const html = render(await LoginPage(props({ next: "/admin/music" })));
    expect(html).toContain("Welcome back");
    expect(html).toMatch(/<h1[^>]*>Log in to your station<\/h1>/);
    expect(html).toContain("Use the account provided for your business.");
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Email address/);
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Password/);
    expect(html).toContain('placeholder="you@yourbusiness.com"');
    expect(html).toMatch(/autocomplete="username"/i);
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('href="/forgot-password"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*Log in/);
    expect(html).toContain("Need an account?");
    expect(html).toContain('href="/request-access"');
    expect(html).toContain('name="next" value="/admin/music"');
  });

  it("explains expired links and offers a new one; session_expired gets no link action", async () => {
    const expired = render(await LoginPage(props({ error: "otp_expired" })));
    expect(expired).toContain("This link has expired or was already used.");
    expect(expired).toContain("Request a new link");

    const session = render(await LoginPage(props({ error: "session_expired" })));
    expect(session).toContain("Your session has ended");
    expect(session).not.toContain("Request a new link");
  });

  it("never renders hostile parameters", async () => {
    const html = render(await LoginPage(props({ next: "//evil.example", error: "<b>pwned</b>" })));
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("pwned");
  });

  it("sends a signed-in user to their role home (honouring a safe next for their area)", async () => {
    configure();
    mocks.getSessionContext.mockResolvedValue(ADMIN_CTX);
    expect(await captureRedirect(() => LoginPage(props()))).toBe("/admin");
    expect(await captureRedirect(() => LoginPage(props({ next: "/admin/music" })))).toBe("/admin/music");
    mocks.getSessionContext.mockResolvedValue(VENUE_CTX);
    expect(await captureRedirect(() => LoginPage(props({ next: "/admin" })))).toBe("/radio");
  });

  it("never bounces a signed-in user to another site through dot segments (SEC-01)", async () => {
    configure();
    for (const next of ["/.//evil.example/login", "/%2e//evil.example", "/%2e%2e//evil.example", "/a/..//evil.example"]) {
      mocks.getSessionContext.mockResolvedValue(ADMIN_CTX);
      expect(await captureRedirect(() => LoginPage(props({ next })))).toBe("/admin");
      mocks.getSessionContext.mockResolvedValue(VENUE_CTX);
      expect(await captureRedirect(() => LoginPage(props({ next })))).toBe("/radio");
    }
  });

  it("does not carry a dot-segment redirect into the sign-in form", async () => {
    for (const next of ["/.//evil.example/login", "/%2e%2e//evil.example", "/a/..//evil.example"]) {
      const html = render(await LoginPage(props({ next })));
      expect(html).not.toContain("evil.example");
      expect(html).not.toContain('name="next"');
    }
  });

  it("shows the form when the session cannot be resolved", async () => {
    configure();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.getSessionContext.mockRejectedValue(new SessionLookupError("profile_missing", "gone"));
    const html = render(await LoginPage(props()));
    expect(html).toContain("Log in to your station");
  });

  it("renders in setup mode without looking up a session", async () => {
    const html = render(await LoginPage(props()));
    expect(html).toContain("Log in to your station");
    expect(mocks.getSessionContext).not.toHaveBeenCalled();
  });
});

describe("forgot password page", () => {
  it("explains expiry, labels the email field and links back to log in", async () => {
    const html = render(await ForgotPasswordPage());
    expect(html).toMatch(/<h1[^>]*>Forgot your password\?<\/h1>/);
    expect(html).toContain("expires after about an hour");
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Email address/);
    expect(html).toContain('href="/login"');
    expect(html).toContain('type="email"');
    expect(html).toContain("Send reset link");
  });

  it("sends a signed-in user to their role home", async () => {
    configure();
    mocks.getSessionContext.mockResolvedValue(VENUE_CTX);
    expect(await captureRedirect(() => ForgotPasswordPage())).toBe("/radio");
  });
});

describe("reset password page", () => {
  it("renders in setup mode (its action explains the service is not configured)", async () => {
    const html = render(await ResetPasswordPage());
    expect(html).toContain("Choose a new password");
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>New password/);
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Confirm new password/);
    expect(html).not.toMatch(/autocomplete="username"/i);
  });

  it("requires a session when configured", async () => {
    configure();
    expect(await captureRedirect(() => ResetPasswordPage())).toBe("/login?next=%2Freset-password");
  });

  it("words the page by how the user arrived and offers the password manager the account", async () => {
    configure();
    mocks.getSessionContext.mockResolvedValue(VENUE_CTX);
    mocks.getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "recovery" }] } }, error: null });
    const recovery = render(await ResetPasswordPage());
    expect(recovery).toMatch(/<h1[^>]*>Choose a new password<\/h1>/);
    expect(recovery).toContain("venue@example.com");
    expect(recovery).toMatch(/autocomplete="username"/i);
    expect(recovery).toMatch(/autocomplete="new-password"/i);
    expect(recovery).toContain("Continue without setting a password");

    mocks.getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "invite" }] } }, error: null });
    const invite = render(await ResetPasswordPage());
    expect(invite).toMatch(/<h1[^>]*>Choose your password<\/h1>/);
    expect(invite).toContain("Invited users choose their own password here.");

    mocks.getClaims.mockResolvedValue({ data: { claims: { amr: [{ method: "password" }] } }, error: null });
    const change = render(await ResetPasswordPage());
    expect(change).toMatch(/<h1[^>]*>Change your password<\/h1>/);
    expect(change).toContain('href="/radio"');
  });
});

describe("set-password (former page)", () => {
  it("permanently redirects to /reset-password", async () => {
    const signal = await captureRedirectSignal(() => SetPasswordPage());
    expect(signal.url).toBe("/reset-password");
    expect(signal.permanent).toBe(true);
  });
});

describe("email-link confirmation page", () => {
  it("renders a Continue form with the token in hidden fields, not a GET verification", async () => {
    const html = render(
      await ConfirmPage(props({ token_hash: "0123456789abcdef0123", type: "invite", next: "/reset-password" })),
    );
    expect(html).toMatch(/<h1[^>]*>Accept your invitation<\/h1>/);
    expect(html).toContain('name="token_hash" value="0123456789abcdef0123"');
    expect(html).toContain('name="type" value="invite"');
    expect(html).toContain('name="next" value="/reset-password"');
    expect(html).toMatch(/<button[^>]*type="submit"/);
    expect(html).toContain("email security scanners");
  });

  it("defaults an invite link without next to /reset-password", async () => {
    const html = render(await ConfirmPage(props({ token_hash: "0123456789abcdef0123", type: "recovery" })));
    expect(html).toContain('name="next" value="/reset-password"');
  });

  it("replaces a dot-segment next that normalises to another site with the default (SEC-01)", async () => {
    const html = render(
      await ConfirmPage(props({ token_hash: "0123456789abcdef0123", type: "recovery", next: "/.//evil.example" })),
    );
    expect(html).toContain('name="next" value="/reset-password"');
    expect(html).not.toContain("evil.example");
  });

  it("explains broken links with the recovery path instead of rendering a form", async () => {
    const html = render(await ConfirmPage(props({ type: "invite" })));
    expect(html).toContain("This link is incomplete");
    expect(html).not.toContain("<form");
    expect(html).toContain('href="/forgot-password"');
    expect(html).toContain("Request a new link");
    expect(html).toContain('href="/login"');
  });
});
