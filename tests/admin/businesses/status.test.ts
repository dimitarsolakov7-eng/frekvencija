import { describe, expect, it, vi } from "vitest";
import { countBusinessStatuses, filterBusinesses, matchesBusinessSearch, normalizeSearchQuery } from "@/components/admin/businesses/business-list";
import { deriveBusinessStatus, isBusinessStatusFilter } from "@/components/admin/businesses/business-status";
import {
  countAcceptedMembers,
  loadAdminBusinessList,
  type AuthUserDirectory,
  type AuthUserSnapshot,
  type BusinessMember,
  type MemberStatus,
} from "@/lib/data/admin/businesses";
import { createFakeClient } from "./fake-client";

describe("deriveBusinessStatus", () => {
  it("is Inactive whenever the venue is deactivated, whatever its accounts", () => {
    expect(deriveBusinessStatus({ isActive: false, memberCount: 2, acceptedMemberCount: 2 })).toMatchObject({
      status: "inactive",
      label: "Inactive",
      tone: "neutral",
      verified: true,
    });
    expect(deriveBusinessStatus({ isActive: false, memberCount: 0, acceptedMemberCount: null }).status).toBe("inactive");
  });

  it("is Active when an active venue has at least one accepted staff account", () => {
    expect(deriveBusinessStatus({ isActive: true, memberCount: 1, acceptedMemberCount: 1 })).toMatchObject({
      status: "active",
      tone: "success",
      detail: "The staff account can sign in.",
    });
    expect(deriveBusinessStatus({ isActive: true, memberCount: 3, acceptedMemberCount: 1 }).detail).toBe("1 of 3 staff accounts can sign in.");
    expect(deriveBusinessStatus({ isActive: true, memberCount: 2, acceptedMemberCount: 2 }).detail).toBe("All 2 staff accounts can sign in.");
  });

  it("is Invited when nobody has accepted yet, or nobody was invited yet", () => {
    expect(deriveBusinessStatus({ isActive: true, memberCount: 1, acceptedMemberCount: 0 })).toMatchObject({
      status: "invited",
      label: "Invited",
      tone: "warning",
      detail: "The invitation hasn’t been accepted yet.",
    });
    expect(deriveBusinessStatus({ isActive: true, memberCount: 0, acceptedMemberCount: 0 })).toMatchObject({
      status: "invited",
      detail: expect.stringContaining("No staff account yet"),
    });
    // With no members there is nothing to verify, so the status is certain even without Auth.
    expect(deriveBusinessStatus({ isActive: true, memberCount: 0, acceptedMemberCount: null })).toMatchObject({ status: "invited", verified: true });
  });

  it("does not guess Invited when the sign-in statuses are unavailable", () => {
    expect(deriveBusinessStatus({ isActive: true, memberCount: 2, acceptedMemberCount: null })).toMatchObject({
      status: "active",
      verified: false,
      detail: expect.stringContaining("unavailable"),
    });
  });
});

describe("countAcceptedMembers", () => {
  const member = (kind: MemberStatus["kind"]): Pick<BusinessMember, "status"> => ({
    status: { kind, label: kind, tone: "neutral", detail: null, access: null },
  });

  it("counts accepted accounts, and is unknown only when nothing accepted could be seen", () => {
    expect(countAcceptedMembers([member("active"), member("invited")])).toBe(1);
    expect(countAcceptedMembers([member("active"), member("unknown")])).toBe(1);
    expect(countAcceptedMembers([member("invited"), member("suspended")])).toBe(0);
    expect(countAcceptedMembers([member("invited"), member("unknown")])).toBeNull();
    expect(countAcceptedMembers([])).toBe(0);
  });
});

describe("list filtering", () => {
  const items = [
    { name: "EmeraldBar", stationName: "EmeraldBar Radio", contactEmail: "manager@emeraldbar.example", status: "active" as const },
    { name: "Café Central", stationName: "Café Central Radio", contactEmail: null, status: "invited" as const },
    { name: "Restaurant Olive", stationName: "Olive Radio", contactEmail: "office@olive.example", status: "inactive" as const },
  ];

  it("combines the accent-insensitive search with the status filter", () => {
    expect(filterBusinesses(items, { query: "", status: "all" })).toHaveLength(3);
    expect(filterBusinesses(items, { query: "cafe", status: "all" }).map((item) => item.name)).toEqual(["Café Central"]);
    expect(filterBusinesses(items, { query: "radio", status: "inactive" }).map((item) => item.name)).toEqual(["Restaurant Olive"]);
    expect(filterBusinesses(items, { query: "manager@", status: "invited" })).toEqual([]);
    expect(filterBusinesses(items, { query: "  olive   office ", status: "all" })).toHaveLength(1);
  });

  it("counts the statuses and validates the filter value", () => {
    expect(countBusinessStatuses(items)).toEqual({ total: 3, active: 1, invited: 1, inactive: 1 });
    expect(isBusinessStatusFilter("invited")).toBe(true);
    expect(isBusinessStatusFilter("pending")).toBe(false);
  });

  it("keeps the search helpers of the loader module", () => {
    expect(normalizeSearchQuery(["  Emerald   Bar ", "x"])).toBe("Emerald Bar");
    expect(matchesBusinessSearch(items[0], "EMERALDBAR radio")).toBe(true);
  });
});

describe("loadAdminBusinessList", () => {
  const NOW = new Date("2026-09-25T12:00:00Z");
  const account = (id: string, overrides: Partial<AuthUserSnapshot> = {}): AuthUserSnapshot => ({
    id,
    email: `${id}@venue.example`,
    invitedAt: "2026-09-20T00:00:00Z",
    emailConfirmedAt: null,
    lastSignInAt: null,
    bannedUntil: null,
    createdAt: "2026-09-20T00:00:00Z",
    ...overrides,
  });

  const rows = [
    {
      id: "b-emerald",
      name: "EmeraldBar",
      station_name: "EmeraldBar Radio",
      business_type: "bar",
      is_active: true,
      contact_email: "manager@emeraldbar.example",
      logo_path: "b-emerald/logo.png",
      business_members: [{ user_id: "u-accepted", profiles: { email: "manager@emeraldbar.example" } }],
    },
    {
      id: "b-cafe",
      name: "Café Central",
      station_name: "Café Central Radio",
      business_type: "cafe",
      is_active: true,
      contact_email: null,
      logo_path: null,
      business_members: [{ user_id: "u-pending", profiles: { email: "hello@cafecentral.example" } }],
    },
    {
      id: "b-new",
      name: "Hotel Aurora",
      station_name: "Hotel Aurora Radio",
      business_type: "mystery",
      is_active: true,
      contact_email: null,
      logo_path: null,
      business_members: [],
    },
    {
      id: "b-olive",
      name: "Restaurant Olive",
      station_name: "Restaurant Olive Radio",
      business_type: "restaurant",
      is_active: false,
      contact_email: null,
      logo_path: null,
      business_members: [{ user_id: "u-accepted-2", profiles: null }],
    },
  ];

  function client() {
    const createSignedUrls = vi.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://storage.example/${path}?token=t`, error: null })),
      error: null,
    }));
    const fake = createFakeClient(
      (call) => (call.table === "businesses" ? { data: rows } : undefined),
      undefined,
      { storage: { from: () => ({ createSignedUrls }) } },
    );
    return { fake, createSignedUrls };
  }

  const directory = (result: Awaited<ReturnType<AuthUserDirectory["listUsers"]>>): AuthUserDirectory => ({
    listUsers: vi.fn(async () => result),
  });

  it("derives Active / Invited / Inactive from one Auth listing", async () => {
    const { fake, createSignedUrls } = client();
    const list = await loadAdminBusinessList(fake.client, {
      now: NOW,
      authUsers: directory({
        ok: true,
        value: [
          account("u-accepted", { emailConfirmedAt: "2026-09-21T00:00:00Z" }),
          account("u-pending"),
          account("u-accepted-2", { emailConfirmedAt: "2026-09-21T00:00:00Z" }),
        ],
      }),
    });

    expect(list.statusNote).toBeNull();
    expect(list.items.map((item) => [item.name, item.status])).toEqual([
      ["EmeraldBar", "active"],
      ["Café Central", "invited"],
      ["Hotel Aurora", "invited"],
      ["Restaurant Olive", "inactive"],
    ]);
    expect(list.items[0]).toMatchObject({
      businessType: "bar",
      memberCount: 1,
      acceptedMemberCount: 1,
      memberEmails: ["manager@emeraldbar.example"],
      logoUrl: "https://storage.example/b-emerald/logo.png?token=t",
      statusVerified: true,
    });
    expect(list.items[2]).toMatchObject({ businessType: "other", memberCount: 0, memberEmails: [] });
    expect(list.items[3].memberEmails).toEqual([]);
    expect(createSignedUrls).toHaveBeenCalledOnce();
    expect(fake.calls[0].columns).toContain("business_members ( user_id, profiles ( email ) )");
  });

  it("marks active venues as unverified when the Auth listing fails", async () => {
    const { fake } = client();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const list = await loadAdminBusinessList(fake.client, { now: NOW, authUsers: directory({ ok: false, error: new Error("down") }) });
    expect(list.statusNote).toMatch(/couldn’t be confirmed/);
    expect(list.items[0]).toMatchObject({ status: "active", acceptedMemberCount: null, statusVerified: false });
    expect(list.items[2]).toMatchObject({ status: "invited", statusVerified: true });
    vi.restoreAllMocks();
  });

  it("explains a missing secret key", async () => {
    const { fake } = client();
    const list = await loadAdminBusinessList(fake.client, { authUsers: null, authUnavailableReason: "No secret key." });
    expect(list.statusNote).toBe("No secret key.");
  });

  it("throws on a failed query so the page can show its error state", async () => {
    const fake = createFakeClient(() => ({ error: { code: "XX000", message: "down" } }));
    await expect(loadAdminBusinessList(fake.client, { authUsers: null })).rejects.toThrow("Could not load the businesses.");
  });
});
