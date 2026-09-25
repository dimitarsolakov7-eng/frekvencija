import { describe, expect, it } from "vitest";
import { homePathForRole, resolvePostLoginPath } from "@/app/(auth)/_lib/redirects";

describe("homePathForRole", () => {
  it("routes each role to its home page and signed-out users to /login", () => {
    expect(homePathForRole("platform_admin")).toBe("/admin");
    expect(homePathForRole("business_user")).toBe("/radio");
    expect(homePathForRole(null)).toBe("/login");
    expect(homePathForRole(undefined)).toBe("/login");
  });
});

describe("resolvePostLoginPath", () => {
  it("falls back to the role home when next is missing, empty or the root", () => {
    expect(resolvePostLoginPath(undefined, "platform_admin")).toBe("/admin");
    expect(resolvePostLoginPath("", "business_user")).toBe("/radio");
    expect(resolvePostLoginPath("/", "business_user")).toBe("/radio");
    expect(resolvePostLoginPath("/?x=1", "platform_admin")).toBe("/admin");
  });

  it("keeps a safe same-area path including its query and hash", () => {
    expect(resolvePostLoginPath("/admin/businesses?tab=members#invite", "platform_admin")).toBe(
      "/admin/businesses?tab=members#invite",
    );
    expect(resolvePostLoginPath("/account", "business_user")).toBe("/account");
    expect(resolvePostLoginPath("/set-password", "business_user")).toBe("/set-password");
    expect(resolvePostLoginPath("/reset-password", "platform_admin")).toBe("/reset-password");
    expect(resolvePostLoginPath("/help", "business_user")).toBe("/help");
    expect(resolvePostLoginPath("/privacy", "business_user")).toBe("/privacy");
  });

  it("rejects open redirects", () => {
    for (const next of ["https://evil.example/admin", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/\t/evil"]) {
      expect(resolvePostLoginPath(next, "platform_admin")).toBe("/admin");
    }
  });

  it.each(["/.//evil.example", "/.//evil.example/phish", "/%2e//evil.example", "/%2e%2e//evil.example", "/a/..//evil.example"])(
    "rejects %j, which normalises to a protocol-relative URL, for both roles (SEC-01)",
    (next) => {
      expect(resolvePostLoginPath(next, "platform_admin")).toBe("/admin");
      expect(resolvePostLoginPath(next, "business_user")).toBe("/radio");
      expect(resolvePostLoginPath([next], "business_user")).toBe("/radio");
    },
  );

  it("never sends a user into the other role's area", () => {
    expect(resolvePostLoginPath("/admin/genres", "business_user")).toBe("/radio");
    expect(resolvePostLoginPath("/admin", "business_user")).toBe("/radio");
    expect(resolvePostLoginPath("/radio", "platform_admin")).toBe("/admin");
    expect(resolvePostLoginPath("/account", "platform_admin")).toBe("/admin");
    expect(resolvePostLoginPath("/help", "platform_admin")).toBe("/admin");
    // Normalised before the check: dot segments cannot sneak into another area.
    expect(resolvePostLoginPath("/radio/../admin", "business_user")).toBe("/radio");
  });

  it("ignores guest pages, auth plumbing and API routes", () => {
    for (const next of ["/login", "/login?next=/admin", "/forgot-password", "/request-access", "/auth/confirm?token_hash=x", "/auth/signout", "/setup", "/api/media/sign"]) {
      expect(resolvePostLoginPath(next, "business_user")).toBe("/radio");
    }
  });

  it("accepts the array shape of searchParams values", () => {
    expect(resolvePostLoginPath(["/admin/music", "/admin/genres"], "platform_admin")).toBe("/admin/music");
  });
});
