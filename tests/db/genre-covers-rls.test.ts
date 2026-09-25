// genres.cover_path + the private `genre-covers` bucket (20260926000100_frekvencija.sql):
// business users may read only the covers of genres their ACTIVE venue can play;
// admins manage every object; nobody else can read or write anything.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type Bucket, putObject, type Scenario, seedScenario } from "./fixtures";
import type { Queryable, TestDb } from "./supabase-test-db";
import { setupTestDb } from "./setup-test-db";

interface CoverScenario extends Scenario {
  /** Cover object path of every scenario genre (all five have one). */
  covers: Record<keyof Scenario["genres"], string>;
  /** Object in genre-covers that no genre references (e.g. left behind by a replacement). */
  orphanCover: string;
}

async function seedWithCovers(testDb: TestDb): Promise<CoverScenario> {
  const scenario = await seedScenario(testDb);
  const coverFor = async (genreId: string): Promise<string> => {
    const path = `${genreId}/${randomUUID()}.webp`;
    await testDb.db.query(`update public.genres set cover_path = $2 where id = $1`, [genreId, path]);
    await putObject(testDb.db, "genre-covers", path);
    return path;
  };
  const { genres } = scenario;
  const covers = {
    open: await coverFor(genres.open),
    disabled: await coverFor(genres.disabled),
    exclusiveA: await coverFor(genres.exclusiveA),
    exclusiveB: await coverFor(genres.exclusiveB),
    disabledExclusiveA: await coverFor(genres.disabledExclusiveA),
  };
  const orphanCover = `${genres.open}/${randomUUID()}.png`;
  await putObject(testDb.db, "genre-covers", orphanCover);
  return { ...scenario, covers, orphanCover };
}

const t = setupTestDb(seedWithCovers);
const fx = () => t.fixtures();

const rlsDenied = { code: "42501", message: expect.stringMatching(/row-level security/) };

/** What createSignedUrl/download check: can the caller SELECT this object row? */
async function canRead(db: Queryable, bucket: Bucket, name: string): Promise<boolean> {
  const { rows } = await db.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name]);
  return rows.length === 1;
}

async function visibleCovers(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(`select name from storage.objects where bucket_id = 'genre-covers'`);
  return rows.map((row) => row.name).sort();
}

describe("genre-covers bucket (business users)", () => {
  it("A reads the covers of its accessible genres only", async () => {
    const { users, covers, orphanCover } = fx();
    await t().asUser(users.a, async (db) => {
      expect(await visibleCovers(db)).toEqual([covers.open, covers.exclusiveA].sort());
      for (const hidden of [covers.exclusiveB, covers.disabled, covers.disabledExclusiveA, orphanCover]) {
        expect(await canRead(db, "genre-covers", hidden)).toBe(false);
      }
    });
  });

  it("B reads the open genre's cover and its own exclusive genre's cover", async () => {
    const { users, covers } = fx();
    expect(await t().asUser(users.b, visibleCovers)).toEqual([covers.open, covers.exclusiveB].sort());
  });

  it("an inactive business and a user without a business read no cover", async () => {
    const { users } = fx();
    // C is assigned exclusiveA, but C is inactive.
    expect(await t().asUser(users.c, visibleCovers)).toEqual([]);
    expect(await t().asUser(users.none, visibleCovers)).toEqual([]);
  });

  it("anon reads no cover", async () => {
    expect(await t().asAnon(visibleCovers)).toEqual([]);
  });

  it("a cover becomes unreadable as soon as its genre is disabled", async () => {
    const { users, genres, covers } = fx();
    await t().db.query(`update public.genres set is_enabled = false where id = $1`, [genres.exclusiveA]);
    expect(await t().asUser(users.a, (db) => canRead(db, "genre-covers", covers.exclusiveA))).toBe(false);
    expect(await t().asUser(users.a, visibleCovers)).toEqual([covers.open]);
  });

  it("an exclusive genre's cover becomes unreadable when the access row is removed", async () => {
    const { users, businesses, genres, covers } = fx();
    await t().db.query(`delete from public.business_genre_access where business_id = $1 and genre_id = $2`, [
      businesses.a,
      genres.exclusiveA,
    ]);
    expect(await t().asUser(users.a, (db) => canRead(db, "genre-covers", covers.exclusiveA))).toBe(false);
  });

  it("an exclusive genre's cover becomes readable when the genre is made available to all", async () => {
    const { users, genres, covers } = fx();
    await t().db.query(`update public.genres set available_to_all = true where id = $1`, [genres.exclusiveB]);
    expect(await t().asUser(users.a, (db) => canRead(db, "genre-covers", covers.exclusiveB))).toBe(true);
  });

  it("the inactive venue gets its covers back once it is activated", async () => {
    const { users, businesses, covers } = fx();
    await t().db.query(`update public.businesses set is_active = true where id = $1`, [businesses.c]);
    expect(await t().asUser(users.c, visibleCovers)).toEqual([covers.open, covers.exclusiveA].sort());
  });

  it("a replaced cover object is no longer readable; the new one is", async () => {
    const { users, genres, covers } = fx();
    const replacement = `${genres.open}/${randomUUID()}.jpg`;
    await putObject(t().db, "genre-covers", replacement);
    await t().db.query(`update public.genres set cover_path = $2 where id = $1`, [genres.open, replacement]);
    await t().asUser(users.a, async (db) => {
      expect(await canRead(db, "genre-covers", replacement)).toBe(true);
      expect(await canRead(db, "genre-covers", covers.open)).toBe(false);
    });
  });

  it("the cover policy only applies to the genre-covers bucket", async () => {
    const { users, covers } = fx();
    // Same object name in other buckets: not readable through the cover rule.
    await putObject(t().db, "logos", covers.open);
    await putObject(t().db, "music", covers.open);
    await t().asUser(users.a, async (db) => {
      expect(await canRead(db, "logos", covers.open)).toBe(false);
      expect(await canRead(db, "music", covers.open)).toBe(false);
    });
  });

  it("business users cannot upload, change or delete covers — even readable ones", async () => {
    const { users, genres, covers } = fx();
    await expect(
      t().asStorageUser(users.a, (db) =>
        db.query(`insert into storage.objects (bucket_id, name, owner, owner_id) values ('genre-covers', $1, $2::uuid, $2::text)`, [
          `${genres.open}/${randomUUID()}.png`,
          users.a,
        ]),
      ),
    ).rejects.toMatchObject(rlsDenied);
    await t().asStorageUser(users.a, async (db) => {
      const update = await db.query(`update storage.objects set metadata = '{}' where bucket_id = 'genre-covers' and name = $1`, [
        covers.open,
      ]);
      expect(update.affectedRows).toBe(0);
      const remove = await db.query(`delete from storage.objects where bucket_id = 'genre-covers' and name = $1`, [covers.open]);
      expect(remove.affectedRows).toBe(0);
    });
  });

  it("the policy helper answers per caller and is not executable by anon", async () => {
    const { users, covers } = fx();
    const accessible = (db: Queryable, name: string) =>
      db.query<{ ok: boolean }>(`select private.genre_cover_accessible($1) as ok`, [name]).then((r) => r.rows[0].ok);
    await t().asUser(users.a, async (db) => {
      expect(await accessible(db, covers.exclusiveA)).toBe(true);
      expect(await accessible(db, covers.exclusiveB)).toBe(false);
      expect(await accessible(db, "no/such/cover.png")).toBe(false);
    });
    expect(await t().asUser(users.b, (db) => accessible(db, covers.exclusiveB))).toBe(true);
    // Admins manage covers through their own policies; the helper is about venues only.
    expect(await t().asUser(users.admin, (db) => accessible(db, covers.open))).toBe(false);
    await expect(t().asAnon((db) => accessible(db, covers.open))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("genre-covers bucket (platform admin)", () => {
  it("reads every cover object, including unreferenced ones", async () => {
    const { users, covers, orphanCover } = fx();
    expect(await t().asUser(users.admin, visibleCovers)).toEqual([...Object.values(covers), orphanCover].sort());
  });

  it("can upload a new cover, point the genre at it and remove the old object", async () => {
    const { users, genres, covers } = fx();
    const replacement = `${genres.exclusiveB}/${randomUUID()}.png`;
    await t().asStorageUser(users.admin, async (db) => {
      await db.query(
        `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('genre-covers', $1, $2::uuid, $2::text, '{}')`,
        [replacement, users.admin],
      );
      const updated = await db.query(`update public.genres set cover_path = $2 where id = $1`, [genres.exclusiveB, replacement]);
      expect(updated.affectedRows).toBe(1);
      const removed = await db.query(`delete from storage.objects where bucket_id = 'genre-covers' and name = $1`, [
        covers.exclusiveB,
      ]);
      expect(removed.affectedRows).toBe(1);
    });
    expect(await t().asUser(users.b, visibleCovers)).toEqual([covers.open, replacement].sort());
  });
});

describe("genres.cover_path", () => {
  it("is visible to business users on the genres they can see", async () => {
    const { users, genres, covers } = fx();
    const { rows } = await t().asUser(users.a, (db) =>
      db.query<{ id: string; cover_path: string | null }>(`select id, cover_path from public.genres order by sort_order`),
    );
    expect(rows).toEqual([
      { id: genres.open, cover_path: covers.open },
      { id: genres.exclusiveA, cover_path: covers.exclusiveA },
    ]);
  });

  it("defaults to null and can be set and cleared by admins only", async () => {
    const { users, genres } = fx();
    const created = await t().asUser(users.admin, (db) =>
      db.query<{ id: string; cover_path: string | null }>(
        `insert into public.genres (name, slug) values ('Ambient', 'ambient') returning id, cover_path`,
      ),
    );
    expect(created.rows[0].cover_path).toBeNull();

    const byMember = await t().asUser(users.a, (db) =>
      db.query(`update public.genres set cover_path = null where id = $1`, [genres.open]),
    );
    expect(byMember.affectedRows).toBe(0);

    const byAdmin = await t().asUser(users.admin, (db) =>
      db.query(`update public.genres set cover_path = null where id = $1`, [genres.open]),
    );
    expect(byAdmin.affectedRows).toBe(1);
    const { rows } = await t().db.query(`select cover_path from public.genres where id = $1`, [genres.open]);
    expect(rows).toEqual([{ cover_path: null }]);
  });

  it("rejects an empty or over-long path", async () => {
    const { users, genres } = fx();
    for (const path of ["", "x".repeat(513)]) {
      await expect(
        t().asUser(users.admin, (db) => db.query(`update public.genres set cover_path = $2 where id = $1`, [genres.open, path])),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("clearing a cover leaves the genre's tracks and counts untouched", async () => {
    const { users, genres } = fx();
    await t().db.query(`update public.genres set cover_path = null`);
    const { rows } = await t().asUser(users.a, (db) =>
      db.query<{ genre_id: string; playable_count: number }>(
        `select genre_id, playable_count from public.genre_track_counts() order by genre_id`,
      ),
    );
    expect(Object.fromEntries(rows.map((row) => [row.genre_id, row.playable_count]))).toEqual({
      [genres.open]: 2,
      [genres.exclusiveA]: 1,
    });
  });
});
