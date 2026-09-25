import { describe, expect, it } from "vitest";
import { buildConfirmLink, ensurePlatformAdmin } from "../lib/admin-invite";
import { FakeSupabase } from "./fake-supabase";

const SITE = "https://radio.example.com";

async function run(db: FakeSupabase, email: string, link = false) {
  const lines: string[] = [];
  const result = await ensurePlatformAdmin(db.client(), { email, link, siteUrl: SITE }, (line) => lines.push(line));
  return { result, lines, profile: db.rows("profiles").find((p) => p.email === email) };
}

describe("ensurePlatformAdmin", () => {
  it("invites a new user by email (redirecting to the site URL) and promotes them, without a password", async () => {
    const db = new FakeSupabase();
    const { result, profile, lines } = await run(db, "boss@example.com");
    expect(db.invites).toEqual([{ email: "boss@example.com", redirectTo: SITE, via: "email" }]);
    expect(result).toMatchObject({ link: null, promoted: true });
    expect(profile).toMatchObject({ id: result.userId, role: "platform_admin" });
    expect(db.authUsers[0].password).toBeNull();
    expect(lines.join("\n")).toMatch(/Invitation email sent to boss@example\.com[\s\S]*now a platform admin/);
  });

  it("with --link creates a one-time /auth/confirm invite link instead of sending an email", async () => {
    const db = new FakeSupabase();
    const { result, profile } = await run(db, "boss@example.com", true);
    expect(db.invites).toEqual([{ email: "boss@example.com", redirectTo: SITE, via: "link" }]);
    expect(result.link).toBe(buildConfirmLink(SITE, `hash-${result.userId}`, "invite"));
    expect(result.link).toMatch(/^https:\/\/radio\.example\.com\/auth\/confirm\?token_hash=hash-[0-9a-f-]+&type=invite&next=\/reset-password$/);
    expect(profile?.role).toBe("platform_admin");
  });

  it("promotes an existing user without touching their password or sending anything", async () => {
    const db = new FakeSupabase();
    db.addAuthUser("staff@example.com", { password: "their-own-password" });
    const { result, profile } = await run(db, "staff@example.com");
    expect(result).toMatchObject({ link: null, promoted: true });
    expect(profile?.role).toBe("platform_admin");
    expect(db.invites).toEqual([]);
    expect(db.authUsers[0].password).toBe("their-own-password");
  });

  it("leaves an existing admin unchanged", async () => {
    const db = new FakeSupabase();
    db.addAuthUser("boss@example.com", { role: "platform_admin" });
    const { result, lines } = await run(db, "boss@example.com");
    expect(result.promoted).toBe(false);
    expect(lines.at(-1)).toMatch(/already a platform admin/);
  });

  it("with --link, re-issues an invite only while the account is unconfirmed", async () => {
    const db = new FakeSupabase();
    db.addAuthUser("pending@example.com", { confirmed: false });
    db.addAuthUser("active@example.com");
    expect((await run(db, "pending@example.com", true)).result.link).toMatch(/type=invite/);
    const confirmed = await run(db, "active@example.com", true);
    expect(confirmed.result.link).toBeNull();
    expect(confirmed.lines.join("\n")).toMatch(/--link ignored/);
    expect(confirmed.profile?.role).toBe("platform_admin");
  });

  it("points out an unaccepted invitation when promoting without --link", async () => {
    const db = new FakeSupabase();
    db.addAuthUser("pending@example.com", { confirmed: false });
    const { result, lines } = await run(db, "pending@example.com");
    expect(result).toMatchObject({ link: null, promoted: true });
    expect(lines.join("\n")).toMatch(/has not accepted its invitation yet; re-run with --link/);
    expect(db.invites).toEqual([]);
  });

  it("creates the missing profile row of an auth user registered before the trigger existed", async () => {
    const db = new FakeSupabase();
    const id = db.addAuthUser("legacy@example.com", { withProfile: false });
    const { result, profile, lines } = await run(db, "legacy@example.com");
    expect(result.userId).toBe(id);
    expect(profile).toMatchObject({ id, role: "platform_admin" });
    expect(lines.join("\n")).toMatch(/had no profile row[\s\S]*profile row created/);
  });
});
