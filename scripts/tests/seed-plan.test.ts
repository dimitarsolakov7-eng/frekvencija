import { describe, expect, it } from "vitest";
import { readManifest } from "../lib/manifest";
import {
  EMPTY_EXISTING_STATE,
  buildSeedPlan,
  evaluateSeedSafety,
  formatSeedPlan,
  parseSeedArgs,
  resolveSeedUsers,
  type ExistingState,
} from "../lib/seed-plan";

describe("parseSeedArgs", () => {
  it("parses flags and rejects unknown ones", () => {
    expect(parseSeedArgs([])).toEqual({ yes: false, allowRemote: false, dryRun: false, adminEmail: null, help: false });
    expect(parseSeedArgs(["--yes", "--allow-remote", "--admin-email", "Boss@Example.com"])).toMatchObject({
      yes: true,
      allowRemote: true,
      adminEmail: "Boss@Example.com",
    });
    expect(parseSeedArgs(["--dry-run"]).dryRun).toBe(true);
    expect(() => parseSeedArgs(["--yse"])).toThrow(/Unknown option/);
    expect(() => parseSeedArgs(["--admin-email"])).toThrow();
    expect(() => parseSeedArgs(["positional"])).toThrow();
  });
});

describe("evaluateSeedSafety", () => {
  const local = { nodeEnv: "development", supabaseUrl: "http://127.0.0.1:54321", yes: true, allowRemote: false };

  it("allows a confirmed run against a local stack", () => {
    expect(evaluateSeedSafety(local)).toEqual({ target: { url: local.supabaseUrl, host: "127.0.0.1:54321", local: true }, refusals: [] });
    expect(evaluateSeedSafety({ ...local, supabaseUrl: "http://localhost:54321" }).refusals).toEqual([]);
    expect(evaluateSeedSafety({ ...local, supabaseUrl: "http://[::1]:54321" }).refusals).toEqual([]);
  });

  it("requires --yes", () => {
    expect(evaluateSeedSafety({ ...local, yes: false }).refusals).toEqual([expect.stringMatching(/--yes/)]);
  });

  it("refuses production even with every override", () => {
    const report = evaluateSeedSafety({ nodeEnv: "production", supabaseUrl: "http://127.0.0.1:54321", yes: true, allowRemote: true });
    expect(report.refusals).toEqual([expect.stringMatching(/NODE_ENV is "production"/)]);
    expect(evaluateSeedSafety({ ...local, nodeEnv: " Production " }).refusals).toHaveLength(1);
  });

  it("refuses a remote project unless --allow-remote is also passed, and says why", () => {
    const remote = { ...local, supabaseUrl: "https://abcd.supabase.co" };
    const refused = evaluateSeedSafety(remote);
    expect(refused.target.local).toBe(false);
    expect(refused.refusals).toEqual([expect.stringMatching(/abcd\.supabase\.co.*not localhost.*--allow-remote/)]);
    expect(evaluateSeedSafety({ ...remote, allowRemote: true }).refusals).toEqual([]);
    // Look-alike hosts are remote.
    expect(evaluateSeedSafety({ ...local, supabaseUrl: "http://localhost.evil.example" }).refusals).toHaveLength(1);
  });

  it("refuses when no project is configured", () => {
    expect(evaluateSeedSafety({ ...local, supabaseUrl: null }).refusals).toEqual([expect.stringMatching(/NEXT_PUBLIC_SUPABASE_URL is not set/)]);
  });
});

describe("resolveSeedUsers", () => {
  it("uses --admin-email over SEED_ADMIN_EMAIL over the default, and venue env vars", () => {
    const fromDefaults = resolveSeedUsers({ adminEmail: null }, {});
    expect(fromDefaults.problems).toEqual([]);
    expect(fromDefaults.users.map((u) => [u.role, u.email, u.businessKey, u.source])).toEqual([
      ["platform_admin", "admin@example.com", null, "default"],
      ["business_user", "emeraldbar@example.com", "emeraldbar", "default"],
      ["business_user", "hotel-aurora@example.com", "hotel-aurora", "default"],
    ]);
    const env = { SEED_ADMIN_EMAIL: "env-admin@example.com", SEED_EMERALDBAR_EMAIL: " Bar@Example.com ", SEED_AURORA_EMAIL: "hotel@example.com" };
    expect(resolveSeedUsers({ adminEmail: null }, env).users.map((u) => u.email)).toEqual(["env-admin@example.com", "bar@example.com", "hotel@example.com"]);
    expect(resolveSeedUsers({ adminEmail: "Flag@Example.com" }, env).users[0]).toMatchObject({ email: "flag@example.com", source: "--admin-email" });
  });

  it("reports invalid and duplicate emails", () => {
    expect(resolveSeedUsers({ adminEmail: "nope" }, {}).problems).toEqual([expect.stringMatching(/"nope" \(from --admin-email\) is not a valid email/)]);
    expect(resolveSeedUsers({ adminEmail: null }, { SEED_AURORA_EMAIL: "ADMIN@example.com" }).problems).toEqual([
      expect.stringMatching(/admin@example\.com is used for two demo users \(default and SEED_AURORA_EMAIL\)/),
    ]);
  });
});

describe("buildSeedPlan", () => {
  const users = resolveSeedUsers({ adminEmail: null }, {}).users;

  it("creates everything on an empty project", async () => {
    const manifest = await readManifest();
    const plan = buildSeedPlan({ manifest, users, existing: EMPTY_EXISTING_STATE });
    expect(plan.conflicts).toEqual([]);
    expect(plan.notes).toEqual([]);
    expect(plan.users.map((u) => [u.action, u.promote, u.membership])).toEqual([
      ["create", true, "none"],
      ["create", false, "create"],
      ["create", false, "create"],
    ]);
    expect(plan.genres.map((g) => g.genre.name)).toEqual(["House", "Deep House", "Lounge", "Jazz", "Pop", "Rock", "R&B", "Balkan Hits", "Chillout"]);
    expect(plan.genres.every((g) => g.action === "create")).toBe(true);
    expect(plan.genres.filter((g) => !g.genre.availableToAll).map((g) => [g.genre.slug, g.exclusiveTo])).toEqual([
      ["jazz", ["Hotel Aurora"]],
      ["balkan-hits", ["EmeraldBar"]],
    ]);
    expect(plan.genreAccess).toEqual([
      { businessKey: "emeraldbar", genreSlug: "balkan-hits", action: "create" },
      { businessKey: "hotel-aurora", genreSlug: "jazz", action: "create" },
    ]);
    // Typed venues; nothing read in a dry run, so new venues use the built-in default frequency.
    expect(plan.announcementFrequency).toEqual({ everyNTracks: 4, source: "built-in default" });
    expect(plan.businesses.map((b) => [b.business.name, b.action, b.business.businessType, b.everyNTracks, b.setType])).toEqual([
      ["EmeraldBar", "create", "bar", 4, false],
      ["Hotel Aurora", "create", "hotel", 4, false],
    ]);
    expect(plan.tracks).toHaveLength(21);
    expect(plan.announcements.map((a) => [a.entry.business, a.entry.placement, a.action])).toEqual([
      ["emeraldbar", "welcome", "create"],
      ["emeraldbar", "rotation", "create"],
      ["emeraldbar", "rotation", "create"],
      ["hotel-aurora", "welcome", "create"],
      ["hotel-aurora", "rotation", "create"],
      ["hotel-aurora", "rotation", "create"],
    ]);
    const text = formatSeedPlan(plan, { checkedExisting: false });
    expect(text).toContain("Dry run: existing rows were not checked");
    expect(text).toMatch(/create\s+EmeraldBar\s+Bar\s+EmeraldBar Radio\s+Emerald Bar\s+4 completed songs\s+demo\+emeraldbar@example\.com/);
    expect(text).toMatch(/create\s+Hotel Aurora\s+Hotel\s+Hotel Aurora Radio/);
    expect(text).toContain("New venues: an announcement after every 4 completed songs (built-in default; a real run uses the platform default from Settings).");
    expect(text).toContain("Platform settings (contact details, privacy policy, terms) are never written by the seed.");
    expect(text).not.toContain("CONFLICTS");
  });

  it("gives new venues the platform's default announcement frequency, like the admin's Add business", async () => {
    const manifest = await readManifest();
    const withDefault = (value: number) =>
      buildSeedPlan({ manifest, users, existing: { ...EMPTY_EXISTING_STATE, platformSettings: { default_announcement_every_n_tracks: value } } });

    const plan = withDefault(6);
    expect(plan.announcementFrequency).toEqual({ everyNTracks: 6, source: "platform settings" });
    expect(plan.businesses.map((b) => b.everyNTracks)).toEqual([6, 6]);
    expect(formatSeedPlan(plan, { checkedExisting: true })).toContain("after every 6 completed songs (the platform default from Settings)");
    // An out-of-range value (the database forbids it) falls back to the built-in default.
    expect(withDefault(0).announcementFrequency).toEqual({ everyNTracks: 4, source: "built-in default" });
    // A real run without the settings row says so.
    expect(formatSeedPlan(buildSeedPlan({ manifest, users, existing: EMPTY_EXISTING_STATE }), { checkedExisting: true })).toContain(
      "(built-in default: the platform_settings row is missing)",
    );
  });

  it("reuses the demo rows of a previous run (matched by slug, name + seed marker, title, venue + template)", async () => {
    const manifest = await readManifest();
    const track = manifest.entries.find((e) => e.kind === "track")!;
    const existing: ExistingState = {
      ...EMPTY_EXISTING_STATE,
      genres: [{ id: "g-house", slug: "house", name: "House" }, { id: "g-jazz", slug: "smooth-jazz", name: "jazz" }],
      // Seeded before business types existed ("other" = column default), frequency changed by an admin.
      businesses: [
        {
          id: "b-emerald",
          name: "EmeraldBar",
          contact_email: "demo+emeraldbar@example.com",
          branding_version: 3,
          is_active: true,
          business_type: "other",
          announcement_every_n_tracks: 5,
        },
      ],
      platformSettings: { default_announcement_every_n_tracks: 4 },
      genreAccess: [{ business_id: "b-emerald", genre_id: "g-balkan-missing" }],
      tracks: [{ id: "t-1", title: track.title, is_active: true, removed_at: null }],
      announcements: [
        { id: "a-1", business_id: "b-emerald", template_key: "welcome_enjoy", status: "active", audio_path: "b-emerald/a-1/x.mp3", needs_review: false, branding_version: 3 },
        { id: "a-2", business_id: "b-emerald", template_key: "station_listening", status: "draft", audio_path: null, needs_review: false, branding_version: 1 },
        { id: "a-3", business_id: "b-emerald", template_key: "good_music", status: "active", audio_path: "b-emerald/a-3/x.mp3", needs_review: true, branding_version: 2 },
      ],
      profiles: [
        { id: "u-admin", email: "admin@example.com", role: "platform_admin" },
        { id: "u-emerald", email: "emeraldbar@example.com", role: "business_user" },
      ],
      memberships: [{ business_id: "b-emerald", user_id: "u-emerald" }],
    };
    const plan = buildSeedPlan({ manifest, users, existing });
    expect(plan.conflicts).toEqual([]);
    expect(plan.users.map((u) => [u.email, u.action, u.promote, u.membership])).toEqual([
      ["admin@example.com", "reuse", false, "none"],
      ["emeraldbar@example.com", "reuse", false, "exists"],
      ["hotel-aurora@example.com", "create", false, "create"],
    ]);
    expect(plan.genres.find((g) => g.genre.slug === "house")).toMatchObject({ action: "reuse", id: "g-house" });
    expect(plan.genres.find((g) => g.genre.slug === "jazz")).toMatchObject({ action: "reuse", id: "g-jazz" });
    expect(plan.businesses.map((b) => [b.business.key, b.action, b.id, b.brandingVersion, b.currentType, b.setType, b.everyNTracks])).toEqual([
      ["emeraldbar", "reuse", "b-emerald", 3, "other", true, 5],
      ["hotel-aurora", "create", null, null, null, false, 4],
    ]);
    expect(formatSeedPlan(plan, { checkedExisting: true })).toMatch(/reuse, set type\s+EmeraldBar\s+Bar\s+.*5 completed songs/);
    expect(plan.tracks[0]).toMatchObject({ action: "reuse", id: "t-1" });
    expect(plan.tracks.slice(1).every((t) => t.action === "create")).toBe(true);
    expect(plan.announcements.slice(0, 3).map((a) => [a.action, a.id])).toEqual([
      ["reuse", "a-1"],
      ["attach-audio", "a-2"],
      ["reuse", "a-3"],
    ]);
    expect(plan.notes).toEqual([
      expect.stringMatching(/Genre "Jazz" exists with slug "smooth-jazz"/),
      expect.stringMatching(/"Good music\. Good company\. This is EmeraldBar Radio\." exists but will not play \(it needs review, it was approved for older branding\)/),
    ]);
  });

  it("promotes an existing non-admin account used as the admin", async () => {
    const manifest = await readManifest();
    const existing = { ...EMPTY_EXISTING_STATE, profiles: [{ id: "u-1", email: "admin@example.com", role: "business_user" as const }] };
    expect(buildSeedPlan({ manifest, users, existing }).users[0]).toMatchObject({ action: "reuse", promote: true, userId: "u-1" });
  });

  it("leaves a business type an admin chose for a demo venue, and says so", async () => {
    const manifest = await readManifest();
    const existing: ExistingState = {
      ...EMPTY_EXISTING_STATE,
      businesses: [
        {
          id: "b-aurora",
          name: "Hotel Aurora",
          contact_email: "demo+hotel-aurora@example.com",
          branding_version: 1,
          is_active: true,
          business_type: "restaurant",
          announcement_every_n_tracks: 4,
        },
      ],
    };
    const plan = buildSeedPlan({ manifest, users, existing });
    expect(plan.businesses[1]).toMatchObject({ action: "reuse", currentType: "restaurant", setType: false });
    expect(plan.notes).toEqual([expect.stringMatching(/"Hotel Aurora" has the type Restaurant \(the demo type is Hotel\); the seed leaves it as it is/)]);
    expect(formatSeedPlan(plan, { checkedExisting: true })).toMatch(/reuse\s+Hotel Aurora\s+Restaurant\s+Hotel Aurora Radio/);
  });

  it("refuses to touch a real venue with a demo name, or to reuse accounts that belong elsewhere", async () => {
    const manifest = await readManifest();
    const existing: ExistingState = {
      ...EMPTY_EXISTING_STATE,
      businesses: [
        {
          id: "real",
          name: "emeraldbar",
          contact_email: "owner@emeraldbar.example",
          branding_version: 1,
          is_active: true,
          business_type: "bar",
          announcement_every_n_tracks: 4,
        },
      ],
      profiles: [
        { id: "u-emerald", email: "emeraldbar@example.com", role: "business_user" },
        { id: "u-aurora", email: "hotel-aurora@example.com", role: "platform_admin" },
      ],
      memberships: [{ business_id: "some-other-venue", user_id: "u-emerald" }],
    };
    const plan = buildSeedPlan({ manifest, users, existing });
    expect(plan.conflicts).toEqual([
      expect.stringMatching(/A business named "EmeraldBar" already exists but is not seed demo data/),
      expect.stringMatching(/emeraldbar@example\.com \(default\) already belongs to another venue/),
      expect.stringMatching(/hotel-aurora@example\.com \(default\) is a platform admin/),
    ]);
    expect(formatSeedPlan(plan, { checkedExisting: true })).toContain("CONFLICTS (nothing will be written)");
  });

  it("flags duplicate demo businesses", async () => {
    const manifest = await readManifest();
    const demo = {
      name: "Hotel Aurora",
      contact_email: "demo+hotel-aurora@example.com",
      branding_version: 1,
      is_active: true,
      business_type: "hotel" as const,
      announcement_every_n_tracks: 4,
    };
    const plan = buildSeedPlan({ manifest, users, existing: { ...EMPTY_EXISTING_STATE, businesses: [{ id: "a", ...demo }, { id: "b", ...demo }] } });
    expect(plan.conflicts).toEqual([expect.stringMatching(/2 demo businesses named "Hotel Aurora"/)]);
  });
});
