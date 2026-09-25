import { describe, expect, it } from "vitest";
import { seedScenario, selectIds, sorted } from "./fixtures";
import type { Queryable } from "./supabase-test-db";
import { setupTestDb } from "./setup-test-db";

const t = setupTestDb(seedScenario);
const fx = () => t.fixtures();

const PUBLIC_TABLES = [
  "profiles",
  "businesses",
  "business_members",
  "genres",
  "business_genre_access",
  "tracks",
  "track_genres",
  "announcements",
  "playback_preferences",
  "rate_limit_buckets",
  "access_requests",
  // platform_settings is the one table anon may read (public content): see platform-settings-rls.test.ts.
] as const;

const rlsDenied = { code: "42501", message: expect.stringMatching(/row-level security/) };

const genreIds = (db: Queryable) => selectIds(db, `select id from public.genres`);
const trackIds = (db: Queryable) => selectIds(db, `select id from public.tracks`);
const trackGenrePairs = async (db: Queryable) =>
  (await db.query<{ track_id: string; genre_id: string }>(`select track_id, genre_id from public.track_genres`)).rows
    .map((row) => `${row.track_id}:${row.genre_id}`)
    .sort();

describe("anon", () => {
  it.each(PUBLIC_TABLES)("has no privilege on public.%s", async (table) => {
    await expect(t().asAnon((db) => db.query(`select * from public.${table}`))).rejects.toMatchObject({
      code: "42501",
      message: expect.stringMatching(/permission denied/),
    });
  });

  it("cannot call the private helpers or the RPCs", async () => {
    await expect(t().asAnon((db) => db.query(`select private.is_platform_admin()`))).rejects.toMatchObject({
      code: "42501",
    });
    await expect(t().asAnon((db) => db.query(`select * from public.genre_track_counts()`))).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("business user of active business A", () => {
  it("sees only their own business and their own membership", async () => {
    const { users, businesses } = fx();
    await t().asUser(users.a, async (db) => {
      expect(await selectIds(db, `select id from public.businesses`)).toEqual([businesses.a]);
      const members = await db.query(`select business_id, user_id from public.business_members`);
      expect(members.rows).toEqual([{ business_id: businesses.a, user_id: users.a }]);
    });
  });

  it("sees enabled genres that are available to all or assigned to A — never B's or disabled ones", async () => {
    const { users, genres } = fx();
    expect(await t().asUser(users.a, genreIds)).toEqual(sorted([genres.open, genres.exclusiveA]));
    expect(await t().asUser(users.b, genreIds)).toEqual(sorted([genres.open, genres.exclusiveB]));
  });

  it("sees only A's genre access rows", async () => {
    const { users, businesses, genres } = fx();
    const rows = await t().asUser(users.a, (db) =>
      db.query<{ business_id: string; genre_id: string }>(`select business_id, genre_id from public.business_genre_access`),
    );
    expect(rows.rows.every((row) => row.business_id === businesses.a)).toBe(true);
    expect(rows.rows.map((row) => row.genre_id).sort()).toEqual(sorted([genres.exclusiveA, genres.disabledExclusiveA]));
  });

  it("sees only playable tracks in accessible genres", async () => {
    const { users, tracks } = fx();
    expect(await t().asUser(users.a, trackIds)).toEqual(
      sorted([tracks.openPlayable.id, tracks.exclusiveA.id, tracks.openAndExclusiveB.id]),
    );
    expect(await t().asUser(users.b, trackIds)).toEqual(
      sorted([tracks.openPlayable.id, tracks.exclusiveB.id, tracks.openAndExclusiveB.id]),
    );
  });

  it("sees track_genres only for accessible tracks in accessible genres", async () => {
    const { users, tracks, genres } = fx();
    expect(await t().asUser(users.a, trackGenrePairs)).toEqual(
      [
        `${tracks.openPlayable.id}:${genres.open}`,
        `${tracks.exclusiveA.id}:${genres.exclusiveA}`,
        // openAndExclusiveB is visible through "open", but its exclusiveB link stays hidden.
        `${tracks.openAndExclusiveB.id}:${genres.open}`,
      ].sort(),
    );
  });

  it("loses a genre and its tracks as soon as the genre is disabled", async () => {
    const { users, genres, tracks } = fx();
    await t().db.query(`update public.genres set is_enabled = false where id = $1`, [genres.exclusiveA]);
    expect(await t().asUser(users.a, genreIds)).toEqual([genres.open]);
    expect(await t().asUser(users.a, trackIds)).not.toContain(tracks.exclusiveA.id);
  });

  it("loses an exclusive genre when its access row is removed", async () => {
    const { users, genres, businesses } = fx();
    await t().db.query(`delete from public.business_genre_access where business_id = $1 and genre_id = $2`, [
      businesses.a,
      genres.exclusiveA,
    ]);
    expect(await t().asUser(users.a, genreIds)).toEqual([genres.open]);
  });

  it("loses a track when it is disabled or removed", async () => {
    const { users, tracks } = fx();
    await t().db.query(`update public.tracks set is_active = false where id = $1`, [tracks.openPlayable.id]);
    await t().db.query(`update public.tracks set removed_at = now() where id = $1`, [tracks.exclusiveA.id]);
    expect(await t().asUser(users.a, trackIds)).toEqual([tracks.openAndExclusiveB.id]);
  });
});

describe("business user of inactive business C", () => {
  it("can read their own business row", async () => {
    const { users, businesses } = fx();
    const rows = await t().asUser(users.c, (db) =>
      db.query<{ id: string; is_active: boolean }>(`select id, is_active from public.businesses`),
    );
    expect(rows.rows).toEqual([{ id: businesses.c, is_active: false }]);
  });

  it("sees no genres, tracks, track_genres or announcements", async () => {
    const { users } = fx();
    await t().asUser(users.c, async (db) => {
      expect(await genreIds(db)).toEqual([]);
      expect(await trackIds(db)).toEqual([]);
      expect(await trackGenrePairs(db)).toEqual([]);
      expect(await selectIds(db, `select id from public.announcements`)).toEqual([]);
    });
  });

  it("gets everything back when the business is activated", async () => {
    const { users, businesses, genres } = fx();
    await t().db.query(`update public.businesses set is_active = true where id = $1`, [businesses.c]);
    expect(await t().asUser(users.c, genreIds)).toEqual(sorted([genres.open, genres.exclusiveA]));
  });
});

describe("signed-in user without a business", () => {
  it("sees no business, genre, track or announcement", async () => {
    const { users } = fx();
    await t().asUser(users.none, async (db) => {
      expect(await selectIds(db, `select id from public.businesses`)).toEqual([]);
      expect(await genreIds(db)).toEqual([]);
      expect(await trackIds(db)).toEqual([]);
      expect(await selectIds(db, `select id from public.announcements`)).toEqual([]);
    });
  });
});

describe("business users cannot write admin-managed data", () => {
  it("cannot insert, update or delete businesses", async () => {
    const { users, businesses } = fx();
    await expect(
      t().asUser(users.a, (db) => db.query(`insert into public.businesses (name, station_name) values ('X', 'X Radio')`)),
    ).rejects.toMatchObject(rlsDenied);
    await t().asUser(users.a, async (db) => {
      expect((await db.query(`update public.businesses set is_active = true where id = $1`, [businesses.a])).affectedRows).toBe(0);
      expect((await db.query(`update public.businesses set name = 'Mine' where id = $1`, [businesses.a])).affectedRows).toBe(0);
      expect((await db.query(`delete from public.businesses where id = $1`, [businesses.a])).affectedRows).toBe(0);
    });
    const { rows } = await t().db.query(`select name from public.businesses where id = $1`, [businesses.a]);
    expect(rows).toEqual([{ name: "EmeraldBar" }]);
  });

  it("cannot insert, update or delete memberships", async () => {
    const { users, businesses } = fx();
    await expect(
      t().asUser(users.none, (db) =>
        db.query(`insert into public.business_members (business_id, user_id) values ($1, $2)`, [businesses.a, users.none]),
      ),
    ).rejects.toMatchObject(rlsDenied);
    await t().asUser(users.a, async (db) => {
      expect(
        (await db.query(`update public.business_members set business_id = $1 where user_id = $2`, [businesses.b, users.a]))
          .affectedRows,
      ).toBe(0);
      expect((await db.query(`delete from public.business_members where user_id = $1`, [users.a])).affectedRows).toBe(0);
    });
  });

  it("cannot insert, update or delete genres or access rows", async () => {
    const { users, businesses, genres } = fx();
    await expect(
      t().asUser(users.a, (db) => db.query(`insert into public.genres (name, slug) values ('Mine', 'mine')`)),
    ).rejects.toMatchObject(rlsDenied);
    await expect(
      t().asUser(users.a, (db) =>
        db.query(`insert into public.business_genre_access (business_id, genre_id) values ($1, $2)`, [
          businesses.a,
          genres.exclusiveB,
        ]),
      ),
    ).rejects.toMatchObject(rlsDenied);
    await t().asUser(users.a, async (db) => {
      expect((await db.query(`update public.genres set name = 'Renamed' where id = $1`, [genres.open])).affectedRows).toBe(0);
      expect((await db.query(`delete from public.genres where id = $1`, [genres.open])).affectedRows).toBe(0);
      expect(
        (await db.query(`delete from public.business_genre_access where business_id = $1`, [businesses.a])).affectedRows,
      ).toBe(0);
    });
  });

  it("cannot insert, update or delete tracks or track_genres", async () => {
    const { users, tracks, genres } = fx();
    await expect(
      t().asUser(users.a, (db) =>
        db.query(
          `insert into public.tracks (title, duration_seconds, storage_path, file_size_bytes) values ('x', 1, 'tracks/x/y.mp3', 1)`,
        ),
      ),
    ).rejects.toMatchObject(rlsDenied);
    await expect(
      t().asUser(users.a, (db) =>
        db.query(`insert into public.track_genres (track_id, genre_id) values ($1, $2)`, [
          tracks.exclusiveB.id,
          genres.exclusiveA,
        ]),
      ),
    ).rejects.toMatchObject(rlsDenied);
    await t().asUser(users.a, async (db) => {
      expect(
        (await db.query(`update public.tracks set title = 'Renamed' where id = $1`, [tracks.openPlayable.id])).affectedRows,
      ).toBe(0);
      expect((await db.query(`delete from public.tracks where id = $1`, [tracks.openPlayable.id])).affectedRows).toBe(0);
      expect(
        (await db.query(`delete from public.track_genres where track_id = $1`, [tracks.openPlayable.id])).affectedRows,
      ).toBe(0);
    });
  });

  it("cannot insert, update or delete announcements", async () => {
    const { users, businesses, announcements } = fx();
    await expect(
      t().asUser(users.a, (db) =>
        db.query(`insert into public.announcements (business_id, text) values ($1, 'Hello')`, [businesses.a]),
      ),
    ).rejects.toMatchObject(rlsDenied);
    await t().asUser(users.a, async (db) => {
      expect(
        (await db.query(`update public.announcements set text = 'Changed' where id = $1`, [announcements.aPlayable.id]))
          .affectedRows,
      ).toBe(0);
      expect(
        (await db.query(`update public.announcements set status = 'active', needs_review = false where id = $1`, [
          announcements.aNeedsReview.id,
        ])).affectedRows,
      ).toBe(0);
      expect(
        (await db.query(`delete from public.announcements where id = $1`, [announcements.aPlayable.id])).affectedRows,
      ).toBe(0);
    });
  });
});

describe("platform admin", () => {
  it("sees every business, genre, track and track link", async () => {
    const { users, businesses, genres, tracks } = fx();
    await t().asUser(users.admin, async (db) => {
      expect(await selectIds(db, `select id from public.businesses`)).toEqual(
        sorted([businesses.a, businesses.b, businesses.c]),
      );
      expect(await genreIds(db)).toEqual(sorted(Object.values(genres)));
      expect(await trackIds(db)).toEqual(sorted(Object.values(tracks).map((track) => track.id)));
      const links = await db.query<{ n: number }>(`select count(*)::int as n from public.track_genres`);
      expect(links.rows[0].n).toBe(9);
    });
  });

  it("can create, update and delete catalogue rows", async () => {
    const { users, businesses } = fx();
    await t().asUser(users.admin, async (db) => {
      const genre = await db.query<{ id: string }>(
        `insert into public.genres (name, slug, available_to_all) values ('Ambient', 'ambient', false) returning id`,
      );
      const genreId = genre.rows[0].id;
      await db.query(`insert into public.business_genre_access (business_id, genre_id) values ($1, $2)`, [
        businesses.b,
        genreId,
      ]);
      const track = await db.query<{ id: string }>(
        `insert into public.tracks (title, duration_seconds, storage_path, file_size_bytes, created_by)
         values ('Ambient 1', 200, 'tracks/new/1.mp3', 1000, $1) returning id`,
        [users.admin],
      );
      await db.query(`insert into public.track_genres (track_id, genre_id) values ($1, $2)`, [track.rows[0].id, genreId]);
      expect(
        (await db.query(`update public.businesses set announcement_every_n_tracks = 6 where id = $1`, [businesses.a]))
          .affectedRows,
      ).toBe(1);
      expect((await db.query(`delete from public.genres where id = $1`, [genreId])).affectedRows).toBe(1);
    });
  });

  it("can add and remove business members", async () => {
    const { users, businesses } = fx();
    await t().asUser(users.admin, async (db) => {
      await db.query(`insert into public.business_members (business_id, user_id) values ($1, $2)`, [
        businesses.b,
        users.none,
      ]);
      expect((await db.query(`delete from public.business_members where user_id = $1`, [users.none])).affectedRows).toBe(1);
    });
  });

  it("cannot put a user in two businesses", async () => {
    const { users, businesses } = fx();
    await expect(
      t().asUser(users.admin, (db) =>
        db.query(`insert into public.business_members (business_id, user_id) values ($1, $2)`, [businesses.b, users.a]),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
