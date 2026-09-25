import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberAccessState, NewBusinessState } from "@/components/admin/businesses/action-types";
import { createFakeClient, eqValue, type FakeClient, type QueryCall, type Responder, type RpcResponder } from "./fake-client";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const G_SHARED = "11111111-1111-4111-8111-111111111111";
const G_JAZZ = "22222222-2222-4222-8222-222222222222";
const G_VIP = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  fake: null as unknown as FakeClient,
  admin: null as unknown,
  adminError: null as Error | null,
  consumeRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAdminAction: async () => ({
    ctx: { userId: ADMIN_ID, email: "admin@platform.example", role: "platform_admin", business: null },
    supabase: h.fake.client,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`unexpected redirect to ${url}`);
  },
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: h.consumeRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    if (h.adminError) throw h.adminError;
    return h.admin;
  },
}));

const {
  createBusiness,
  deleteBusiness,
  inviteMember,
  removeBusinessLogo,
  removeMember,
  saveBusinessProfile,
  sendBusinessPasswordReset,
  setBusinessActive,
} = await import("@/app/admin/businesses/actions");
const { EnvError } = await import("@/lib/env");

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

function installClient(respond: Responder, respondRpc?: RpcResponder) {
  h.fake = createFakeClient(respond, respondRpc);
  return h.fake;
}

const IDLE = { ok: false, message: null, fieldErrors: {} };
const IDLE_NEW: NewBusinessState = { ...IDLE, created: null, link: null, warnings: [] };
const IDLE_MEMBER: MemberAccessState = { ...IDLE, link: null };

const GENRE_ROWS = [
  { id: G_SHARED, name: "Lounge", is_enabled: true, available_to_all: true },
  { id: G_JAZZ, name: "Jazz", is_enabled: true, available_to_all: false },
  { id: G_VIP, name: "VIP", is_enabled: true, available_to_all: false },
];

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER,
    email: "manager@emeraldbar.example",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-09-25T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  h.admin = null;
  h.adminError = null;
  h.consumeRateLimit.mockReset();
  h.consumeRateLimit.mockResolvedValue({ allowed: true, degraded: false });
  h.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Add business
// ---------------------------------------------------------------------------

describe("createBusiness", () => {
  function newForm(overrides: Record<string, string | string[]> = {}) {
    const fields: Record<string, string | string[]> = {
      name: " EmeraldBar ",
      stationName: "",
      contactEmail: "Manager@EmeraldBar.example",
      businessType: "bar",
      announcementLanguage: "en",
      isActive: "true",
      inviteContact: ["false", "true"],
      inviteDelivery: "email",
      fromRequest: "",
      ...overrides,
    };
    const entries: [string, string][] = [];
    for (const [key, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) entries.push([key, item]);
    }
    return form(entries);
  }

  /** A world where every step succeeds; the responder records what the action did. */
  function world(options: { settings?: unknown; insertError?: boolean; rpcError?: boolean; requestClosed?: boolean } = {}) {
    const fake = installClient(
      (call: QueryCall) => {
        if (call.table === "platform_settings") return options.settings === undefined ? { data: { default_announcement_every_n_tracks: 6 } } : (options.settings as never);
        if (call.table === "businesses" && call.op === "insert") {
          return options.insertError ? { error: { code: "42501", message: "denied" } } : { data: { id: BIZ, name: "EmeraldBar" } };
        }
        if (call.table === "businesses") return { data: { id: BIZ, name: "EmeraldBar" } };
        if (call.table === "genres") return { data: GENRE_ROWS };
        if (call.table === "access_requests" && call.op === "update") return { data: options.requestClosed ? [] : [{ id: REQUEST }] };
        if (call.table === "access_requests") return { data: { id: REQUEST } };
        if (call.table === "profiles") return { data: [] };
        return undefined; // business_members insert succeeds
      },
      () => (options.rpcError ? { error: { code: "XX000", message: "boom" } } : undefined),
    );
    const inviteUserByEmail = vi.fn(async (email: string) => ({
      data: { user: authUser({ email, invited_at: "2026-09-25T00:00:00Z" }) },
      error: null,
    }));
    const generateLink = vi.fn(async () => ({
      data: {
        properties: { hashed_token: "abcdef0123456789", action_link: "", email_otp: "", redirect_to: "", verification_type: "invite" },
        user: authUser(),
      },
      error: null,
    }));
    h.admin = { auth: { admin: { inviteUserByEmail, generateLink } } };
    return { fake, inviteUserByEmail, generateLink };
  }

  it("returns field errors and echoes the input without touching the database", async () => {
    const fake = installClient(() => undefined);
    const state = await createBusiness(
      IDLE_NEW,
      newForm({ name: "", contactEmail: "not-an-email", announcementLanguage: "English", businessType: "pub" }),
    );
    expect(state.ok).toBe(false);
    expect(state.created).toBeNull();
    expect(state.fieldErrors).toMatchObject({
      name: "Business name is required.",
      contactEmail: "Enter a valid email address.",
      businessType: "Choose a business type.",
      announcementLanguage: expect.stringContaining("language code"),
    });
    expect(state.values).toMatchObject({ contactEmail: "not-an-email", announcementLanguage: "English", inviteContact: "true" });
    expect(fake.calls).toEqual([]);
  });

  it("needs a contact email to invite the contact", async () => {
    installClient(() => undefined);
    const state = await createBusiness(IDLE_NEW, newForm({ contactEmail: "" }));
    expect(state.fieldErrors.contactEmail).toMatch(/Add the contact email to invite them/);
    const withoutInvite = await createBusiness(IDLE_NEW, newForm({ contactEmail: "", inviteContact: "false" }));
    expect(withoutInvite.fieldErrors.contactEmail).toBeUndefined();
  });

  it("creates the venue with the platform's default frequency, its genres, the request status and an invitation", async () => {
    const { fake, inviteUserByEmail } = world();
    const state = await createBusiness(IDLE_NEW, newForm({ fromRequest: REQUEST, genreIds: [G_JAZZ, G_SHARED] }));

    expect(state).toMatchObject({ ok: true, created: { id: BIZ, name: "EmeraldBar" }, link: null, warnings: [] });
    const insert = fake.calls.find((call) => call.table === "businesses" && call.op === "insert")!;
    expect(insert.payload).toEqual({
      name: "EmeraldBar",
      station_name: "EmeraldBar Radio",
      name_pronunciation: null,
      station_name_pronunciation: null,
      contact_email: "Manager@EmeraldBar.example",
      announcement_language: "en",
      business_type: "bar",
      is_active: true,
      announcement_every_n_tracks: 6,
    });
    // Only the exclusive genre is stored; the shared one is included for every venue anyway.
    expect(fake.rpcCalls).toEqual([{ fn: "set_business_genre_access", args: { p_business_id: BIZ, p_genre_ids: [G_JAZZ] } }]);
    const approve = fake.calls.find((call) => call.table === "access_requests" && call.op === "update")!;
    expect(approve.payload).toMatchObject({ status: "approved", handled_by: ADMIN_ID });
    expect(approve.filters).toContainEqual(["in", "status", ["new", "contacted"]]);
    expect(inviteUserByEmail).toHaveBeenCalledWith("manager@emeraldbar.example", {
      redirectTo: "http://localhost:3000",
      data: { business_name: "EmeraldBar" },
    });
    expect(fake.calls.find((call) => call.table === "business_members")).toMatchObject({
      op: "insert",
      payload: { business_id: BIZ, user_id: USER },
    });
    expect(state.message).toMatch(/EmeraldBar was created\. 1 exclusive genre was assigned\. The access request is marked approved\. Invitation sent/);
    expect(h.consumeRateLimit).toHaveBeenCalledWith({ key: `invite:${ADMIN_ID}`, max: 30, windowSeconds: 600, failClosed: false });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/businesses", "layout");
  });

  it("falls back to 4 songs when the platform settings can't be read", async () => {
    const { fake } = world({ settings: { error: { code: "XX000", message: "down" } } });
    await createBusiness(IDLE_NEW, newForm({ inviteContact: "false" }));
    expect(fake.calls.find((call) => call.op === "insert")?.payload).toMatchObject({ announcement_every_n_tracks: 4 });
  });

  it("returns the one-time invite link when the link option is chosen", async () => {
    const { generateLink } = world();
    const state = await createBusiness(IDLE_NEW, newForm({ inviteDelivery: "link" }));
    expect(state.link).toEqual({
      type: "invite",
      email: "manager@emeraldbar.example",
      url: "http://localhost:3000/auth/confirm?token_hash=abcdef0123456789&type=invite&next=/reset-password",
    });
    expect(generateLink).toHaveBeenCalledOnce();
  });

  it("reports every step that did not complete after the business exists, without failing", async () => {
    world({ rpcError: true, requestClosed: true });
    h.adminError = new EnvError("SUPABASE_SECRET_KEY", "missing");
    const state = await createBusiness(IDLE_NEW, newForm({ fromRequest: REQUEST, genreIds: [G_VIP] }));
    expect(state.ok).toBe(true);
    expect(state.created).toEqual({ id: BIZ, name: "EmeraldBar" });
    expect(state.warnings).toEqual([
      "Its exclusive genres could not be saved. Tick them again on its Profile tab.",
      expect.stringMatching(/The contact was not invited\. .*SUPABASE_SECRET_KEY/),
    ]);
    expect(state.message).toMatch(/already closed/);
  });

  it("does not invite when the admin is rate limited, and says so", async () => {
    const { inviteUserByEmail } = world();
    h.consumeRateLimit.mockResolvedValue({ allowed: false, reason: "limited" });
    const state = await createBusiness(IDLE_NEW, newForm());
    expect(state.created).not.toBeNull();
    expect(state.warnings[0]).toMatch(/not invited: .*Wait a few minutes/);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("creates nothing when the insert fails", async () => {
    const { fake } = world({ insertError: true });
    const state = await createBusiness(IDLE_NEW, newForm());
    expect(state).toMatchObject({ ok: false, created: null, message: "You don't have permission to do that." });
    expect(state.values?.name).toBe(" EmeraldBar ");
    expect(fake.rpcCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

describe("saveBusinessProfile", () => {
  function profileForm(overrides: Record<string, string | string[]> = {}) {
    const fields: Record<string, string | string[]> = {
      businessId: BIZ,
      name: "EmeraldBar",
      businessType: "bar",
      stationName: "Emerald Radio",
      namePronunciation: "",
      stationNamePronunciation: "",
      contactEmail: "",
      announcementLanguage: "en",
      isActive: "true",
      shownGenreIds: [G_JAZZ, G_VIP],
      genreIds: [G_VIP],
      ...overrides,
    };
    const entries: [string, string][] = [];
    for (const [key, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) entries.push([key, item]);
    }
    return form(entries);
  }

  function respond(options: { before?: object; after?: object | null; current?: string[]; announcements?: number } = {}): Responder {
    return (call) => {
      if (call.table === "businesses" && call.op === "select") return { data: options.before ?? { branding_version: 2, is_active: true } };
      if (call.table === "businesses" && call.op === "update") {
        return { data: options.after === undefined ? { name: "EmeraldBar", branding_version: 2, is_active: true } : options.after };
      }
      if (call.table === "genres") return { data: GENRE_ROWS };
      if (call.table === "business_genre_access") return { data: (options.current ?? [G_JAZZ]).map((genre_id) => ({ genre_id })) };
      if (call.table === "announcements") return { count: options.announcements ?? 0 };
      return undefined;
    };
  }

  it("saves details, type and status in one update and the genre access with the RPC", async () => {
    const fake = installClient(respond());
    const state = await saveBusinessProfile(IDLE, profileForm());
    expect(state.ok).toBe(true);
    const update = fake.calls.find((call) => call.op === "update")!;
    expect(update.payload).toEqual({
      name: "EmeraldBar",
      station_name: "Emerald Radio",
      name_pronunciation: null,
      station_name_pronunciation: null,
      contact_email: null,
      announcement_language: "en",
      business_type: "bar",
      is_active: true,
    });
    expect(eqValue(update, "id")).toBe(BIZ);
    expect(fake.rpcCalls).toEqual([{ fn: "set_business_genre_access", args: { p_business_id: BIZ, p_genre_ids: [G_VIP] } }]);
    expect(state.message).toBe("Changes saved. EmeraldBar can now choose 2 genres.");
  });

  it("explains branding and status changes", async () => {
    installClient(
      respond({ before: { branding_version: 2, is_active: true }, after: { name: "EmeraldBar", branding_version: 3, is_active: false }, current: [G_VIP], announcements: 3 }),
    );
    const state = await saveBusinessProfile(IDLE, profileForm({ isActive: "false" }));
    expect(state.message).toMatch(/3 announcements are marked for review/);
    expect(state.message).toMatch(/EmeraldBar is now inactive/);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/announcements");
  });

  it("never clears a genre the form did not offer", async () => {
    // Jazz was not shown (e.g. it became exclusive after the page loaded): its row stays.
    const fake = installClient(respond({ current: [G_JAZZ] }));
    await saveBusinessProfile(IDLE, profileForm({ shownGenreIds: [G_VIP], genreIds: [] }));
    expect(fake.rpcCalls).toEqual([]);
  });

  it("reports a partial save when the genre access fails", async () => {
    installClient(respond(), () => ({ error: { code: "XX000", message: "boom" } }));
    const state = await saveBusinessProfile(IDLE, profileForm());
    expect(state).toMatchObject({ ok: false, saved: true });
    expect(state.message).toMatch(/^The profile was saved, but genre access could not be saved/);
    expect(state.values?.genreIds).toBe(G_VIP);
  });

  it("validates before writing and requires the status", async () => {
    const fake = installClient(respond());
    const state = await saveBusinessProfile(IDLE, profileForm({ name: " ", isActive: "maybe" }));
    expect(state.fieldErrors).toMatchObject({ name: "Business name is required.", isActive: "Choose yes or no." });
    expect(fake.calls).toEqual([]);
    expect((await saveBusinessProfile(IDLE, profileForm({ businessId: "nope" }))).ok).toBe(false);
  });

  it("says when the business no longer exists", async () => {
    installClient((call) => (call.table === "businesses" ? { data: null } : { data: [] }));
    expect(await saveBusinessProfile(IDLE, profileForm())).toMatchObject({ ok: false, message: "This business no longer exists." });
  });
});

describe("setBusinessActive", () => {
  it("validates its arguments", async () => {
    const fake = installClient(() => undefined);
    expect((await setBusinessActive("bad-id", true)).ok).toBe(false);
    expect((await setBusinessActive(BIZ, "yes" as unknown as boolean)).ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("updates is_active and explains the effect", async () => {
    const fake = installClient(() => ({ data: { name: "EmeraldBar", is_active: false } }));
    const state = await setBusinessActive(BIZ, false);
    expect(state).toMatchObject({ ok: true });
    expect(state.message).toMatch(/inactive/);
    expect(fake.calls[0]).toMatchObject({ table: "businesses", op: "update", payload: { is_active: false } });
  });
});

// ---------------------------------------------------------------------------
// Access: invitations, resets, members
// ---------------------------------------------------------------------------

describe("inviteMember", () => {
  function inviteForm(email: string, delivery = "email") {
    return form([
      ["businessId", BIZ],
      ["email", email],
      ["delivery", delivery],
    ]);
  }

  it("validates the address before consuming the rate limit", async () => {
    installClient(() => undefined);
    const state = await inviteMember(IDLE_MEMBER, inviteForm("nope"));
    expect(state).toMatchObject({ ok: false, fieldErrors: { email: "Enter a valid email address." }, values: { email: "nope" } });
    expect(h.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("is rate limited per admin", async () => {
    const fake = installClient(() => undefined);
    h.consumeRateLimit.mockResolvedValue({ allowed: false, reason: "limited" });
    const state = await inviteMember(IDLE_MEMBER, inviteForm("staff@venue.example"));
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/Wait a few minutes/);
    expect(fake.calls).toEqual([]);
  });

  it("explains a missing secret key", async () => {
    installClient(() => undefined);
    h.adminError = new EnvError("SUPABASE_SECRET_KEY", "missing");
    const state = await inviteMember(IDLE_MEMBER, inviteForm("staff@venue.example"));
    expect(state.message).toMatch(/SUPABASE_SECRET_KEY/);
  });

  it("returns a one-time link that lands on /reset-password", async () => {
    installClient((call) => {
      if (call.table === "businesses") return { data: { id: BIZ, name: "EmeraldBar" } };
      if (call.table === "profiles") return { data: [] };
      return undefined;
    });
    h.admin = {
      auth: {
        admin: {
          generateLink: vi.fn(async () => ({
            data: {
              properties: { hashed_token: "abcdef0123456789", action_link: "", email_otp: "", redirect_to: "", verification_type: "invite" },
              user: authUser({ email: "staff@venue.example" }),
            },
            error: null,
          })),
        },
      },
    };
    const state = await inviteMember(IDLE_MEMBER, inviteForm("staff@venue.example", "link"));
    expect(state.link?.url).toBe("http://localhost:3000/auth/confirm?token_hash=abcdef0123456789&type=invite&next=/reset-password");
  });
});

describe("sendBusinessPasswordReset", () => {
  function venue(members: string[]) {
    return installClient((call) => {
      if (call.table === "businesses") return { data: { id: BIZ, name: "EmeraldBar" } };
      if (call.table === "business_members" && call.columns === "user_id") return { data: members.map((user_id) => ({ user_id })) };
      if (call.table === "business_members") return { data: { business_id: BIZ, businesses: { name: "EmeraldBar" } } };
      if (call.table === "profiles") return { data: { id: USER, email: "manager@emeraldbar.example", role: "business_user" } };
      return undefined;
    });
  }

  it("refuses a venue without staff accounts, before using the rate limit", async () => {
    venue([]);
    const state = await sendBusinessPasswordReset(BIZ);
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/no staff account yet/);
    expect(h.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("sends a password reset to an account that accepted its invitation", async () => {
    venue([USER]);
    const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
    h.admin = {
      auth: {
        resetPasswordForEmail,
        admin: {
          getUserById: vi.fn(async () => ({ data: { user: authUser({ email_confirmed_at: "2026-09-02T00:00:00Z" }) }, error: null })),
        },
      },
    };
    const state = await sendBusinessPasswordReset(BIZ);
    expect(state.ok).toBe(true);
    expect(state.message).toMatch(/Password reset email sent to manager@emeraldbar\.example/);
    expect(resetPasswordForEmail).toHaveBeenCalledWith("manager@emeraldbar.example", { redirectTo: "http://localhost:3000" });
  });

  it("validates the id", async () => {
    const fake = installClient(() => undefined);
    expect((await sendBusinessPasswordReset("nope")).ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe("removeMember", () => {
  it("deletes only the membership", async () => {
    const fake = installClient((call) => {
      if (call.table === "profiles") return { data: { email: "staff@venue.example" } };
      if (call.table === "business_members") return { data: [{ user_id: USER }] };
      return undefined;
    });
    const state = await removeMember(BIZ, USER);
    expect(state.ok).toBe(true);
    expect(state.message).toMatch(/staff@venue\.example was removed/);
    const deletion = fake.calls.find((call) => call.op === "delete")!;
    expect(deletion.table).toBe("business_members");
    expect(eqValue(deletion, "business_id")).toBe(BIZ);
    expect(eqValue(deletion, "user_id")).toBe(USER);
  });
});

describe("removeBusinessLogo", () => {
  it("clears logo_path (guarded) and deletes the file with the admin client", async () => {
    const path = `${BIZ}/0123456789abcdef0123456789abcdef.png`;
    const fake = installClient((call) => {
      if (call.op === "select") return { data: { logo_path: path } };
      if (call.op === "update") return { data: { id: BIZ } };
      return undefined;
    });
    const remove = vi.fn(async () => ({ data: [], error: null }));
    h.admin = { storage: { from: vi.fn(() => ({ remove })) } };
    const state = await removeBusinessLogo(BIZ);
    expect(state).toMatchObject({ ok: true });
    const update = fake.calls.find((call) => call.op === "update")!;
    expect(update.payload).toEqual({ logo_path: null });
    expect(eqValue(update, "logo_path")).toBe(path);
    expect(remove).toHaveBeenCalledWith([path]);
  });

  it("still succeeds, honestly, when the file cannot be deleted", async () => {
    installClient((call) => (call.op === "select" ? { data: { logo_path: `${BIZ}/x.png` } } : { data: { id: BIZ } }));
    h.adminError = new EnvError("SUPABASE_SECRET_KEY", "missing");
    const state = await removeBusinessLogo(BIZ);
    expect(state.ok).toBe(true);
    expect(state.message).toMatch(/could not be deleted from storage/);
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe("deleteBusiness", () => {
  const LOGO = `${BIZ}/logo.png`;
  const AUDIO = `${BIZ}/ann1/a.mp3`;

  function world(options: { removeFails?: boolean; deleteNothing?: boolean } = {}) {
    const events: string[] = [];
    const fake = installClient((call) => {
      events.push(`${call.op}:${call.table}`);
      if (call.table === "businesses" && call.op === "select") {
        return { data: { id: BIZ, name: "EmeraldBar", is_active: true, logo_path: LOGO } };
      }
      if (call.table === "announcements") return { data: [{ audio_path: AUDIO }] };
      if (call.op === "delete") return { data: options.deleteNothing ? [] : [{ id: BIZ }] };
      return undefined;
    });
    const buckets: Record<string, string[]> = { logos: [LOGO, `${BIZ}/stray.png`], announcements: [AUDIO] };
    h.admin = {
      storage: {
        from: (bucket: string) => ({
          list: async (prefix: string) => {
            const inside = buckets[bucket].filter((path) => path.startsWith(`${prefix}/`)).map((path) => path.slice(prefix.length + 1));
            const names = [...new Set(inside.map((rest) => rest.split("/")[0]))];
            return {
              data: names.map((name) => ({ name, id: inside.includes(name) ? `id-${name}` : null })),
              error: null,
            };
          },
          remove: async (paths: string[]) => {
            events.push(`remove:${bucket}:${paths.sort().join(",")}`);
            return options.removeFails ? { data: null, error: { message: "boom" } } : { data: [], error: null };
          },
        }),
      },
    };
    return { fake, events };
  }

  it("refuses without the exact name", async () => {
    const { events } = world();
    const state = await deleteBusiness(BIZ, "emeraldbar");
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/Nothing was deleted/);
    expect(events.some((event) => event.startsWith("update") || event.startsWith("delete") || event.startsWith("remove"))).toBe(false);
  });

  it("deactivates, removes the files, deletes the row and reports success", async () => {
    const { events } = world();
    const state = await deleteBusiness(BIZ, " EmeraldBar ");
    expect(state.ok).toBe(true);
    expect(state.message).toMatch(/^EmeraldBar was deleted/);
    const mutations = events.filter((event) => !event.startsWith("select"));
    expect(mutations).toEqual([
      "update:businesses",
      `remove:logos:${BIZ}/logo.png,${BIZ}/stray.png`,
      `remove:announcements:${AUDIO}`,
      "delete:businesses",
    ]);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/businesses", "layout");
  });

  it("keeps the business when the files cannot be removed", async () => {
    const { events } = world({ removeFails: true });
    const state = await deleteBusiness(BIZ, "EmeraldBar");
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/was not deleted/);
    expect(events).not.toContain("delete:businesses");
  });

  it("does not claim success when the delete removed nothing but the row is still there", async () => {
    world({ deleteNothing: true });
    const state = await deleteBusiness(BIZ, "EmeraldBar");
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/could not be deleted/);
  });

  it("needs the secret key before changing anything", async () => {
    const { events } = world();
    h.adminError = new EnvError("SUPABASE_SECRET_KEY", "missing");
    const state = await deleteBusiness(BIZ, "EmeraldBar");
    expect(state.message).toMatch(/SUPABASE_SECRET_KEY/);
    expect(events.some((event) => !event.startsWith("select"))).toBe(false);
  });
});
