import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seedScenario, selectIds, sorted } from "./fixtures";
import type { Queryable } from "./supabase-test-db";
import { setupTestDb } from "./setup-test-db";

const t = setupTestDb(seedScenario);
const fx = () => t.fixtures();

const notAdmin = { code: "42501", message: "Only platform admins can perform this action" };

async function consume(db: Queryable, key: string, max: number, windowSeconds: number): Promise<boolean> {
  const { rows } = await db.query<{ allowed: boolean }>(`select public.consume_rate_limit($1, $2, $3) as allowed`, [
    key,
    max,
    windowSeconds,
  ]);
  return rows[0].allowed;
}

async function bucketCount(key: string): Promise<number> {
  const { rows } = await t().db.query<{ count: number }>(`select count from public.rate_limit_buckets where key = $1`, [
    key,
  ]);
  return rows[0].count;
}

describe("consume_rate_limit", () => {
  it("allows p_max calls per window, then denies", async () => {
    const results = await t().asService(async (db) => {
      const out: boolean[] = [];
      for (let i = 0; i < 5; i += 1) out.push(await consume(db, "sign:user-1", 3, 60));
      return out;
    });
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("keeps separate buckets per key", async () => {
    await t().asService(async (db) => {
      expect(await consume(db, "k:a", 1, 60)).toBe(true);
      expect(await consume(db, "k:a", 1, 60)).toBe(false);
      expect(await consume(db, "k:b", 1, 60)).toBe(true);
    });
  });

  it("starts a fresh window once the previous one has elapsed", async () => {
    await t().asService(async (db) => {
      expect(await consume(db, "k:reset", 2, 60)).toBe(true);
      expect(await consume(db, "k:reset", 2, 60)).toBe(true);
      expect(await consume(db, "k:reset", 2, 60)).toBe(false);
    });
    // now() is fixed inside the test transaction, so age the window instead of waiting.
    await t().db.query(
      `update public.rate_limit_buckets set window_started_at = window_started_at - interval '61 seconds' where key = 'k:reset'`,
    );
    const afterReset = await t().asService(async (db) => [
      await consume(db, "k:reset", 2, 60),
      await consume(db, "k:reset", 2, 60),
      await consume(db, "k:reset", 2, 60),
    ]);
    // The new window is enforced too (it must not keep resetting).
    expect(afterReset).toEqual([true, true, false]);
    const { rows } = await t().db.query<{ fresh: boolean }>(
      `select window_started_at = now() as fresh from public.rate_limit_buckets where key = 'k:reset'`,
    );
    expect(rows).toEqual([{ fresh: true }]);
  });

  it("does not reset while the window is still open", async () => {
    await t().asService((db) => consume(db, "k:open", 1, 60));
    await t().db.query(
      `update public.rate_limit_buckets set window_started_at = window_started_at - interval '59 seconds' where key = 'k:open'`,
    );
    expect(await t().asService((db) => consume(db, "k:open", 1, 60))).toBe(false);
  });

  it("caps the stored count while denying", async () => {
    await t().asService(async (db) => {
      for (let i = 0; i < 10; i += 1) await consume(db, "k:cap", 2, 60);
    });
    expect(await bucketCount("k:cap")).toBe(3);
  });

  it("rejects invalid arguments", async () => {
    for (const [key, max, window] of [
      ["", 1, 60],
      ["k", 0, 60],
      ["k", 1, 0],
    ] as const) {
      await expect(t().asService((db) => consume(db, key, max, window))).rejects.toMatchObject({ code: "22023" });
    }
  });

  it("is not executable by authenticated users or anon, and its table is not readable", async () => {
    const { users } = fx();
    const denied = { code: "42501", message: expect.stringMatching(/permission denied for function consume_rate_limit/) };
    await expect(t().asUser(users.a, (db) => consume(db, "k", 1, 60))).rejects.toMatchObject(denied);
    await expect(t().asUser(users.admin, (db) => consume(db, "k", 1, 60))).rejects.toMatchObject(denied);
    await expect(t().asAnon((db) => consume(db, "k", 1, 60))).rejects.toMatchObject(denied);
    await expect(t().asUser(users.admin, (db) => db.query(`select * from public.rate_limit_buckets`))).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("reorder_genres", () => {
  const sortOrders = async () => {
    const { rows } = await t().db.query<{ id: string; sort_order: number }>(
      `select id, sort_order from public.genres order by sort_order`,
    );
    return rows;
  };

  it("sets sort_order to the array position and keeps unlisted genres after, in their old order", async () => {
    const { users, genres } = fx();
    await t().asUser(users.admin, (db) =>
      db.query(`select public.reorder_genres($1::uuid[])`, [[genres.exclusiveB, genres.open, genres.exclusiveA]]),
    );
    expect(await sortOrders()).toEqual([
      { id: genres.exclusiveB, sort_order: 1 },
      { id: genres.open, sort_order: 2 },
      { id: genres.exclusiveA, sort_order: 3 },
      { id: genres.disabled, sort_order: 4 },
      { id: genres.disabledExclusiveA, sort_order: 5 },
    ]);
  });

  it("raises 42501 for business users and leaves the order unchanged", async () => {
    const { users, genres } = fx();
    const before = await sortOrders();
    await expect(
      t().asUser(users.a, (db) => db.query(`select public.reorder_genres($1::uuid[])`, [[genres.exclusiveA, genres.open]])),
    ).rejects.toMatchObject(notAdmin);
    expect(await sortOrders()).toEqual(before);
  });

  it("rejects unknown, duplicate and null ids", async () => {
    const { users, genres } = fx();
    const call = (ids: (string | null)[]) =>
      t().asUser(users.admin, (db) => db.query(`select public.reorder_genres($1::uuid[])`, [ids]));
    await expect(call([genres.open, randomUUID()])).rejects.toMatchObject({ code: "23503" });
    await expect(call([genres.open, genres.open])).rejects.toMatchObject({ code: "22023" });
    await expect(call([genres.open, null])).rejects.toMatchObject({ code: "22004" });
  });

  it("is available to the service role", async () => {
    const { genres } = fx();
    await t().asService((db) => db.query(`select public.reorder_genres($1::uuid[])`, [[genres.disabled]]));
    expect((await sortOrders())[0]).toEqual({ id: genres.disabled, sort_order: 1 });
  });
});

describe("set_business_genre_access", () => {
  const accessOf = (businessId: string) =>
    selectIds(t().db, `select genre_id as id from public.business_genre_access where business_id = $1`, [businessId]);

  it("replaces the business's access set", async () => {
    const { users, businesses, genres } = fx();
    await t().asUser(users.admin, (db) =>
      db.query(`select public.set_business_genre_access($1, $2::uuid[])`, [
        businesses.a,
        [genres.exclusiveA, genres.exclusiveB],
      ]),
    );
    expect(await accessOf(businesses.a)).toEqual(sorted([genres.exclusiveA, genres.exclusiveB]));
    expect(await t().asUser(users.a, (db) => selectIds(db, `select id from public.genres`))).toEqual(
      sorted([genres.open, genres.exclusiveA, genres.exclusiveB]),
    );
    // B keeps its own assignment.
    expect(await accessOf(businesses.b)).toEqual([genres.exclusiveB]);

    await t().asUser(users.admin, (db) =>
      db.query(`select public.set_business_genre_access($1, $2::uuid[])`, [businesses.a, []]),
    );
    expect(await accessOf(businesses.a)).toEqual([]);
  });

  it("is atomic: an unknown genre fails the whole call", async () => {
    const { users, businesses, genres } = fx();
    const before = await accessOf(businesses.a);
    await expect(
      t().asUser(users.admin, (db) =>
        db.query(`select public.set_business_genre_access($1, $2::uuid[])`, [businesses.a, [genres.open, randomUUID()]]),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    expect(await accessOf(businesses.a)).toEqual(before);
  });

  it("rejects an unknown business", async () => {
    const { users, genres } = fx();
    await expect(
      t().asUser(users.admin, (db) =>
        db.query(`select public.set_business_genre_access($1, $2::uuid[])`, [randomUUID(), [genres.open]]),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("raises 42501 for business users", async () => {
    const { users, businesses, genres } = fx();
    await expect(
      t().asUser(users.a, (db) =>
        db.query(`select public.set_business_genre_access($1, $2::uuid[])`, [businesses.a, [genres.exclusiveB]]),
      ),
    ).rejects.toMatchObject(notAdmin);
    expect(await accessOf(businesses.a)).toEqual(sorted([genres.exclusiveA, genres.disabledExclusiveA]));
  });
});

describe("set_track_genres", () => {
  const genresOf = (trackId: string) =>
    selectIds(t().db, `select genre_id as id from public.track_genres where track_id = $1`, [trackId]);

  it("replaces a track's genres, which changes what businesses can play", async () => {
    const { users, tracks, genres } = fx();
    await t().asUser(users.admin, async (db) => {
      await db.query(`select public.set_track_genres($1, $2::uuid[])`, [tracks.unassigned.id, [genres.open]]);
      await db.query(`select public.set_track_genres($1, $2::uuid[])`, [tracks.openAndExclusiveB.id, [genres.exclusiveB]]);
    });
    expect(await genresOf(tracks.unassigned.id)).toEqual([genres.open]);
    expect(await genresOf(tracks.openAndExclusiveB.id)).toEqual([genres.exclusiveB]);

    const visibleToA = await t().asUser(users.a, (db) => selectIds(db, `select id from public.tracks`));
    expect(visibleToA).toContain(tracks.unassigned.id);
    expect(visibleToA).not.toContain(tracks.openAndExclusiveB.id);
  });

  it("can clear all genres", async () => {
    const { users, tracks } = fx();
    await t().asUser(users.admin, (db) =>
      db.query(`select public.set_track_genres($1, $2::uuid[])`, [tracks.disabledOnly.id, []]),
    );
    expect(await genresOf(tracks.disabledOnly.id)).toEqual([]);
  });

  it("rejects an unknown track or genre", async () => {
    const { users, tracks, genres } = fx();
    await expect(
      t().asUser(users.admin, (db) => db.query(`select public.set_track_genres($1, $2::uuid[])`, [randomUUID(), [genres.open]])),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      t().asUser(users.admin, (db) =>
        db.query(`select public.set_track_genres($1, $2::uuid[])`, [tracks.openPlayable.id, [randomUUID()]]),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    expect(await genresOf(tracks.openPlayable.id)).toEqual([genres.open]);
  });

  it("raises 42501 for business users", async () => {
    const { users, tracks, genres } = fx();
    await expect(
      t().asUser(users.a, (db) =>
        db.query(`select public.set_track_genres($1, $2::uuid[])`, [tracks.exclusiveB.id, [genres.exclusiveA]]),
      ),
    ).rejects.toMatchObject(notAdmin);
    expect(await genresOf(tracks.exclusiveB.id)).toEqual([genres.exclusiveB]);
  });
});

describe("genre_track_counts", () => {
  type Counts = Record<string, { playable: number; total: number }>;
  const counts = async (db: Queryable): Promise<Counts> => {
    const { rows } = await db.query<{ genre_id: string; playable_count: number; total_count: number }>(
      `select genre_id, playable_count, total_count from public.genre_track_counts()`,
    );
    return Object.fromEntries(rows.map((row) => [row.genre_id, { playable: row.playable_count, total: row.total_count }]));
  };

  it("counts the whole catalogue for admins (and the service role)", async () => {
    const { users, genres } = fx();
    const expected: Counts = {
      [genres.open]: { playable: 2, total: 4 },
      [genres.exclusiveA]: { playable: 1, total: 1 },
      [genres.exclusiveB]: { playable: 2, total: 2 },
      [genres.disabled]: { playable: 1, total: 1 },
      [genres.disabledExclusiveA]: { playable: 1, total: 1 },
    };
    expect(await t().asUser(users.admin, counts)).toEqual(expected);
    expect(await t().asService(counts)).toEqual(expected);
  });

  it("includes genres without tracks", async () => {
    const { users } = fx();
    const { rows } = await t().db.query<{ id: string }>(
      `insert into public.genres (name, slug) values ('Empty', 'empty') returning id`,
    );
    expect((await t().asUser(users.admin, counts))[rows[0].id]).toEqual({ playable: 0, total: 0 });
  });

  it("counts only accessible genres and playable tracks for business users", async () => {
    const { users, genres } = fx();
    expect(await t().asUser(users.a, counts)).toEqual({
      [genres.open]: { playable: 2, total: 2 },
      [genres.exclusiveA]: { playable: 1, total: 1 },
    });
    expect(await t().asUser(users.b, counts)).toEqual({
      [genres.open]: { playable: 2, total: 2 },
      [genres.exclusiveB]: { playable: 2, total: 2 },
    });
    expect(await t().asUser(users.c, counts)).toEqual({});
    expect(await t().asUser(users.none, counts)).toEqual({});
  });
});
