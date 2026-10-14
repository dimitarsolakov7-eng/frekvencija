import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_ARTIST } from "../lib/demo-catalog";
import {
  REMOVE_USAGE,
  applyRemovePlan,
  buildRemovePlan,
  formatRemovePlan,
  isDemoTrack,
  isEmptyPlan,
  isExampleAddress,
  parseRemoveArgs,
  readDemoState,
  type RemovePlan,
} from "../lib/demo-remove";
import { loadManifestAudio, readManifest, type DemoAudioManifest } from "../lib/manifest";
import { applySeedPlan, readExistingState } from "../lib/seed-apply";
import { buildSeedPlan, resolveSeedUsers } from "../lib/seed-plan";
import { MissingMigrationError, ScriptStepError } from "../lib/supabase-admin";
import { FakeSupabase } from "./fake-supabase";

let manifest: DemoAudioManifest;
let audio: Map<string, Uint8Array>;
const users = resolveSeedUsers({ adminEmail: null }, {}).users;
const env = {};

beforeAll(async () => {
  manifest = await readManifest();
  audio = await loadManifestAudio(manifest);
});

/** A project as `npm run seed:dev -- --yes` leaves it. */
async function seeded(): Promise<FakeSupabase> {
  const db = new FakeSupabase();
  const client = db.client();
  const plan = buildSeedPlan({ manifest, users, existing: await readExistingState(client, manifest, users) });
  await applySeedPlan(client, plan, audio, [], () => {});
  return db;
}

async function plan(db: FakeSupabase, options: { genres?: boolean } = {}): Promise<RemovePlan> {
  return buildRemovePlan(await readDemoState(db.client(), env), { genres: options.genres ?? false, env });
}

async function remove(db: FakeSupabase, options: { genres?: boolean } = {}) {
  const removal = await plan(db, options);
  const summary = await applyRemovePlan(db.client(), removal, () => {});
  return { plan: removal, summary };
}

const objectsIn = (db: FakeSupabase, bucket: string) => [...db.objects.keys()].filter((key) => key.startsWith(`${bucket}/`));
const idOf = (row: Record<string, unknown>) => row.id as string;
/** A minimal real track row (the owner's own upload). */
const ownTrack = (title: string, artist: string, storagePath: string) => ({ title, artist, storage_path: storagePath, duration_seconds: 180, file_size_bytes: 1 });

describe("parseRemoveArgs", () => {
  it("parses the flags and rejects unknown options", () => {
    expect(parseRemoveArgs([])).toEqual({ yes: false, genres: false, dryRun: false, help: false });
    expect(parseRemoveArgs(["--yes", "--genres"])).toMatchObject({ yes: true, genres: true });
    expect(parseRemoveArgs(["--dry-run"])).toMatchObject({ dryRun: true, yes: false });
    expect(() => parseRemoveArgs(["--allow-remote"])).toThrow(TypeError);
    expect(() => parseRemoveArgs(["EmeraldBar"])).toThrow(TypeError);
    expect(REMOVE_USAGE).toContain("--dry-run");
  });
});

describe("markers", () => {
  it("recognises example.com addresses only", () => {
    expect(isExampleAddress("Admin@Example.com")).toBe(true);
    expect(isExampleAddress("demo+emeraldbar@example.com")).toBe(true);
    expect(isExampleAddress("staff@mail.example.com")).toBe(true);
    expect(isExampleAddress("owner@gmail.com")).toBe(false);
    expect(isExampleAddress("owner@example.community")).toBe(false);
    expect(isExampleAddress("not-an-email")).toBe(false);
  });

  it("recognises the synthetic loops by artist and title", () => {
    expect(isDemoTrack({ title: "Test Loop 07 — Deep House (synthetic)", artist: DEMO_ARTIST })).toBe(true);
    expect(isDemoTrack({ title: "Test Loop 07 — Deep House (synthetic)", artist: "Someone" })).toBe(false);
    expect(isDemoTrack({ title: "Sunset Groove", artist: DEMO_ARTIST })).toBe(false);
    expect(isDemoTrack({ title: "Test Loop 7 — Deep House", artist: DEMO_ARTIST })).toBe(false);
  });
});

describe("demo removal (in-memory Supabase)", () => {
  it("deletes the demo venues, users and tracks with their files, and keeps the genres", async () => {
    const db = await seeded();
    expect(db.rows("businesses")).toHaveLength(2);
    expect(db.rows("tracks")).toHaveLength(21);
    expect(objectsIn(db, "music")).toHaveLength(21);
    expect(objectsIn(db, "announcements")).toHaveLength(6);
    // Something the seed does not know about, left in a demo venue's folder (an interrupted replacement).
    const [emeraldBar] = db.rows("businesses");
    db.objects.set(`announcements/${emeraldBar.id}/stray/leftover.mp3`, new Uint8Array(1));
    db.objects.set(`logos/${emeraldBar.id}/logo.png`, new Uint8Array(1));
    db.objects.set(`music/tracks/${db.rows("tracks")[0].id}/old-version.mp3`, new Uint8Array(1));

    const { plan: removal, summary } = await remove(db);

    expect(removal.businesses.map((b) => [b.name, b.contactEmail, b.announcements.length, b.memberCount])).toEqual([
      ["EmeraldBar", "demo+emeraldbar@example.com", 3, 1],
      ["Hotel Aurora", "demo+hotel-aurora@example.com", 3, 1],
    ]);
    expect(removal.users.map((u) => [u.email, u.venue])).toEqual([
      ["emeraldbar@example.com", "EmeraldBar"],
      ["hotel-aurora@example.com", "Hotel Aurora"],
    ]);
    expect(removal.tracks).toHaveLength(21);
    expect(removal.genres).toEqual([]);
    expect(removal.reopenGenres.map((g) => g.name)).toEqual(["Jazz", "Balkan Hits"]);
    expect(summary).toEqual({ businesses: 2, announcements: 6, users: 2, tracks: 21, genres: 0, genresReopened: 2, objects: 6 + 2 + 21 + 1 });

    for (const table of ["businesses", "announcements", "business_members", "business_genre_access", "tracks", "track_genres"]) {
      expect(db.rows(table), table).toEqual([]);
    }
    expect(db.objects.size).toBe(0);
    expect(db.rows("genres")).toHaveLength(9);
    expect(db.rows("genres").every((g) => g.available_to_all === true)).toBe(true);
    // The demo admin was the only platform admin: kept, with an explanation.
    expect(db.authUsers.map((u) => u.email)).toEqual(["admin@example.com"]);
    expect(db.rows("profiles").map((p) => p.email)).toEqual(["admin@example.com"]);
    expect(removal.notes.join("\n")).toContain("admin@example.com is the only platform admin, so it is kept");
    expect(db.rows("platform_settings")).toHaveLength(1);
  });

  it("deletes the demo admin once another platform admin exists, and is idempotent", async () => {
    const db = await seeded();
    db.addAuthUser("owner@frekvencija.online", { role: "platform_admin" });

    const first = await remove(db);
    expect(first.plan.users.map((u) => u.email)).toEqual(["emeraldbar@example.com", "hotel-aurora@example.com", "admin@example.com"]);
    expect(db.authUsers.map((u) => u.email)).toEqual(["owner@frekvencija.online"]);
    expect(db.rows("profiles")).toEqual([expect.objectContaining({ email: "owner@frekvencija.online", role: "platform_admin" })]);

    const second = await plan(db);
    expect(isEmptyPlan(second)).toBe(true);
    expect(formatRemovePlan(second)).toContain("No demo data found: nothing to delete.");
    expect(second.notes.join("\n")).toContain("demo genres are kept");
  });

  it("never touches the owner's own venues, staff, music or genre choices", async () => {
    const db = await seeded();
    const client = db.client();
    // A real venue that happens to share a demo name, a real track by the demo artist's name, a real
    // staff member of a demo venue, and a genre the owner filled and shared with the real venue.
    const real = (await client.from("businesses").insert({ name: "EmeraldBar", station_name: "EmeraldBar FM", contact_email: "hello@emeraldbar.mk" }).select("id").single())
      .data!;
    const realStaff = db.addAuthUser("staff@emeraldbar.mk");
    const [demoEmeraldBar] = db.rows("businesses").filter((b) => b.contact_email === "demo+emeraldbar@example.com");
    await client.from("business_members").insert({ business_id: idOf(demoEmeraldBar), user_id: realStaff });
    const jazz = db.rows("genres").find((g) => g.slug === "jazz")!;
    const sunset = (await client.from("tracks").insert(ownTrack("Sunset Groove", DEMO_ARTIST, "tracks/own/sunset.mp3")).select("id").single()).data!;
    db.objects.set("music/tracks/own/sunset.mp3", new Uint8Array(1));
    await client.from("track_genres").insert({ track_id: sunset.id, genre_id: idOf(jazz) });
    await client.from("business_genre_access").insert({ business_id: real.id, genre_id: idOf(jazz) });
    db.objects.set(`announcements/${real.id}/x/real.mp3`, new Uint8Array(1));

    const { plan: removal } = await remove(db);

    expect(removal.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"EmeraldBar" (contact hello@emeraldbar.mk) is not seed demo data'),
        expect.stringContaining("staff@emeraldbar.mk is a member of EmeraldBar but not a demo address; the account is kept"),
        expect.stringContaining('Track "Sunset Groove" is credited to'),
      ]),
    );
    expect(db.rows("businesses")).toEqual([expect.objectContaining({ id: real.id })]);
    expect(db.rows("tracks")).toEqual([expect.objectContaining({ id: sunset.id })]);
    expect(db.authUsers.map((u) => u.email).sort()).toEqual(["admin@example.com", "staff@emeraldbar.mk"]);
    expect(db.rows("business_members")).toEqual([]); // the demo venue's memberships went with it
    expect(db.rows("business_genre_access")).toEqual([{ business_id: real.id, genre_id: idOf(jazz) }]);
    expect(db.rows("genres").find((g) => g.slug === "jazz")).toMatchObject({ available_to_all: false }); // still shared on purpose
    expect(db.rows("genres").find((g) => g.slug === "balkan-hits")).toMatchObject({ available_to_all: true });
    expect([...db.objects.keys()].sort()).toEqual([`announcements/${real.id}/x/real.mp3`, "music/tracks/own/sunset.mp3"]);
  });

  it("--genres deletes the empty demo genres with their covers and keeps a genre that has other music", async () => {
    const db = await seeded();
    const client = db.client();
    const house = db.rows("genres").find((g) => g.slug === "house")!;
    await client.from("genres").update({ cover_path: `genres/${idOf(house)}/cover.webp` }).eq("id", idOf(house));
    db.objects.set(`genre-covers/genres/${idOf(house)}/cover.webp`, new Uint8Array(1));
    const lounge = db.rows("genres").find((g) => g.slug === "lounge")!;
    const air = (await client.from("tracks").insert(ownTrack("Evening Air", "Owner", "tracks/own/air.mp3")).select("id").single()).data!;
    await client.from("track_genres").insert({ track_id: air.id, genre_id: idOf(lounge) });

    const { plan: removal, summary } = await remove(db, { genres: true });

    expect(removal.genres.map((g) => g.slug)).toEqual(["house", "deep-house", "jazz", "pop", "rock", "rnb", "balkan-hits", "chillout"]);
    expect(removal.reopenGenres).toEqual([]);
    expect(removal.notes).toContainEqual(expect.stringContaining('Genre "Lounge" has 1 other track; it is kept.'));
    expect(summary.genres).toBe(8);
    expect(db.rows("genres").map((g) => g.slug)).toEqual(["lounge"]);
    expect(db.rows("track_genres")).toEqual([{ track_id: air.id, genre_id: idOf(lounge) }]);
    expect(objectsIn(db, "genre-covers")).toEqual([]);
    expect(formatRemovePlan(removal)).toContain("Genres (8; --genres)");
  });

  it("stops at the failing step, with the files already gone and the rows left for a re-run", async () => {
    const db = await seeded();
    db.addAuthUser("owner@frekvencija.online", { role: "platform_admin" });
    db.failure = { table: "tracks", op: "delete" };

    await expect(remove(db)).rejects.toThrow(ScriptStepError);
    await expect(remove(db)).rejects.toThrow(/delete the demo tracks/);
    expect(db.rows("businesses")).toEqual([]); // step 1 completed
    expect(db.rows("tracks")).toHaveLength(21); // step 2 failed after its objects were removed
    expect(objectsIn(db, "music")).toEqual([]);
    expect(db.authUsers.map((u) => u.email)).toContain("emeraldbar@example.com"); // step 4 not reached

    db.failure = null;
    const { plan: retry, summary } = await remove(db);
    // The venue users are found by address although their venue is already gone; the rows' own file
    // paths are requested again (already gone, which Storage does not mind).
    expect(retry.users.map((u) => [u.email, u.venue]).sort()).toEqual([
      ["admin@example.com", null],
      ["emeraldbar@example.com", null],
      ["hotel-aurora@example.com", null],
    ]);
    expect(summary).toMatchObject({ businesses: 0, tracks: 21, users: 3, objects: 21 });
    expect(db.rows("tracks")).toEqual([]);
    expect(db.authUsers.map((u) => u.email)).toEqual(["owner@frekvencija.online"]);
  });

  it("keeps a demo address that a real venue uses now", async () => {
    const db = await seeded();
    const client = db.client();
    const real = (await client.from("businesses").insert({ name: "Café Nova", station_name: "Nova Radio", contact_email: "hi@cafenova.mk" }).select("id").single()).data!;
    const aurora = db.rows("profiles").find((p) => p.email === "hotel-aurora@example.com")!;
    await client.from("business_members").delete().eq("user_id", idOf(aurora));
    await client.from("business_members").insert({ business_id: real.id, user_id: idOf(aurora) });

    const { plan: removal } = await remove(db);
    expect(removal.users.map((u) => u.email)).toEqual(["emeraldbar@example.com"]);
    expect(removal.notes).toContainEqual("hotel-aurora@example.com is also a member of another venue; the account is kept.");
    expect(db.rows("business_members")).toEqual([{ business_id: real.id, user_id: idOf(aurora) }]);
  });

  it("refuses before anything happens when a migration is missing", async () => {
    const db = await seeded();
    db.missingSchema.add("genres.cover_path");
    await expect(readDemoState(db.client(), env)).rejects.toThrow(MissingMigrationError);
    expect(db.rows("businesses")).toHaveLength(2);
  });

  it("uses the SEED_* addresses the seed was given", async () => {
    const db = await seeded();
    const custom = { SEED_EMERALDBAR_EMAIL: "tester@frekvencija.online" };
    const tester = db.addAuthUser("tester@frekvencija.online");
    const [demoEmeraldBar] = db.rows("businesses").filter((b) => b.contact_email === "demo+emeraldbar@example.com");
    await db.client().from("business_members").insert({ business_id: idOf(demoEmeraldBar), user_id: tester });

    const removal = buildRemovePlan(await readDemoState(db.client(), custom), { genres: false, env: custom });
    expect(removal.users.map((u) => u.email)).toContain("tester@frekvencija.online");
  });
});
