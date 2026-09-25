import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { parseConfirmParams } from "@/app/(auth)/_lib/confirm";
import { summarizeAnnouncements as summarizeStudioAnnouncements } from "@/components/admin/announcements/rules";
import {
  buildAuthConfirmLink,
  buildGenreAccessOptions,
  computeGenreAccessUpdate,
  countAccessibleGenres,
  deleteConfirmationMatches,
  deriveMemberStatus,
  describeAuthAdminError,
  isAcceptedAuthUser,
  isEmailExistsError,
  matchesBusinessSearch,
  normalizeSearchQuery,
  summarizeAnnouncements,
  toAdminBusinessRecord,
  toAuthUserSnapshot,
  toBusinessDetailsUpdate,
  toBusinessInsert,
  toBusinessProfileUpdate,
  toBusinessType,
  type AnnouncementSummaryRow,
  type AuthUserSnapshot,
  type GenreAccessGenre,
} from "@/lib/data/admin/businesses";
import { businessCreateSchema, businessProfileSchema, businessUpdateSchema, genreAccessUpdateSchema } from "@/lib/validation/businesses";
import type { Tables } from "@/types/database";

const G = {
  lounge: "11111111-1111-4111-8111-111111111111",
  jazz: "22222222-2222-4222-8222-222222222222",
  vip: "33333333-3333-4333-8333-333333333333",
  retired: "44444444-4444-4444-8444-444444444444",
  retiredShared: "55555555-5555-4555-8555-555555555555",
  gone: "66666666-6666-4666-8666-666666666666",
};

const GENRES: GenreAccessGenre[] = [
  { id: G.lounge, name: "Lounge", isEnabled: true, availableToAll: true },
  { id: G.jazz, name: "Jazz", isEnabled: true, availableToAll: false },
  { id: G.vip, name: "VIP", isEnabled: true, availableToAll: false },
  { id: G.retired, name: "Retired exclusive", isEnabled: false, availableToAll: false },
  { id: G.retiredShared, name: "Retired shared", isEnabled: false, availableToAll: true },
];

describe("search", () => {
  it("normalises the q parameter", () => {
    expect(normalizeSearchQuery(undefined)).toBe("");
    expect(normalizeSearchQuery(null)).toBe("");
    expect(normalizeSearchQuery("  Emerald   Bar ")).toBe("Emerald Bar");
    expect(normalizeSearchQuery(["first", "second"])).toBe("first");
    expect(normalizeSearchQuery("x".repeat(500))).toHaveLength(100);
  });

  const business = { name: "Café Zürich", stationName: "Zürich Lounge Radio", contactEmail: "Owner@Cafe.example" };

  it("matches every term case- and accent-insensitively across name, station and email", () => {
    expect(matchesBusinessSearch(business, "")).toBe(true);
    expect(matchesBusinessSearch(business, "cafe")).toBe(true);
    expect(matchesBusinessSearch(business, "ZURICH lounge")).toBe(true);
    expect(matchesBusinessSearch(business, "owner@cafe")).toBe(true);
    expect(matchesBusinessSearch(business, "cafe hotel")).toBe(false);
    expect(matchesBusinessSearch({ ...business, contactEmail: null }, "owner")).toBe(false);
  });
});

describe("summarizeAnnouncements", () => {
  const NOW = Date.parse("2026-09-25T12:00:00.000Z");
  const APPROVED_AT = "2026-09-21T10:00:00.000Z";
  const row = (overrides: Partial<AnnouncementSummaryRow>): AnnouncementSummaryRow => ({
    status: "active",
    needsReview: false,
    hasAudio: true,
    brandingVersion: 3,
    approvedAt: APPROVED_AT,
    ...overrides,
  });
  const fresh = (overrides: Partial<AnnouncementSummaryRow>) => row({ hasAudio: false, approvedAt: null, ...overrides });

  it("counts on-air, review, approval, switched-off, failed and draft announcements", () => {
    const summary = summarizeAnnouncements(
      [
        row({}),
        row({}),
        row({ needsReview: true }),
        row({ brandingVersion: 2 }), // approved for an older branding: off air
        row({ status: "ready", approvedAt: null }),
        row({ status: "ready" }), // approved, then deactivated
        fresh({ status: "failed" }),
        fresh({ status: "draft", needsReview: true }),
        fresh({ status: "generating", generationStartedAt: new Date(NOW - 30_000).toISOString() }),
      ],
      3,
      NOW,
    );
    expect(summary).toEqual({
      total: 9,
      onAir: 2,
      onAirWelcome: 0,
      onAirRotation: 2,
      needsReview: 3,
      awaitingApproval: 1,
      switchedOff: 1,
      failed: 1,
      inProgress: 1,
      byStatus: { draft: 1, generating: 1, ready: 2, failed: 1, active: 4 },
    });
  });

  // BIZ-02: two approved clips switched off and one ready clip flagged after a rename.
  it("does not count switched-off approvals as awaiting approval, and counts flagged clips that are not on air", () => {
    const summary = summarizeAnnouncements(
      [row({ status: "ready" }), row({ status: "ready" }), row({ status: "ready", approvedAt: null, needsReview: true })],
      3,
      NOW,
    );
    expect(summary).toMatchObject({ awaitingApproval: 0, switchedOff: 2, needsReview: 1, onAir: 0, failed: 0, inProgress: 0 });
  });

  it("counts a stalled generation as failed", () => {
    const stalled = fresh({ status: "generating", generationStartedAt: new Date(NOW - 10 * 60_000).toISOString() });
    expect(summarizeAnnouncements([stalled], 3, NOW)).toMatchObject({ failed: 1, inProgress: 0 });
  });

  it("gives the same numbers as the announcements studio for the same clips", () => {
    const rows: AnnouncementSummaryRow[] = [
      row({ placement: "welcome" }),
      row({ placement: "both", brandingVersion: 2 }),
      row({ status: "ready" }),
      row({ status: "ready", approvedAt: null }),
      row({ status: "ready", approvedAt: null, needsReview: true }),
      fresh({ status: "failed" }),
      fresh({ status: "draft" }),
      fresh({ status: "draft", needsReview: true }),
    ];
    const studio = summarizeStudioAnnouncements(
      rows.map((entry) => ({ ...entry, placement: entry.placement ?? "rotation", generationStartedAt: entry.generationStartedAt ?? null })),
      { brandingVersion: 3 },
      NOW,
    );
    const business = summarizeAnnouncements(rows, 3, NOW);
    expect(business).toMatchObject({
      total: studio.total,
      onAir: studio.onAir,
      onAirWelcome: studio.onAirWelcome,
      onAirRotation: studio.onAirRotation,
      needsReview: studio.needsReview,
      awaitingApproval: studio.awaitingApproval,
      switchedOff: studio.switchedOff,
      failed: studio.failed,
      inProgress: studio.drafts + studio.generating,
    });
    expect(business).toMatchObject({ onAir: 1, needsReview: 3, awaitingApproval: 1, switchedOff: 1, failed: 1, inProgress: 1 });
  });

  it("splits on-air clips by placement (both counts for welcome and station identity)", () => {
    const summary = summarizeAnnouncements(
      [row({ placement: "welcome" }), row({ placement: "both" }), row({ placement: "rotation" }), row({ placement: "welcome", needsReview: true })],
      3,
      NOW,
    );
    expect(summary).toMatchObject({ onAir: 3, onAirWelcome: 2, onAirRotation: 2, needsReview: 1 });
  });

  it("is all zeros without announcements", () => {
    expect(summarizeAnnouncements([], 1)).toMatchObject({ total: 0, onAir: 0, needsReview: 0, switchedOff: 0 });
  });
});

describe("genre access", () => {
  it("builds options: shared genres included, exclusive ones editable, disabled ones locked", () => {
    const options = buildGenreAccessOptions(GENRES, [G.jazz, G.retired], new Map([[G.lounge, 12]]));
    const byId = new Map(options.map((option) => [option.id, option]));
    expect(byId.get(G.lounge)).toMatchObject({ accessible: true, editable: false, assigned: false, playableTrackCount: 12 });
    expect(byId.get(G.jazz)).toMatchObject({ accessible: true, editable: true, assigned: true, playableTrackCount: 0 });
    expect(byId.get(G.vip)).toMatchObject({ accessible: false, editable: true, assigned: false });
    expect(byId.get(G.retired)).toMatchObject({ accessible: false, editable: false, assigned: true });
    expect(byId.get(G.retiredShared)).toMatchObject({ accessible: false, editable: false });
    expect(buildGenreAccessOptions(GENRES, [], null)[0].playableTrackCount).toBeNull();
  });

  it("counts accessible genres (enabled and shared or assigned)", () => {
    expect(countAccessibleGenres(GENRES, [])).toBe(1);
    expect(countAccessibleGenres(GENRES, [G.jazz, G.vip, G.retired])).toBe(3);
  });

  it("replaces the editable part of the set and keeps locked rows", () => {
    const update = computeGenreAccessUpdate(GENRES, [G.jazz, G.retired, G.retiredShared], [G.vip]);
    expect(update.next).toEqual([G.vip, G.retired, G.retiredShared]);
    expect(update.added).toEqual([G.vip]);
    expect(update.removed).toEqual([G.jazz]);
    expect(update.ignored).toEqual([]);
    expect(update.changed).toBe(true);
  });

  it("ignores submitted ids that are unknown, shared or disabled", () => {
    const update = computeGenreAccessUpdate(GENRES, [G.jazz], [G.jazz, G.lounge, G.retired, G.gone]);
    expect(update.next).toEqual([G.jazz]);
    expect(update.ignored).toEqual([G.lounge, G.retired, G.gone]);
    expect(update.changed).toBe(false);
  });

  it("leaves genres the form did not offer as they are (shownIds)", () => {
    // VIP became exclusive after the form was loaded: it had a kept row and was not shown as a tile.
    const update = computeGenreAccessUpdate(GENRES, [G.jazz, G.vip], [], [G.jazz]);
    expect(update.next).toEqual([G.vip]);
    expect(update.removed).toEqual([G.jazz]);
    const ignored = computeGenreAccessUpdate(GENRES, [], [G.jazz, G.vip], [G.jazz]);
    expect(ignored.next).toEqual([G.jazz]);
    expect(ignored.ignored).toEqual([G.vip]);
  });

  it("clears the set when nothing is ticked, and reports stale rows as a change", () => {
    expect(computeGenreAccessUpdate(GENRES, [G.jazz, G.vip], [])).toMatchObject({ next: [], removed: [G.jazz, G.vip], changed: true });
    expect(computeGenreAccessUpdate(GENRES, [G.gone], [])).toMatchObject({ next: [], changed: true });
    expect(computeGenreAccessUpdate(GENRES, [], [])).toMatchObject({ next: [], changed: false });
  });

  it("parses the form payload (single value, many values, duplicates, bad ids)", () => {
    const businessId = "77777777-7777-4777-8777-777777777777";
    expect(genreAccessUpdateSchema.parse({ businessId, genreIds: G.jazz }).genreIds).toEqual([G.jazz]);
    expect(genreAccessUpdateSchema.parse({ businessId, genreIds: [G.jazz, G.vip, G.jazz] }).genreIds).toEqual([G.jazz, G.vip]);
    expect(genreAccessUpdateSchema.parse({ businessId, genreIds: [] }).genreIds).toEqual([]);
    expect(genreAccessUpdateSchema.safeParse({ businessId, genreIds: ["not-a-uuid"] }).success).toBe(false);
    expect(genreAccessUpdateSchema.safeParse({ businessId: "x", genreIds: [] }).success).toBe(false);
  });
});

describe("business rows", () => {
  it("maps create input to an insert with the type and the default announcement frequency", () => {
    const input = businessCreateSchema.parse({
      name: "  EmeraldBar ",
      stationName: "EmeraldBar Radio",
      namePronunciation: " ",
      contactEmail: "",
      announcementLanguage: "bg",
      isActive: "true",
    });
    expect(toBusinessInsert(input)).toEqual({
      name: "EmeraldBar",
      station_name: "EmeraldBar Radio",
      name_pronunciation: null,
      station_name_pronunciation: null,
      contact_email: null,
      announcement_language: "bg",
      business_type: "other",
      is_active: true,
      announcement_every_n_tracks: 4,
    });
    const hotel = businessCreateSchema.parse({ name: "Hotel Aurora", stationName: "Hotel Aurora Radio", businessType: "hotel" });
    expect(toBusinessInsert({ ...hotel, announcementEveryNTracks: 7 })).toMatchObject({ business_type: "hotel", announcement_every_n_tracks: 7 });
  });

  it("maps only the details fields that were submitted", () => {
    const input = businessUpdateSchema.parse({
      name: "Hotel Aurora",
      stationNamePronunciation: "",
      isActive: "true",
      announcementEveryNTracks: "9",
    });
    expect(toBusinessDetailsUpdate(input)).toEqual({ name: "Hotel Aurora", station_name_pronunciation: null });
    expect(toBusinessDetailsUpdate(businessUpdateSchema.parse({ businessType: "cafe" }))).toEqual({ business_type: "cafe" });
  });

  it("maps the profile form (details, type and status) to one update", () => {
    const input = businessProfileSchema.parse({
      name: " Café Central ",
      stationName: "Café Central Radio",
      namePronunciation: "",
      stationNamePronunciation: "Kafe Central Radio",
      contactEmail: "hello@cafecentral.example",
      announcementLanguage: "sr",
      businessType: "cafe",
      isActive: "false",
    });
    expect(toBusinessProfileUpdate(input)).toEqual({
      name: "Café Central",
      station_name: "Café Central Radio",
      name_pronunciation: null,
      station_name_pronunciation: "Kafe Central Radio",
      contact_email: "hello@cafecentral.example",
      announcement_language: "sr",
      business_type: "cafe",
      is_active: false,
    });
    // Every field is required on the profile form: a missing status is an error, not "unchanged".
    expect(businessProfileSchema.safeParse({ ...input, isActive: undefined }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...input, businessType: "pub" }).success).toBe(false);
  });

  it("falls back to 'other' for an unknown business type", () => {
    expect(toBusinessType("hotel")).toBe("hotel");
    expect(toBusinessType("pub")).toBe("other");
    expect(toBusinessType(null)).toBe("other");
  });

  it("maps a database row to the admin record", () => {
    const row: Tables<"businesses"> = {
      id: "b1",
      name: "EmeraldBar",
      station_name: "EmeraldBar Radio",
      name_pronunciation: "Emerald Bar",
      station_name_pronunciation: null,
      contact_email: null,
      announcement_language: "en",
      logo_path: null,
      business_type: "bar",
      is_active: true,
      announcement_every_n_tracks: 4,
      announcement_volume: "0.80" as unknown as number, // numeric arrives as a string from PostgREST
      branding_version: 2,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
    };
    expect(toAdminBusinessRecord(row)).toMatchObject({ stationName: "EmeraldBar Radio", businessType: "bar", announcementVolume: 0.8, brandingVersion: 2 });
  });

  it("requires the exact name to confirm a delete", () => {
    expect(deleteConfirmationMatches("EmeraldBar", "EmeraldBar")).toBe(true);
    expect(deleteConfirmationMatches("EmeraldBar", "  EmeraldBar ")).toBe(true);
    expect(deleteConfirmationMatches("EmeraldBar", "emeraldbar")).toBe(false);
    expect(deleteConfirmationMatches("EmeraldBar", "")).toBe(false);
    expect(deleteConfirmationMatches("  ", "  ")).toBe(false);
  });
});

describe("member status", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const user = (overrides: Partial<AuthUserSnapshot>): AuthUserSnapshot => ({
    id: "u1",
    email: "staff@venue.example",
    invitedAt: null,
    emailConfirmedAt: null,
    lastSignInAt: null,
    bannedUntil: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  });

  it("reports an accepted account as active with its last sign-in", () => {
    expect(deriveMemberStatus(user({ emailConfirmedAt: "2026-09-02T10:00:00Z", lastSignInAt: "2026-09-24T08:05:00Z" }), now)).toEqual({
      kind: "active",
      label: "Active",
      tone: "success",
      detail: "Last signed in 24 Sep 2026, 08:05 UTC",
      access: "recovery",
    });
    expect(deriveMemberStatus(user({ emailConfirmedAt: "2026-09-02T10:00:00Z" }), now).detail).toBe("Has not signed in yet");
  });

  it("reports a pending invitation", () => {
    expect(deriveMemberStatus(user({ invitedAt: "2026-09-20T09:30:00Z" }), now)).toMatchObject({
      kind: "invited",
      tone: "warning",
      detail: "Invited 20 Sep 2026, 09:30 UTC · not accepted yet",
      access: "invite",
    });
    expect(deriveMemberStatus(user({}), now)).toMatchObject({ kind: "unconfirmed", access: "invite" });
  });

  it("reports blocked accounts and unknown statuses without access actions", () => {
    expect(deriveMemberStatus(user({ emailConfirmedAt: "2026-09-02T10:00:00Z", bannedUntil: "2027-01-01T00:00:00Z" }), now)).toMatchObject({
      kind: "suspended",
      access: null,
    });
    // An expired ban no longer blocks.
    expect(deriveMemberStatus(user({ emailConfirmedAt: "2026-09-02T10:00:00Z", bannedUntil: "2026-01-01T00:00:00Z" }), now).kind).toBe("active");
    expect(deriveMemberStatus(null, now)).toMatchObject({ kind: "unknown", access: null });
  });

  it("counts an account as accepted only when confirmed and not blocked", () => {
    expect(isAcceptedAuthUser(user({ emailConfirmedAt: "2026-09-02T10:00:00Z" }), now)).toBe(true);
    expect(isAcceptedAuthUser(user({ invitedAt: "2026-09-20T09:30:00Z" }), now)).toBe(false);
    expect(isAcceptedAuthUser(user({ emailConfirmedAt: "2026-09-02T10:00:00Z", bannedUntil: "2027-01-01T00:00:00Z" }), now)).toBe(false);
  });

  it("takes the fields it needs from a Supabase user", () => {
    const snapshot = toAuthUserSnapshot({
      id: "u1",
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-09-01T00:00:00Z",
      email: "a@b.example",
      invited_at: "2026-09-01T00:00:00Z",
      confirmed_at: "2026-09-02T00:00:00Z",
    });
    expect(snapshot).toEqual({
      id: "u1",
      email: "a@b.example",
      invitedAt: "2026-09-01T00:00:00Z",
      emailConfirmedAt: "2026-09-02T00:00:00Z",
      lastSignInAt: null,
      bannedUntil: null,
      createdAt: "2026-09-01T00:00:00Z",
    });
  });
});

describe("one-time links", () => {
  it("builds the /auth/confirm link that the confirm page accepts", () => {
    const link = buildAuthConfirmLink("https://radio.example.com/", "0123456789abcdef0123456789abcdef", "invite");
    expect(link).toBe(
      "https://radio.example.com/auth/confirm?token_hash=0123456789abcdef0123456789abcdef&type=invite&next=/reset-password",
    );
    const url = new URL(link);
    expect(parseConfirmParams(Object.fromEntries(url.searchParams))).toEqual({
      kind: "otp",
      tokenHash: "0123456789abcdef0123456789abcdef",
      type: "invite",
      next: "/reset-password",
    });
    const recovery = new URL(buildAuthConfirmLink("http://localhost:3000", "pkce_abcdef012345", "recovery"));
    expect(parseConfirmParams(Object.fromEntries(recovery.searchParams))).toMatchObject({ kind: "otp", type: "recovery" });
  });

  it("refuses an empty or malformed token", () => {
    expect(() => buildAuthConfirmLink("http://localhost:3000", "", "invite")).toThrow();
    expect(() => buildAuthConfirmLink("http://localhost:3000", "abc&next=//evil", "invite")).toThrow();
  });
});

describe("auth admin errors", () => {
  const apiError = (status: number, code: string | undefined, message = "error") => new AuthApiError(message, status, code);

  it("recognises email_exists", () => {
    expect(isEmailExistsError(apiError(422, "email_exists"))).toBe(true);
    expect(isEmailExistsError(apiError(422, undefined, "A user with this email address has already been registered"))).toBe(true);
    expect(isEmailExistsError(apiError(422, "weak_password"))).toBe(false);
    expect(isEmailExistsError(new Error("email_exists"))).toBe(false);
  });

  it("explains SMTP restrictions and limits and suggests the link option", () => {
    const notAuthorized = describeAuthAdminError(apiError(400, "email_address_not_authorized"), "invite_email");
    expect(notAuthorized).toMatch(/only delivers to members of your Supabase project team/);
    expect(notAuthorized).toMatch(/invite link/);
    expect(describeAuthAdminError(apiError(429, "over_email_send_rate_limit"), "reset_email")).toMatch(/reset link/);
    expect(describeAuthAdminError(apiError(500, "unexpected_failure"), "invite_email")).toMatch(/SMTP/);
    expect(describeAuthAdminError(apiError(500, "unexpected_failure"), "invite_link")).not.toMatch(/SMTP/);
  });

  it("covers network, credential and unknown failures honestly", () => {
    expect(describeAuthAdminError(new AuthRetryableFetchError("fetch failed", 0), "lookup")).toMatch(/could not be reached/);
    expect(describeAuthAdminError(apiError(401, undefined), "lookup")).toMatch(/SUPABASE_SECRET_KEY/);
    expect(describeAuthAdminError(apiError(400, "something_new"), "invite_link")).toBe("Supabase Auth refused the request (something_new).");
    expect(describeAuthAdminError(new Error("boom"), "invite_link")).toMatch(/Something went wrong/);
    expect(describeAuthAdminError(apiError(422, "email_address_invalid"), "invite_email")).toMatch(/typos/);
  });
});
