import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";

const { session } = vi.hoisted(() => ({ session: { claims: null as { sub: string } | null } }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: session.claims ? { claims: session.claims } : null, error: null }) },
  }),
}));

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  session.claims = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it("sends app pages to /setup when Supabase is not configured", async () => {
    const response = await proxy(new NextRequest("http://localhost/radio?x=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/setup");
    expect((await proxy(new NextRequest("http://localhost/setup"))).headers.get("location")).toBeNull();
  });

  it("renders the public site and auth forms in setup mode", async () => {
    for (const path of ["/", "/login", "/forgot-password", "/request-access", "/privacy", "/terms", "/reset-password"]) {
      const response = await proxy(new NextRequest(`http://localhost${path}`));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("answers API calls with 503 JSON in setup mode", async () => {
    const response = await proxy(new NextRequest("http://localhost/api/media/sign", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ error: { code: "unavailable" } });
  });

  it("redirects signed-out users to /login with next, using 303 for POSTs", async () => {
    configure();
    const get = await proxy(new NextRequest("http://localhost/admin/music?genre=jazz"));
    expect(get.status).toBe(307);
    expect(get.headers.get("location")).toBe("http://localhost/login?next=%2Fadmin%2Fmusic%3Fgenre%3Djazz");

    const post = await proxy(new NextRequest("http://localhost/admin/genres", { method: "POST" }));
    expect(post.status).toBe(303);
  });

  it("passes signed-in users through; /login resolves their role home itself", async () => {
    configure();
    session.claims = { sub: "user-1" };
    expect((await proxy(new NextRequest("http://localhost/radio"))).headers.get("location")).toBeNull();
    expect((await proxy(new NextRequest("http://localhost/login"))).headers.get("location")).toBeNull();
    expect((await proxy(new NextRequest("http://localhost/"))).headers.get("location")).toBeNull();
  });

  it("protects /reset-password and the venue help page for signed-out users", async () => {
    configure();
    expect((await proxy(new NextRequest("http://localhost/reset-password"))).headers.get("location")).toBe(
      "http://localhost/login?next=%2Freset-password",
    );
    expect((await proxy(new NextRequest("http://localhost/help"))).headers.get("location")).toBe(
      "http://localhost/login?next=%2Fhelp",
    );
  });

  it("never redirects API routes for signed-out users", async () => {
    configure();
    const response = await proxy(new NextRequest("http://localhost/api/player/announcements"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("has a matcher that excludes static assets", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    expect(pattern.test("/admin")).toBe(true);
    expect(pattern.test("/api/media/sign")).toBe(true);
    expect(pattern.test("/_next/static/chunk.js")).toBe(false);
    expect(pattern.test("/favicon.ico")).toBe(false);
    expect(pattern.test("/demo/loop.mp3")).toBe(false);
    expect(pattern.test("/images/logo.png")).toBe(false);
  });
});
