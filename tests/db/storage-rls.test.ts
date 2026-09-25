import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type Bucket, insertAnnouncement, putObject, seedScenario } from "./fixtures";
import type { Queryable } from "./supabase-test-db";
import { setupTestDb } from "./setup-test-db";

const t = setupTestDb(seedScenario);
const fx = () => t.fixtures();

const rlsDenied = { code: "42501", message: expect.stringMatching(/row-level security/) };

/** What createSignedUrl/download check: can the caller SELECT this object row? */
async function canRead(db: Queryable, bucket: Bucket, name: string): Promise<boolean> {
  const { rows } = await db.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name]);
  return rows.length === 1;
}

async function visibleNames(db: Queryable, bucket: Bucket): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(`select name from storage.objects where bucket_id = $1`, [bucket]);
  return rows.map((row) => row.name).sort();
}

describe("anon", () => {
  it("cannot see any object", async () => {
    const { rows } = await t().asAnon((db) => db.query(`select * from storage.objects`));
    expect(rows).toEqual([]);
  });
});

describe("announcements bucket (business user)", () => {
  it("A can read its own playable announcement audio", async () => {
    const { users, announcements } = fx();
    await t().asUser(users.a, async (db) => {
      expect(await canRead(db, "announcements", announcements.aPlayable.path)).toBe(true);
      expect(await canRead(db, "announcements", announcements.aWelcome.path)).toBe(true);
    });
  });

  it("A cannot read B's announcement audio, nor its own non-playable audio or orphans", async () => {
    const { users, announcements, orphanAnnouncementObject } = fx();
    await t().asUser(users.a, async (db) => {
      expect(await canRead(db, "announcements", announcements.bPlayable.path)).toBe(false);
      expect(await canRead(db, "announcements", announcements.aReady.path)).toBe(false);
      expect(await canRead(db, "announcements", announcements.aNeedsReview.path)).toBe(false);
      expect(await canRead(db, "announcements", announcements.aStaleBranding.path)).toBe(false);
      expect(await canRead(db, "announcements", orphanAnnouncementObject)).toBe(false);
      expect(await visibleNames(db, "announcements")).toEqual(
        [announcements.aPlayable.path, announcements.aWelcome.path].sort(),
      );
    });
  });

  it("an inactive business cannot read its own playable announcement audio", async () => {
    const { users, announcements } = fx();
    expect(await t().asUser(users.c, (db) => canRead(db, "announcements", announcements.cPlayable.path))).toBe(false);
  });

  it("requires the object to sit in the caller's business folder", async () => {
    const { users, businesses } = fx();
    // A playable announcement of A whose audio path (wrongly) points into B's folder.
    const misfiled = await insertAnnouncement(t().db, businesses.a, {
      brandingVersion: 2,
      audioPath: `${businesses.b}/${randomUUID()}/${randomUUID()}.mp3`,
    });
    await putObject(t().db, "announcements", misfiled.path ?? "");
    expect(await t().asUser(users.a, (db) => canRead(db, "announcements", misfiled.path ?? ""))).toBe(false);
    expect(await t().asUser(users.b, (db) => canRead(db, "announcements", misfiled.path ?? ""))).toBe(false);
  });

  it("loses access to the audio as soon as the branding changes", async () => {
    const { users, businesses, announcements } = fx();
    await t().db.query(`update public.businesses set station_name = 'Renamed Radio' where id = $1`, [businesses.a]);
    expect(await t().asUser(users.a, (db) => canRead(db, "announcements", announcements.aPlayable.path))).toBe(false);
  });
});

describe("music bucket (business user)", () => {
  it("A can read objects of accessible tracks only", async () => {
    const { users, tracks } = fx();
    await t().asUser(users.a, async (db) => {
      expect(await visibleNames(db, "music")).toEqual(
        [tracks.openPlayable.path, tracks.exclusiveA.path, tracks.openAndExclusiveB.path].sort(),
      );
      for (const hidden of [
        tracks.openInactive,
        tracks.openRemoved,
        tracks.exclusiveB,
        tracks.disabledOnly,
        tracks.unassigned,
      ]) {
        expect(await canRead(db, "music", hidden.path)).toBe(false);
      }
    });
  });

  it("an inactive business cannot read any music", async () => {
    const { users } = fx();
    expect(await t().asUser(users.c, (db) => visibleNames(db, "music"))).toEqual([]);
  });

  it("a track path in another bucket is not readable through the music policy", async () => {
    const { users, tracks } = fx();
    await putObject(t().db, "logos", tracks.openPlayable.path);
    expect(await t().asUser(users.a, (db) => canRead(db, "logos", tracks.openPlayable.path))).toBe(false);
  });
});

describe("logos bucket (business user)", () => {
  it("members read their own logo (even while inactive) but not other logos", async () => {
    const { users, logos } = fx();
    expect(await t().asUser(users.a, (db) => visibleNames(db, "logos"))).toEqual([logos.a]);
    expect(await t().asUser(users.b, (db) => visibleNames(db, "logos"))).toEqual([logos.b]);
    expect(await t().asUser(users.c, (db) => visibleNames(db, "logos"))).toEqual([logos.c]);
    expect(await t().asUser(users.none, (db) => visibleNames(db, "logos"))).toEqual([]);
  });
});

describe("business users cannot write objects", () => {
  it.each(["music", "announcements", "logos", "genre-covers"] as const)("cannot insert into %s", async (bucket) => {
    const { users, businesses } = fx();
    await expect(
      t().asStorageUser(users.a, (db) =>
        db.query(
          `insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, $3::uuid, $3::text)`,
          [bucket, `${businesses.a}/${randomUUID()}/x.mp3`, users.a],
        ),
      ),
    ).rejects.toMatchObject(rlsDenied);
  });

  it("cannot update or delete even objects they can read", async () => {
    const { users, announcements, logos } = fx();
    await t().asStorageUser(users.a, async (db) => {
      const update = await db.query(`update storage.objects set metadata = '{}' where name = any($1::text[])`, [
        [announcements.aPlayable.path, logos.a],
      ]);
      expect(update.affectedRows).toBe(0);
      const remove = await db.query(`delete from storage.objects where name = any($1::text[])`, [
        [announcements.aPlayable.path, logos.a],
      ]);
      expect(remove.affectedRows).toBe(0);
    });
  });
});

describe("platform admin", () => {
  it("can read every object in all three buckets", async () => {
    const { users } = fx();
    const counts = await t().asUser(users.admin, (db) =>
      db.query<{ bucket_id: string; n: number }>(
        `select bucket_id, count(*)::int as n from storage.objects group by bucket_id order by bucket_id`,
      ),
    );
    // 7 announcements with audio + 1 orphan; 3 logos; 8 tracks.
    expect(counts.rows).toEqual([
      { bucket_id: "announcements", n: 8 },
      { bucket_id: "logos", n: 3 },
      { bucket_id: "music", n: 8 },
    ]);
  });

  it.each(["music", "announcements", "logos", "genre-covers"] as const)("can insert, update and delete in %s", async (bucket) => {
    const { users } = fx();
    const name = `${randomUUID()}/${randomUUID()}.bin`;
    await t().asStorageUser(users.admin, async (db) => {
      await db.query(
        `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $3::text, '{}')`,
        [bucket, name, users.admin],
      );
      expect(await canRead(db, bucket, name)).toBe(true);
      const update = await db.query(`update storage.objects set metadata = '{"size": 2}' where bucket_id = $1 and name = $2`, [
        bucket,
        name,
      ]);
      expect(update.affectedRows).toBe(1);
      const remove = await db.query(`delete from storage.objects where bucket_id = $1 and name = $2`, [bucket, name]);
      expect(remove.affectedRows).toBe(1);
    });
  });

  it("gets no access to buckets other than the four media buckets", async () => {
    const { users } = fx();
    await t().db.query(`insert into storage.buckets (id, name) values ('other', 'other')`);
    await expect(
      t().asUser(users.admin, (db) => db.query(`insert into storage.objects (bucket_id, name) values ('other', 'x')`)),
    ).rejects.toMatchObject(rlsDenied);
  });
});
