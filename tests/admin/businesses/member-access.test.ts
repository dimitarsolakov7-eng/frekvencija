import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  inviteMemberToBusiness,
  sendAccessToMember,
  type AddMembershipResult,
  type AuthAdminPort,
  type AuthUserSnapshot,
  type MemberAccessDeps,
  type MemberDirectoryPort,
  type PortResult,
  type ProfileSummary,
} from "@/lib/data/admin/businesses";
import type { AppRole } from "@/types/database";

const SITE = "https://radio.example.com";
const EMERALD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AURORA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-09-25T12:00:00Z");

type AuthFailure = "invite" | "generateLink" | "reset" | "getUser";

/** In-memory Supabase Auth + membership world behind the two ports. */
class World {
  businesses = new Map<string, string>([
    [EMERALD, "EmeraldBar"],
    [AURORA, "Hotel Aurora"],
  ]);
  profiles = new Map<string, ProfileSummary>();
  users = new Map<string, AuthUserSnapshot>();
  /** userId → businessId */
  memberships = new Map<string, string>();
  calls: string[] = [];
  failures: Partial<Record<AuthFailure, unknown>> = {};
  private nextId = 1;
  private nextToken = 1;

  addUser(email: string, options: { role?: AppRole; confirmed?: boolean; invited?: boolean; business?: string; bannedUntil?: string } = {}) {
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
    this.profiles.set(id, { id, email, role: options.role ?? "business_user" });
    this.users.set(id, {
      id,
      email,
      invitedAt: options.invited ? "2026-09-20T00:00:00Z" : null,
      emailConfirmedAt: options.confirmed ? "2026-09-21T00:00:00Z" : null,
      lastSignInAt: null,
      bannedUntil: options.bannedUntil ?? null,
      createdAt: "2026-09-20T00:00:00Z",
    });
    if (options.business) this.memberships.set(id, options.business);
    return id;
  }

  userByEmail(email: string): AuthUserSnapshot | undefined {
    return [...this.users.values()].find((user) => user.email === email);
  }

  /** Supabase invite semantics: create, or re-send to an unconfirmed user; 422 for a confirmed one. */
  private inviteOrCreate(email: string): PortResult<AuthUserSnapshot> {
    const existing = this.userByEmail(email);
    if (existing?.emailConfirmedAt) {
      return { ok: false, error: new AuthApiError("A user with this email address has already been registered", 422, "email_exists") };
    }
    if (existing) return { ok: true, value: existing };
    const id = this.addUser(email, { invited: true });
    return { ok: true, value: this.users.get(id)! };
  }

  directory: MemberDirectoryPort = {
    getBusiness: async (businessId) => {
      const name = this.businesses.get(businessId);
      return name ? { id: businessId, name } : null;
    },
    findProfileByEmail: async (email) => [...this.profiles.values()].find((profile) => profile.email === email) ?? null,
    getProfile: async (userId) => this.profiles.get(userId) ?? null,
    getMembership: async (userId) => {
      const businessId = this.memberships.get(userId);
      return businessId ? { businessId, businessName: this.businesses.get(businessId) ?? null } : null;
    },
    addMembership: async (businessId, userId): Promise<AddMembershipResult> => {
      this.calls.push(`addMembership:${userId}`);
      if (!this.businesses.has(businessId) || !this.profiles.has(userId)) return { ok: false, reason: "not_found" };
      const current = this.memberships.get(userId);
      if (current === businessId) return { ok: true, added: false };
      if (current) return { ok: false, reason: "member_elsewhere", businessName: this.businesses.get(current) ?? null };
      this.memberships.set(userId, businessId);
      return { ok: true, added: true };
    },
  };

  auth: AuthAdminPort = {
    getUser: async (userId) => {
      this.calls.push(`getUser:${userId}`);
      if (this.failures.getUser) return { ok: false, error: this.failures.getUser };
      return { ok: true, value: this.users.get(userId) ?? null };
    },
    inviteByEmail: async (email, options) => {
      this.calls.push(`invite:${email}:${options.redirectTo}:${options.data.business_name}`);
      if (this.failures.invite) return { ok: false, error: this.failures.invite };
      return this.inviteOrCreate(email);
    },
    generateLink: async ({ type, email, redirectTo }) => {
      this.calls.push(`link:${type}:${email}:${redirectTo}`);
      if (this.failures.generateLink) return { ok: false, error: this.failures.generateLink };
      if (type === "invite") {
        const invited = this.inviteOrCreate(email);
        if (!invited.ok) return invited;
        return { ok: true, value: { user: invited.value, hashedToken: `invitehash${this.nextToken++}` } };
      }
      const user = this.userByEmail(email);
      if (!user) return { ok: false, error: new AuthApiError("User not found", 404, "user_not_found") };
      return { ok: true, value: { user, hashedToken: `recoveryhash${this.nextToken++}` } };
    },
    sendPasswordReset: async (email, redirectTo) => {
      this.calls.push(`reset:${email}:${redirectTo}`);
      if (this.failures.reset) return { ok: false, error: this.failures.reset };
      return { ok: true, value: null };
    },
  };

  deps(): MemberAccessDeps {
    return { directory: this.directory, auth: this.auth, siteUrl: SITE, now: () => NOW };
  }
}

let world: World;

beforeEach(() => {
  world = new World();
});

function invite(email: string, delivery: "email" | "link" = "email", businessId = EMERALD) {
  return inviteMemberToBusiness(world.deps(), { businessId, email, delivery });
}

describe("inviteMemberToBusiness — new addresses", () => {
  it("sends a Supabase invitation (site origin + business name) and adds the membership", async () => {
    const result = await invite("Staff@Venue.example");
    expect(result).toMatchObject({ ok: true, link: null });
    expect(result.message).toMatch(/Invitation sent to staff@venue\.example/);
    expect(world.calls[0]).toBe(`invite:staff@venue.example:${SITE}:EmeraldBar`);
    const user = world.userByEmail("staff@venue.example")!;
    expect(world.memberships.get(user.id)).toBe(EMERALD);
  });

  it("creates a one-time invite link pointing at /auth/confirm", async () => {
    const result = await invite("new@venue.example", "link");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.link).toEqual({
      type: "invite",
      email: "new@venue.example",
      url: `${SITE}/auth/confirm?token_hash=invitehash1&type=invite&next=/reset-password`,
    });
    expect(world.calls.some((call) => call.startsWith("invite:"))).toBe(false);
    expect(world.memberships.get(world.userByEmail("new@venue.example")!.id)).toBe(EMERALD);
  });

  it("explains SMTP restrictions honestly and suggests the link option", async () => {
    world.failures.invite = new AuthApiError("Email address not authorized", 400, "email_address_not_authorized");
    const result = await invite("new@venue.example");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/project team/);
    expect(result.message).toMatch(/invite link/);
    expect(world.memberships.size).toBe(0);
  });

  it("reports the email rate limit", async () => {
    world.failures.invite = new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit");
    const result = await invite("new@venue.example");
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/email limit/);
  });

  it("does not show a link when the membership could not be created", async () => {
    world.directory.addMembership = async () => ({ ok: false, reason: "not_found" });
    const result = await invite("new@venue.example", "link");
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("link");
    expect(result.message).toMatch(/could not be added to EmeraldBar/);
  });

  it("fails cleanly when the business is gone", async () => {
    const result = await invite("new@venue.example", "email", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(result).toMatchObject({ ok: false });
    expect(world.calls).toEqual([]);
  });
});

describe("inviteMemberToBusiness — existing accounts", () => {
  it("adds a confirmed account without a venue directly, without sending anything", async () => {
    const id = world.addUser("veteran@venue.example", { confirmed: true });
    const result = await invite("veteran@venue.example");
    expect(result).toMatchObject({ ok: true, link: null });
    expect(result.message).toMatch(/already has an account and was added to EmeraldBar/);
    expect(world.memberships.get(id)).toBe(EMERALD);
    expect(world.calls.some((call) => call.startsWith("invite:") || call.startsWith("reset:"))).toBe(false);
  });

  it("creates a password reset link (not an invite) for a confirmed account", async () => {
    const id = world.addUser("veteran@venue.example", { confirmed: true });
    const result = await invite("veteran@venue.example", "link");
    expect(result.ok && result.link).toMatchObject({ type: "recovery", url: `${SITE}/auth/confirm?token_hash=recoveryhash1&type=recovery&next=/reset-password` });
    expect(result.message).toMatch(/was added to EmeraldBar\. One-time password reset link/);
    expect(world.memberships.get(id)).toBe(EMERALD);
  });

  it("re-sends the invitation to an account that never accepted it", async () => {
    const id = world.addUser("pending@venue.example", { invited: true, business: EMERALD });
    const result = await invite("pending@venue.example");
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toMatch(/Invitation sent again/);
    expect(world.memberships.get(id)).toBe(EMERALD);
  });

  it("says so when a confirmed account is already a member", async () => {
    world.addUser("member@venue.example", { confirmed: true, business: EMERALD });
    const result = await invite("member@venue.example");
    expect(result).toMatchObject({ ok: false, field: "email" });
    expect(result.message).toMatch(/already a member of EmeraldBar/);
  });

  it("enforces one venue per account", async () => {
    const id = world.addUser("aurora@venue.example", { confirmed: true, business: AURORA });
    const result = await invite("aurora@venue.example", "link");
    expect(result).toMatchObject({ ok: false, field: "email" });
    expect(result.message).toMatch(/already belongs to “Hotel Aurora”/);
    expect(world.memberships.get(id)).toBe(AURORA);
    expect(world.calls.some((call) => call.startsWith("link:"))).toBe(false);
  });

  it("never adds a platform admin", async () => {
    const id = world.addUser("admin@platform.example", { role: "platform_admin", confirmed: true });
    const result = await invite("admin@platform.example");
    expect(result).toMatchObject({ ok: false, field: "email" });
    expect(result.message).toMatch(/platform admin/);
    expect(world.memberships.has(id)).toBe(false);
    expect(world.calls).toEqual([]);
  });

  it("handles email_exists from Supabase by continuing with the existing account", async () => {
    // The profile lookup misses the first time (e.g. created between lookup and invite).
    const id = world.addUser("race@venue.example", { confirmed: true });
    const realFind = world.directory.findProfileByEmail;
    let lookups = 0;
    world.directory.findProfileByEmail = async (email) => (lookups++ === 0 ? null : realFind(email));
    const result = await invite("race@venue.example");
    expect(result).toMatchObject({ ok: true });
    expect(world.memberships.get(id)).toBe(EMERALD);
  });

  it("reports email_exists honestly when no profile can be found", async () => {
    world.failures.invite = new AuthApiError("A user with this email address has already been registered", 422, "email_exists");
    const result = await invite("ghost@venue.example");
    expect(result).toMatchObject({ ok: false, field: "email" });
    expect(result.message).toMatch(/already registered/);
  });

  it("refuses blocked accounts", async () => {
    world.addUser("blocked@venue.example", { confirmed: true, bannedUntil: "2027-01-01T00:00:00Z" });
    const result = await invite("blocked@venue.example");
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/blocked/);
  });

  it("does not guess when the sign-in status cannot be loaded", async () => {
    world.addUser("veteran@venue.example", { confirmed: true });
    world.failures.getUser = new AuthApiError("Internal", 500, "unexpected_failure");
    const result = await invite("veteran@venue.example");
    expect(result).toMatchObject({ ok: false });
    expect(world.memberships.size).toBe(0);
  });
});

describe("sendAccessToMember", () => {
  it("sends a password reset email to an active member", async () => {
    const id = world.addUser("member@venue.example", { confirmed: true, business: EMERALD });
    const result = await sendAccessToMember(world.deps(), { businessId: EMERALD, userId: id, delivery: "email" });
    expect(result).toMatchObject({ ok: true, link: null });
    expect(result.message).toMatch(/Password reset email sent/);
    expect(world.calls).toContain(`reset:member@venue.example:${SITE}`);
  });

  it("creates a reset link for an active member and an invite link for a pending one", async () => {
    const active = world.addUser("member@venue.example", { confirmed: true, business: EMERALD });
    const pending = world.addUser("pending@venue.example", { invited: true, business: EMERALD });
    const reset = await sendAccessToMember(world.deps(), { businessId: EMERALD, userId: active, delivery: "link" });
    const inviteLink = await sendAccessToMember(world.deps(), { businessId: EMERALD, userId: pending, delivery: "link" });
    expect(reset.ok && reset.link?.type).toBe("recovery");
    expect(inviteLink.ok && inviteLink.link?.type).toBe("invite");
  });

  it("falls back to a reset link when the invitation was accepted meanwhile", async () => {
    const id = world.addUser("pending@venue.example", { invited: true, business: EMERALD });
    const realGenerate = world.auth.generateLink;
    world.auth.generateLink = async (params) => {
      if (params.type === "invite") {
        world.users.set(id, { ...world.users.get(id)!, emailConfirmedAt: "2026-09-25T11:00:00Z" });
        return { ok: false, error: new AuthApiError("already registered", 422, "email_exists") };
      }
      return realGenerate(params);
    };
    const result = await sendAccessToMember(world.deps(), { businessId: EMERALD, userId: id, delivery: "link" });
    expect(result.ok && result.link?.type).toBe("recovery");
  });

  it("re-sends the invitation email to a pending member", async () => {
    const id = world.addUser("pending@venue.example", { invited: true, business: EMERALD });
    const result = await sendAccessToMember(world.deps(), { businessId: EMERALD, userId: id, delivery: "email" });
    expect(result).toMatchObject({ ok: true });
    expect(world.calls).toContain(`invite:pending@venue.example:${SITE}:EmeraldBar`);
  });

  it("refuses accounts that are not members of this venue (never trusts the client's ids)", async () => {
    const other = world.addUser("aurora@venue.example", { confirmed: true, business: AURORA });
    const none = world.addUser("loose@venue.example", { confirmed: true });
    const elsewhere = await sendAccessToMember(world.deps(), { businessId: EMERALD, userId: other, delivery: "email" });
    const notMember = await sendAccessToMember(world.deps(), { businessId: EMERALD, userId: none, delivery: "link" });
    expect(elsewhere).toMatchObject({ ok: false });
    expect(notMember).toMatchObject({ ok: false });
    expect(notMember.message).toMatch(/no longer a member/);
    expect(world.memberships.has(none)).toBe(false);
    expect(world.calls.some((call) => call.startsWith("reset:") || call.startsWith("link:"))).toBe(false);
  });

  it("explains a failed reset email", async () => {
    const id = world.addUser("member@venue.example", { confirmed: true, business: EMERALD });
    world.failures.reset = new AuthApiError("Email rate limit exceeded", 429, "over_email_send_rate_limit");
    const result = await sendAccessToMember(world.deps(), { businessId: EMERALD, userId: id, delivery: "email" });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/reset link/);
  });

  it("fails for unknown accounts", async () => {
    const result = await sendAccessToMember(world.deps(), {
      businessId: EMERALD,
      userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      delivery: "email",
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/no longer exists/);
  });
});
