import { describe, expect, it } from "vitest";
import {
  BUSINESS_AREA_PREFIXES,
  decideProxyAction,
  isSetupModePublicPath,
  isStaticAssetPath,
  PROTECTED_PREFIXES,
} from "@/lib/auth/proxy-rules";

const signedOut = { configured: true, authenticated: false } as const;
const signedIn = { configured: true, authenticated: true } as const;
const unknown = { configured: true, authenticated: null } as const;
const setupMode = { configured: false, authenticated: null } as const;

const PUBLIC_PAGES = ["/", "/login", "/forgot-password", "/request-access", "/privacy", "/terms"] as const;

describe("decideProxyAction — setup mode (Supabase env missing)", () => {
  it.each([...PUBLIC_PAGES, "/reset-password"])("renders the public page %s", (pathname) => {
    expect(decideProxyAction({ pathname, ...setupMode })).toEqual({ type: "next" });
  });

  it.each(["/radio", "/admin/music", "/account", "/help", "/auth/confirm", "/set-password", "/admin"])(
    "redirects %s to /setup",
    (pathname) => {
      expect(decideProxyAction({ pathname, ...setupMode })).toEqual({ type: "redirect", pathname: "/setup" });
    },
  );

  it.each(["/setup", "/setup/step-2", "/dev/player-lab", "/api/dev/audio/demo.json", "/brand/venue-hero.jpg", "/brand/genres"])(
    "lets %s through",
    (pathname) => {
      expect(decideProxyAction({ pathname, ...setupMode })).toEqual({ type: "next" });
    },
  );

  it("answers API requests with JSON instead of redirecting them", () => {
    expect(decideProxyAction({ pathname: "/api/media/sign", ...setupMode })).toEqual({ type: "setup-required-json" });
    expect(decideProxyAction({ pathname: "/api", ...setupMode })).toEqual({ type: "setup-required-json" });
  });

  it("never redirects static assets", () => {
    for (const pathname of ["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/logo.svg", "/demo/loop.mp3", "/robots.txt"]) {
      expect(decideProxyAction({ pathname, ...setupMode })).toEqual({ type: "next" });
    }
  });

  it("does not treat look-alike prefixes as exempt", () => {
    for (const pathname of ["/setupx", "/developer", "/loginx", "/privacy-old", "/terms2", "/branding", "/request-accessories"]) {
      expect(decideProxyAction({ pathname, ...setupMode })).toEqual({ type: "redirect", pathname: "/setup" });
    }
  });
});

describe("decideProxyAction — configured", () => {
  it.each(["/admin", "/admin/businesses/123", "/radio", "/account", "/help", "/reset-password", "/admin/"])(
    "sends a signed-out user on %s to /login with next",
    (pathname) => {
      expect(decideProxyAction({ pathname, ...signedOut })).toEqual({
        type: "redirect",
        pathname: "/login",
        searchParams: { next: pathname },
      });
    },
  );

  it("keeps the query string in next", () => {
    expect(decideProxyAction({ pathname: "/admin/music", search: "?genre=jazz&page=2", ...signedOut })).toEqual({
      type: "redirect",
      pathname: "/login",
      searchParams: { next: "/admin/music?genre=jazz&page=2" },
    });
  });

  it("does not protect look-alike paths", () => {
    expect(decideProxyAction({ pathname: "/administrator", ...signedOut })).toEqual({ type: "next" });
    expect(decideProxyAction({ pathname: "/radiology", ...signedOut })).toEqual({ type: "next" });
    expect(decideProxyAction({ pathname: "/helpful", ...signedOut })).toEqual({ type: "next" });
  });

  it("lets /set-password through so the page can permanently redirect to /reset-password", () => {
    expect(decideProxyAction({ pathname: "/set-password", ...signedOut })).toEqual({ type: "next" });
    expect(decideProxyAction({ pathname: "/set-password", ...signedIn })).toEqual({ type: "next" });
  });

  it.each(PUBLIC_PAGES)("renders %s for signed-out and signed-in visitors alike", (pathname) => {
    // Signed-in users on /login and /forgot-password are sent to their role's home page by the page itself
    // (the proxy cannot see the role), so the proxy never bounces them to the marketing homepage.
    expect(decideProxyAction({ pathname, ...signedOut })).toEqual({ type: "next" });
    expect(decideProxyAction({ pathname, ...signedIn })).toEqual({ type: "next" });
    expect(decideProxyAction({ pathname, ...unknown })).toEqual({ type: "next" });
  });

  it("lets signed-in users reach protected pages", () => {
    for (const pathname of ["/admin", "/radio", "/account", "/help", "/reset-password"]) {
      expect(decideProxyAction({ pathname, ...signedIn })).toEqual({ type: "next" });
    }
  });

  it("never redirects /api/* or /auth/*, whatever the session", () => {
    for (const session of [signedOut, signedIn, unknown]) {
      for (const pathname of ["/api/player/announcements", "/api/admin/uploads/sign", "/auth/confirm", "/auth/signout"]) {
        expect(decideProxyAction({ pathname, ...session })).toEqual({ type: "next" });
      }
    }
  });

  it("makes no auth redirect when the session state is unknown", () => {
    expect(decideProxyAction({ pathname: "/admin", ...unknown })).toEqual({ type: "next" });
    expect(decideProxyAction({ pathname: "/reset-password", ...unknown })).toEqual({ type: "next" });
  });
});

describe("route tables", () => {
  it("treats /help and /account as business areas and protects every area", () => {
    expect(BUSINESS_AREA_PREFIXES).toEqual(["/radio", "/account", "/help"]);
    expect(PROTECTED_PREFIXES).toEqual(["/admin", "/radio", "/account", "/help", "/reset-password"]);
  });

  it("isSetupModePublicPath matches the homepage exactly and the public prefixes", () => {
    expect(isSetupModePublicPath("/")).toBe(true);
    expect(isSetupModePublicPath("/terms")).toBe(true);
    expect(isSetupModePublicPath("/radio")).toBe(false);
    expect(isSetupModePublicPath("")).toBe(false);
  });
});

describe("isStaticAssetPath", () => {
  it("recognises framework and public files but not pages", () => {
    expect(isStaticAssetPath("/_next/image")).toBe(true);
    expect(isStaticAssetPath("/images/logo.PNG")).toBe(true);
    expect(isStaticAssetPath("/brand/venue-hero.jpg")).toBe(true);
    expect(isStaticAssetPath("/admin/music")).toBe(false);
    expect(isStaticAssetPath("/radio")).toBe(false);
  });
});
