import { beforeAll, describe, expect, it } from "vitest";
import { loadManifestAudio, readManifest, type DemoAudioManifest, type TrackManifestEntry } from "../lib/manifest";
import { applySeedPlan, readExistingState, type CreatedCredential } from "../lib/seed-apply";
import { buildSeedPlan, formatSeedPlan, resolveSeedUsers } from "../lib/seed-plan";
import { MissingMigrationError } from "../lib/supabase-admin";
import { FakeSupabase } from "./fake-supabase";

let manifest: DemoAudioManifest;
let audio: Map<string, Uint8Array>;
const users = resolveSeedUsers({ adminEmail: null }, {}).users;

beforeAll(async () => {
  manifest = await readManifest();
  audio = await loadManifestAudio(manifest);
});

async function seed(db: FakeSupabase) {
  const client = db.client();
  const plan = buildSeedPlan({ manifest, users, existing: await readExistingState(client, manifest, users) });
  const credentials: CreatedCredential[] = [];
  const summary = await applySeedPlan(client, plan, audio, credentials, () => {});
  return { plan, summary, credentials };
}

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) => Boolean(a && b && Buffer.from(a).equals(Buffer.from(b)));
const HEX_OBJECT = "[0-9a-f]{32}\\.mp3";

describe("applySeedPlan (in-memory Supabase)", () => {
  it("creates the demo catalogue, venues, users and approved announcements", async () => {
    const db = new FakeSupabase();
    const settingsBefore = structuredClone(db.rows("platform_settings"));
    const { summary, credentials } = await seed(db);

    expect(credentials.map((c) => [c.email, c.role, c.venue])).toEqual([
      ["admin@example.com", "platform_admin", null],
      ["emeraldbar@example.com", "business_user", "EmeraldBar"],
      ["hotel-aurora@example.com", "business_user", "Hotel Aurora"],
    ]);
    for (const credential of credentials) {
      expect(credential.password.length).toBeGreaterThanOrEqual(20);
      expect(db.authUsers.find((u) => u.email === credential.email)).toMatchObject({ password: credential.password });
      expect(db.authUsers.find((u) => u.email === credential.email)?.email_confirmed_at).not.toBeNull();
    }
    const profiles = db.rows("profiles");
    const admin = profiles.find((p) => p.email === "admin@example.com")!;
    expect(admin).toMatchObject({ role: "platform_admin", full_name: "Demo platform admin" });
    expect(profiles.filter((p) => p.role === "business_user")).toHaveLength(2);

    const genres = db.rows("genres");
    expect(genres.map((g) => [g.name, g.slug, g.sort_order, g.available_to_all])).toEqual([
      ["House", "house", 1, true],
      ["Deep House", "deep-house", 2, true],
      ["Lounge", "lounge", 3, true],
      ["Jazz", "jazz", 4, false],
      ["Pop", "pop", 5, true],
      ["Rock", "rock", 6, true],
      ["R&B", "rnb", 7, true],
      ["Balkan Hits", "balkan-hits", 8, false],
      ["Chillout", "chillout", 9, true],
    ]);
    const genreId = (slug: string) => genres.find((g) => g.slug === slug)!.id;

    const businesses = db.rows("businesses");
    expect(
      businesses.map((b) => [b.name, b.business_type, b.station_name, b.name_pronunciation, b.contact_email, b.is_active, b.announcement_every_n_tracks]),
    ).toEqual([
      ["EmeraldBar", "bar", "EmeraldBar Radio", "Emerald Bar", "demo+emeraldbar@example.com", true, 4],
      ["Hotel Aurora", "hotel", "Hotel Aurora Radio", null, "demo+hotel-aurora@example.com", true, 4],
    ]);
    expect(summary.businesses.map((b) => [b.name, b.type, b.status])).toEqual([
      ["EmeraldBar", "bar", "created"],
      ["Hotel Aurora", "hotel", "created"],
    ]);
    // Contact details and legal texts are owner configuration: the seed never writes platform_settings.
    expect(db.rows("platform_settings")).toEqual(settingsBefore);
    const [emerald, aurora] = businesses;
    expect(db.rows("business_genre_access")).toEqual([
      { business_id: emerald.id, genre_id: genreId("balkan-hits") },
      { business_id: aurora.id, genre_id: genreId("jazz") },
    ]);
    const memberOf = (email: string) => db.rows("business_members").find((m) => m.user_id === profiles.find((p) => p.email === email)!.id)?.business_id;
    expect(memberOf("emeraldbar@example.com")).toBe(emerald.id);
    expect(memberOf("hotel-aurora@example.com")).toBe(aurora.id);
    expect(memberOf("admin@example.com")).toBeUndefined();

    const tracks = db.rows("tracks");
    expect(tracks).toHaveLength(21);
    for (const track of tracks) {
      const entry = manifest.entries.find((e): e is TrackManifestEntry => e.kind === "track" && e.title === track.title)!;
      expect(track.storage_path).toMatch(new RegExp(`^tracks/${track.id}/${HEX_OBJECT}$`));
      expect(sameBytes(db.objects.get(`music/${track.storage_path}`), audio.get(entry.id))).toBe(true);
      expect(track).toMatchObject({ artist: entry.artist, duration_seconds: entry.durationSeconds, file_size_bytes: entry.bytes, is_active: true, created_by: admin.id });
      const links = db.rows("track_genres").filter((l) => l.track_id === track.id);
      expect(links).toEqual([{ track_id: track.id, genre_id: genreId(entry.genre) }]);
    }

    const announcements = db.rows("announcements");
    expect(announcements).toHaveLength(6);
    for (const row of announcements) {
      const business = businesses.find((b) => b.id === row.business_id)!;
      expect(row).toMatchObject({ status: "active", source: "upload", needs_review: false, branding_version: business.branding_version, approved_by: admin.id, language: "en" });
      expect(typeof row.approved_at).toBe("string");
      expect(row.audio_path).toMatch(new RegExp(`^${business.id}/${row.id}/${HEX_OBJECT}$`));
      expect(db.objects.has(`announcements/${row.audio_path}`)).toBe(true);
    }
    expect(announcements.filter((a) => a.business_id === emerald.id).map((a) => [a.placement, a.template_key, a.text, a.spoken_text])).toEqual([
      ["welcome", "welcome_enjoy", "Welcome to EmeraldBar. Enjoy the music.", "Welcome to Emerald Bar. Enjoy the music."],
      ["rotation", "station_listening", "You’re listening to EmeraldBar Radio.", "You’re listening to Emerald Bar Radio."],
      ["rotation", "good_music", "Good music. Good company. This is EmeraldBar Radio.", "Good music. Good company. This is Emerald Bar Radio."],
    ]);
    expect(db.objects.size).toBe(27);
    expect(summary).toMatchObject({ tracks: { created: 21, existing: 0 }, announcements: { created: 6, audioAttached: 0, existing: 0 }, genreAccessCreated: 2, membershipsCreated: 2 });
  });

  it("is idempotent: a second run reuses everything and creates no users, rows or objects", async () => {
    const db = new FakeSupabase();
    await seed(db);
    const sizes = () => [...db.tables.entries()].map(([name, rows]) => [name, rows.length]);
    const before = { sizes: sizes(), objects: db.objects.size, users: db.authUsers.length };

    const second = await seed(db);
    expect(second.plan.conflicts).toEqual([]);
    expect(second.credentials).toEqual([]);
    expect(second.plan.users.every((u) => u.action === "reuse" && !u.promote)).toBe(true);
    expect([...second.plan.genres, ...second.plan.businesses, ...second.plan.tracks, ...second.plan.announcements].every((p) => p.action === "reuse")).toBe(true);
    expect(second.plan.genreAccess.every((a) => a.action === "exists")).toBe(true);
    expect(second.summary.users.map((u) => u.status)).toEqual(["existing", "existing", "existing"]);
    expect({ sizes: sizes(), objects: db.objects.size, users: db.authUsers.length }).toEqual(before);
  });

  it("removes the uploaded object when its row cannot be written, keeps passwords of users already created, and recovers on re-run", async () => {
    const db = new FakeSupabase();
    db.failure = { table: "tracks", op: "insert" };
    const client = db.client();
    const plan = buildSeedPlan({ manifest, users, existing: await readExistingState(client, manifest, users) });
    const credentials: CreatedCredential[] = [];
    await expect(applySeedPlan(client, plan, audio, credentials, () => {})).rejects.toThrow(/create track "Test Loop 01 — House \(synthetic\)": injected insert failure/);
    expect(credentials).toHaveLength(3);
    expect([...db.objects.keys()].filter((key) => key.startsWith("music/"))).toEqual([]);
    expect(db.rows("tracks")).toHaveLength(0);

    db.failure = null;
    const rerun = await seed(db);
    expect(rerun.credentials).toEqual([]); // users exist now; their passwords were printed by the failed run
    expect(db.rows("tracks")).toHaveLength(21);
    expect(db.rows("businesses")).toHaveLength(2);
    expect(db.objects.size).toBe(27);
  });

  it("attaches audio to an existing demo announcement that has none", async () => {
    const db = new FakeSupabase();
    await seed(db);
    const row = db.rows("announcements")[1];
    const oldObject = `announcements/${row.audio_path}`;
    db.objects.delete(oldObject);
    Object.assign(row, { status: "draft", audio_path: null, approved_at: null, approved_by: null });

    const { plan, summary } = await seed(db);
    expect(plan.announcements.filter((a) => a.action === "attach-audio").map((a) => a.id)).toEqual([row.id]);
    expect(summary.announcements).toEqual({ created: 0, audioAttached: 1, existing: 5 });
    expect(row).toMatchObject({ status: "active", source: "upload", needs_review: false });
    expect(db.objects.has(`announcements/${row.audio_path}`)).toBe(true);
    expect(db.rows("announcements")).toHaveLength(6);
  });

  it("writes nothing when the plan has conflicts", async () => {
    const db = new FakeSupabase();
    db.rows("businesses").push({ id: "real", name: "Hotel Aurora", contact_email: "gm@aurora.example", branding_version: 1, is_active: true });
    const client = db.client();
    const plan = buildSeedPlan({ manifest, users, existing: await readExistingState(client, manifest, users) });
    expect(plan.conflicts).toHaveLength(1);
    await expect(applySeedPlan(client, plan, audio, [], () => {})).rejects.toThrow(/conflicts/);
    expect(db.authUsers).toHaveLength(0);
    expect(db.objects.size).toBe(0);
  });

  it("gives new venues the platform's default announcement frequency, and 4 when the settings row is missing", async () => {
    const db = new FakeSupabase();
    db.rows("platform_settings")[0].default_announcement_every_n_tracks = 6;
    const { plan } = await seed(db);
    expect(plan.announcementFrequency).toEqual({ everyNTracks: 6, source: "platform settings" });
    expect(db.rows("businesses").map((b) => b.announcement_every_n_tracks)).toEqual([6, 6]);

    const withoutRow = new FakeSupabase();
    withoutRow.rows("platform_settings").length = 0;
    const second = await seed(withoutRow);
    expect(second.plan.announcementFrequency).toEqual({ everyNTracks: 4, source: "built-in default" });
    expect(formatSeedPlan(second.plan, { checkedExisting: true })).toContain("the platform_settings row is missing");
    expect(withoutRow.rows("businesses").map((b) => b.announcement_every_n_tracks)).toEqual([4, 4]);
    expect(withoutRow.rows("platform_settings")).toEqual([]); // read only: the seed never creates the row
  });

  it("types demo venues seeded before business types on a re-run, and keeps a type an admin chose", async () => {
    const db = new FakeSupabase();
    await seed(db);
    const [emerald, aurora] = db.rows("businesses");
    emerald.business_type = "other"; // the column default the older seed's rows got
    aurora.business_type = "restaurant"; // chosen by an admin
    const brandingBefore = [emerald.branding_version, aurora.branding_version];

    const { plan, summary } = await seed(db);
    expect(plan.conflicts).toEqual([]);
    expect(plan.businesses.map((b) => [b.action, b.setType])).toEqual([
      ["reuse", true],
      ["reuse", false],
    ]);
    expect(plan.notes).toEqual([expect.stringMatching(/"Hotel Aurora" has the type Restaurant \(the demo type is Hotel\)/)]);
    expect([emerald.business_type, aurora.business_type]).toEqual(["bar", "restaurant"]);
    expect(summary.businesses.map((b) => [b.name, b.type, b.status])).toEqual([
      ["EmeraldBar", "bar", "existing, type set"],
      ["Hotel Aurora", "restaurant", "existing"],
    ]);
    expect([emerald.branding_version, aurora.branding_version]).toEqual(brandingBefore);
    expect(db.rows("businesses")).toHaveLength(2);
  });

  it("refuses before writing anything when migration 20260926000100 is missing", async () => {
    const cases: [string, RegExp][] = [
      ["businesses.business_type", /column businesses\.business_type does not exist \(42703\)/],
      ["platform_settings", /Could not find the table 'public\.platform_settings' in the schema cache \(PGRST205\)/],
    ];
    for (const [missing, cause] of cases) {
      const db = new FakeSupabase();
      db.missingSchema.add(missing);
      const attempt = readExistingState(db.client(), manifest, users);
      await expect(attempt).rejects.toBeInstanceOf(MissingMigrationError);
      await expect(attempt).rejects.toThrow(cause);
      await expect(attempt).rejects.toThrow(/every file in supabase\/migrations\/ in filename order[\s\S]*20260926000100_frekvencija\.sql[\s\S]*Nothing was written/);
      expect(db.authUsers).toHaveLength(0);
      expect(db.rows("businesses")).toHaveLength(0);
      expect(db.objects.size).toBe(0);
    }
  });
});
