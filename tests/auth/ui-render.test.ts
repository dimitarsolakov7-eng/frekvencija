/**
 * Server-render smoke tests for the setup page and the admin shell: they must render without a
 * browser and carry the accessible structure (landmarks, current page) they rely on. The auth pages are
 * covered by auth-pages.test.ts.
 */
import { createElement as h, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_CTX } from "./auth-mocks";
import AdminIndexPage from "@/app/admin/page";
import AdminLoading from "@/app/admin/loading";
import SetupPage from "@/app/setup/page";
import { ADMIN_CHANGE_PASSWORD_PATH, AdminShell } from "@/components/admin/shell";

const mocks = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAdminPage: mocks.requireAdminPage,
  getSessionContext: vi.fn(),
  loadSessionContext: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

const render = (element: ReactElement, pathname = "/") => renderToString(h(PathnameContext, { value: pathname }, element));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminPage.mockResolvedValue(ADMIN_CTX);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("setup page", () => {
  it("lists missing variable names without values", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "fake_secret_never_show_this");
    const html = render(await SetupPage());
    expect(html).toContain("Supabase isn’t configured yet");
    expect(html).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(html).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(html).toContain("docs/SETUP.md");
    expect(html).not.toContain("fake_secret_never_show_this");
    expect(html).toContain('id="main-content"');
  });

  it("offers to log in once configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    const html = render(await SetupPage());
    expect(html).toContain("Setup complete");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Go to log in");
  });
});

describe("admin shell", () => {
  it("renders the skip link, the Admin navigation with the current section, and the sign-out form", () => {
    const html = render(h(AdminShell, { email: "admin@example.com", children: h("p", null, "content") }), "/admin/businesses/b1");
    expect(html.indexOf('href="#main-content"')).toBeLessThan(html.indexOf("<nav"));
    expect(html).toMatch(/<main[^>]*id="main-content"[^>]*tabindex="-1"|<main[^>]*tabindex="-1"[^>]*id="main-content"/i);
    expect(html).toContain('<nav aria-label="Admin"');
    expect(html).toMatch(/aria-current="true"[^>]*href="\/admin\/businesses"|href="\/admin\/businesses"[^>]*aria-current="true"/);
    expect(html).toContain('action="/auth/signout"');
    expect(html).toContain('method="post"');
    expect(html).toContain("Sign out");
  });

  it("points Change password at /reset-password", () => {
    expect(ADMIN_CHANGE_PASSWORD_PATH).toBe("/reset-password");
  });

  it("loading skeleton announces loading", () => {
    expect(render(AdminLoading())).toContain('role="status"');
  });
});

describe("admin index", () => {
  it("has no page of its own: /admin redirects to the music library", () => {
    let digest = "";
    try {
      AdminIndexPage();
    } catch (error) {
      digest = String((error as { digest?: unknown }).digest ?? "");
    }
    expect(digest).toContain(";/admin/music;");
  });
});
