// Typed row builders and the shared multi-tenant scenario used by the RLS tests.
// Everything here runs as the superuser (bypassing RLS) to ARRANGE data; the
// assertions themselves always go through asUser/asAnon/asService.
import { randomUUID } from "node:crypto";
import type { Database, Tables, TablesInsert } from "@/types/database";
import type { Queryable, TestDb } from "./supabase-test-db";

type TableName = keyof Database["public"]["Tables"];
export type Bucket = "music" | "announcements" | "logos" | "genre-covers";

/** INSERT … RETURNING * with columns taken from the (typed) row object. */
export async function insertRow<T extends TableName>(
  db: Queryable,
  table: T,
  row: TablesInsert<T>,
): Promise<Tables<T>> {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const columns = entries.map(([column]) => `"${column}"`).join(", ");
  const params = entries.map((_, index) => `$${index + 1}`).join(", ");
  const result = await db.query<Tables<T>>(
    `insert into public.${table} (${columns}) values (${params}) returning *`,
    entries.map(([, value]) => value),
  );
  return result.rows[0];
}

/** What the Storage API writes when an object is uploaded (metadata trimmed). */
export async function putObject(db: Queryable, bucket: Bucket, name: string): Promise<void> {
  const mimetype = bucket === "logos" || bucket === "genre-covers" ? "image/png" : "audio/mpeg";
  await db.query(`insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)`, [
    bucket,
    name,
    { size: 1024, mimetype },
  ]);
}

/** Runs a query and returns the `id` column, sorted, for order-independent comparisons. */
export async function selectIds(db: Queryable, sql: string, params: unknown[] = []): Promise<string[]> {
  const result = await db.query<{ id: string }>(sql, params);
  return result.rows.map((row) => row.id).sort();
}

export function sorted(ids: string[]): string[] {
  return [...ids].sort();
}

export async function createAdmin(testDb: TestDb, email = `admin-${randomUUID()}@test.local`): Promise<string> {
  const id = await testDb.createUser({ email });
  await testDb.db.query(`update public.profiles set role = 'platform_admin' where id = $1`, [id]);
  return id;
}

export async function createMember(testDb: TestDb, businessId: string, email?: string): Promise<string> {
  const id = await testDb.createUser({ email });
  await insertRow(testDb.db, "business_members", { business_id: businessId, user_id: id });
  return id;
}

export async function insertTrack(
  db: Queryable,
  genreIds: string[],
  overrides: Partial<TablesInsert<"tracks">> = {},
): Promise<{ id: string; path: string }> {
  const id = overrides.id ?? randomUUID();
  const track = await insertRow(db, "tracks", {
    id,
    title: `Track ${id.slice(0, 8)}`,
    duration_seconds: 180,
    storage_path: `tracks/${id}/${randomUUID()}.mp3`,
    file_size_bytes: 4_000_000,
    ...overrides,
  });
  for (const genreId of genreIds) {
    await insertRow(db, "track_genres", { track_id: id, genre_id: genreId });
  }
  return { id, path: track.storage_path };
}

/**
 * An announcement for businessId. `playable: true` produces an approved, active
 * announcement with audio at the given branding version.
 */
export async function insertAnnouncement(
  db: Queryable,
  businessId: string,
  options: {
    status?: Database["public"]["Enums"]["announcement_status"];
    withAudio?: boolean;
    brandingVersion?: number;
    needsReview?: boolean;
    placement?: Database["public"]["Enums"]["announcement_placement"];
    audioPath?: string;
  } = {},
): Promise<{ id: string; path: string | null }> {
  const id = randomUUID();
  const status = options.status ?? "active";
  const withAudio = options.withAudio ?? status !== "draft";
  const path = withAudio ? (options.audioPath ?? `${businessId}/${id}/${randomUUID()}.mp3`) : null;
  await insertRow(db, "announcements", {
    id,
    business_id: businessId,
    text: `Announcement ${id.slice(0, 8)}`,
    placement: options.placement ?? "rotation",
    status,
    source: withAudio ? "upload" : null,
    audio_path: path,
    audio_duration_seconds: withAudio ? 6.5 : null,
    audio_size_bytes: withAudio ? 104_000 : null,
    needs_review: options.needsReview ?? false,
    branding_version: options.brandingVersion ?? 1,
    approved_at: status === "active" ? new Date().toISOString() : null,
  });
  return { id, path };
}

export interface Scenario {
  users: {
    admin: string;
    /** Member of active business A. */
    a: string;
    /** Second member of business A. */
    a2: string;
    /** Member of active business B. */
    b: string;
    /** Member of inactive business C. */
    c: string;
    /** Signed-in user without a business. */
    none: string;
  };
  businesses: { a: string; b: string; c: string };
  genres: {
    /** Enabled, available to all. */
    open: string;
    /** Disabled, available to all. */
    disabled: string;
    /** Enabled, exclusive, assigned to A (and to inactive C). */
    exclusiveA: string;
    /** Enabled, exclusive, assigned to B. */
    exclusiveB: string;
    /** Disabled, exclusive, assigned to A. */
    disabledExclusiveA: string;
  };
  tracks: {
    openPlayable: { id: string; path: string };
    openInactive: { id: string; path: string };
    openRemoved: { id: string; path: string };
    exclusiveA: { id: string; path: string };
    exclusiveB: { id: string; path: string };
    /** Only in disabled genres. */
    disabledOnly: { id: string; path: string };
    unassigned: { id: string; path: string };
    /** In open AND exclusiveB. */
    openAndExclusiveB: { id: string; path: string };
  };
  announcements: {
    aPlayable: { id: string; path: string };
    aWelcome: { id: string; path: string };
    aDraft: { id: string; path: null };
    aReady: { id: string; path: string };
    aNeedsReview: { id: string; path: string };
    /** Active, approved at branding version 1 while A is at version 2. */
    aStaleBranding: { id: string; path: string };
    bPlayable: { id: string; path: string };
    cPlayable: { id: string; path: string };
  };
  /** Object in A's announcements folder that no announcement references. */
  orphanAnnouncementObject: string;
  logos: { a: string; b: string; c: string };
}

/** A = active (branding version 2), B = active, C = inactive; see Scenario for the rest. */
export async function seedScenario(testDb: TestDb): Promise<Scenario> {
  const db = testDb.db;

  const businessA = randomUUID();
  const businessB = randomUUID();
  const businessC = randomUUID();
  const logos = {
    a: `${businessA}/${randomUUID()}.png`,
    b: `${businessB}/${randomUUID()}.png`,
    c: `${businessC}/${randomUUID()}.png`,
  };
  await insertRow(db, "businesses", {
    id: businessA,
    name: "EmeraldBar",
    station_name: "EmeraldBar Radio",
    name_pronunciation: "Emerald Bar",
    is_active: true,
    branding_version: 2,
    logo_path: logos.a,
  });
  await insertRow(db, "businesses", {
    id: businessB,
    name: "Hotel Aurora",
    station_name: "Aurora Radio",
    is_active: true,
    logo_path: logos.b,
  });
  await insertRow(db, "businesses", {
    id: businessC,
    name: "Closed Cafe",
    station_name: "Closed Cafe Radio",
    is_active: false,
    logo_path: logos.c,
  });

  const users = {
    admin: await createAdmin(testDb, "admin@test.local"),
    a: await createMember(testDb, businessA, "a@test.local"),
    a2: await createMember(testDb, businessA, "a2@test.local"),
    b: await createMember(testDb, businessB, "b@test.local"),
    c: await createMember(testDb, businessC, "c@test.local"),
    none: await testDb.createUser({ email: "none@test.local" }),
  };

  const genre = async (name: string, slug: string, sortOrder: number, isEnabled: boolean, availableToAll: boolean) =>
    (
      await insertRow(db, "genres", {
        name,
        slug,
        sort_order: sortOrder,
        is_enabled: isEnabled,
        available_to_all: availableToAll,
      })
    ).id;
  const genres = {
    open: await genre("Lounge", "lounge", 1, true, true),
    exclusiveA: await genre("Emerald Jazz", "emerald-jazz", 2, true, false),
    exclusiveB: await genre("Aurora Classics", "aurora-classics", 3, true, false),
    disabled: await genre("Retired Pop", "retired-pop", 4, false, true),
    disabledExclusiveA: await genre("Retired Jazz", "retired-jazz", 5, false, false),
  };
  for (const [businessId, genreId] of [
    [businessA, genres.exclusiveA],
    [businessA, genres.disabledExclusiveA],
    [businessB, genres.exclusiveB],
    [businessC, genres.exclusiveA],
  ]) {
    await insertRow(db, "business_genre_access", { business_id: businessId, genre_id: genreId });
  }

  const tracks = {
    openPlayable: await insertTrack(db, [genres.open]),
    openInactive: await insertTrack(db, [genres.open], { is_active: false }),
    openRemoved: await insertTrack(db, [genres.open], { removed_at: new Date().toISOString() }),
    exclusiveA: await insertTrack(db, [genres.exclusiveA]),
    exclusiveB: await insertTrack(db, [genres.exclusiveB]),
    disabledOnly: await insertTrack(db, [genres.disabled, genres.disabledExclusiveA]),
    unassigned: await insertTrack(db, []),
    openAndExclusiveB: await insertTrack(db, [genres.open, genres.exclusiveB]),
  };

  const withPath = (row: { id: string; path: string | null }): { id: string; path: string } => {
    if (row.path === null) throw new Error("expected an announcement with audio");
    return { id: row.id, path: row.path };
  };
  const draft = await insertAnnouncement(db, businessA, { status: "draft", brandingVersion: 2 });
  const announcements = {
    aPlayable: withPath(await insertAnnouncement(db, businessA, { brandingVersion: 2 })),
    aWelcome: withPath(await insertAnnouncement(db, businessA, { brandingVersion: 2, placement: "welcome" })),
    aDraft: { id: draft.id, path: null },
    aReady: withPath(await insertAnnouncement(db, businessA, { status: "ready", brandingVersion: 2 })),
    aNeedsReview: withPath(await insertAnnouncement(db, businessA, { brandingVersion: 2, needsReview: true })),
    aStaleBranding: withPath(await insertAnnouncement(db, businessA, { brandingVersion: 1 })),
    bPlayable: withPath(await insertAnnouncement(db, businessB)),
    cPlayable: withPath(await insertAnnouncement(db, businessC)),
  };

  const orphanAnnouncementObject = `${businessA}/${randomUUID()}/${randomUUID()}.mp3`;
  for (const track of Object.values(tracks)) await putObject(db, "music", track.path);
  for (const announcement of Object.values(announcements)) {
    if (announcement.path) await putObject(db, "announcements", announcement.path);
  }
  await putObject(db, "announcements", orphanAnnouncementObject);
  for (const logo of Object.values(logos)) await putObject(db, "logos", logo);

  return {
    users,
    businesses: { a: businessA, b: businessB, c: businessC },
    genres,
    tracks,
    announcements,
    orphanAnnouncementObject,
    logos,
  };
}
