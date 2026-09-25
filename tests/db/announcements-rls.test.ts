import { describe, expect, it } from "vitest";
import { insertAnnouncement, seedScenario, selectIds, sorted } from "./fixtures";
import type { Queryable } from "./supabase-test-db";
import { setupTestDb } from "./setup-test-db";

const t = setupTestDb(seedScenario);
const fx = () => t.fixtures();

const rlsDenied = { code: "42501", message: expect.stringMatching(/row-level security/) };
const announcementIds = (db: Queryable) => selectIds(db, `select id from public.announcements`);

async function brandingVersionOf(businessId: string): Promise<number> {
  const { rows } = await t().db.query<{ branding_version: number }>(
    `select branding_version from public.businesses where id = $1`,
    [businessId],
  );
  return rows[0].branding_version;
}

describe("announcement visibility", () => {
  it("business A sees only its own playable announcements", async () => {
    const { users, announcements } = fx();
    // Not visible: draft, ready (not approved), needs_review, stale branding version, B's and C's.
    expect(await t().asUser(users.a, announcementIds)).toEqual(
      sorted([announcements.aPlayable.id, announcements.aWelcome.id]),
    );
    expect(await t().asUser(users.a2, announcementIds)).toEqual(
      sorted([announcements.aPlayable.id, announcements.aWelcome.id]),
    );
  });

  it("business B sees only B's playable announcement", async () => {
    const { users, announcements } = fx();
    expect(await t().asUser(users.b, announcementIds)).toEqual([announcements.bPlayable.id]);
  });

  it("an inactive business sees none of its announcements", async () => {
    const { users } = fx();
    expect(await t().asUser(users.c, announcementIds)).toEqual([]);
  });

  it("an announcement without audio is never visible, even if marked active", async () => {
    const { users, businesses } = fx();
    // The table check forbids active-without-audio; drop it for this test to prove the policy is independent.
    await t().db.exec(`alter table public.announcements drop constraint announcements_audio_required_check`);
    const silent = await insertAnnouncement(t().db, businesses.a, { brandingVersion: 2, withAudio: false });
    expect(await t().asUser(users.a, announcementIds)).not.toContain(silent.id);
  });

  it("an admin sees every announcement", async () => {
    const { users, announcements } = fx();
    expect(await t().asUser(users.admin, announcementIds)).toEqual(
      sorted(Object.values(announcements).map((announcement) => announcement.id)),
    );
  });
});

describe("branding changes", () => {
  it("bump branding_version and mark every announcement of that business for review", async () => {
    const { users, businesses } = fx();
    expect(await brandingVersionOf(businesses.a)).toBe(2);

    const updated = await t().asUser(users.admin, (db) =>
      db.query(`update public.businesses set station_name = 'Emerald Lounge Radio' where id = $1`, [businesses.a]),
    );
    expect(updated.affectedRows).toBe(1);
    expect(await brandingVersionOf(businesses.a)).toBe(3);

    const { rows } = await t().db.query<{ needs_review: boolean; review_reason: string | null }>(
      `select needs_review, review_reason from public.announcements where business_id = $1`,
      [businesses.a],
    );
    expect(rows.length).toBe(6);
    for (const row of rows) {
      expect(row).toEqual({
        needs_review: true,
        review_reason: 'Branding changed: "EmeraldBar Radio" → "Emerald Lounge Radio"',
      });
    }

    // Other businesses are untouched.
    const others = await t().db.query<{ n: number }>(
      `select count(*)::int as n from public.announcements where business_id <> $1 and needs_review`,
      [businesses.a],
    );
    expect(others.rows[0].n).toBe(0);
  });

  it("hide the announcements until they are re-approved at the new branding version", async () => {
    const { users, businesses, announcements } = fx();
    await t().asUser(users.admin, (db) =>
      db.query(`update public.businesses set name_pronunciation = 'Em-er-ald Bar' where id = $1`, [businesses.a]),
    );
    expect(await t().asUser(users.a, announcementIds)).toEqual([]);

    // Clearing needs_review without moving to the new branding version is not enough.
    await t().asUser(users.admin, (db) =>
      db.query(`update public.announcements set needs_review = false where id = $1`, [announcements.aWelcome.id]),
    );
    expect(await t().asUser(users.a, announcementIds)).toEqual([]);

    // Re-approval (what the approve action does) makes it playable again.
    await t().asUser(users.admin, (db) =>
      db.query(
        `update public.announcements
            set status = 'active', needs_review = false, review_reason = null, approved_at = now(), approved_by = $2,
                branding_version = (select branding_version from public.businesses where id = business_id)
          where id = $1`,
        [announcements.aPlayable.id, users.admin],
      ),
    );
    expect(await t().asUser(users.a, announcementIds)).toEqual([announcements.aPlayable.id]);
  });

  it("describe a name/pronunciation-only change without a station arrow", async () => {
    const { businesses, announcements } = fx();
    await t().db.query(`update public.businesses set name = 'Emerald Bar & Grill' where id = $1`, [businesses.a]);
    const { rows } = await t().db.query(`select review_reason from public.announcements where id = $1`, [
      announcements.aPlayable.id,
    ]);
    expect(rows).toEqual([{ review_reason: "Branding changed: venue name or pronunciation updated" }]);
  });

  it("non-branding updates do not bump the version or flag announcements", async () => {
    const { users, businesses, announcements } = fx();
    await t().asUser(users.admin, (db) =>
      db.query(
        `update public.businesses
            set announcement_every_n_tracks = 7, announcement_volume = 0.5, contact_email = 'bar@test.local',
                station_name = station_name
          where id = $1`,
        [businesses.a],
      ),
    );
    expect(await brandingVersionOf(businesses.a)).toBe(2);
    expect(await t().asUser(users.a, announcementIds)).toEqual(
      sorted([announcements.aPlayable.id, announcements.aWelcome.id]),
    );
  });

  it("branding_version cannot be set directly", async () => {
    const { users, businesses } = fx();
    await t().asUser(users.admin, (db) =>
      db.query(`update public.businesses set branding_version = 99 where id = $1`, [businesses.a]),
    );
    expect(await brandingVersionOf(businesses.a)).toBe(2);
  });
});

describe("announcement state backstops", () => {
  it("rejects ready/active without audio and active without approval", async () => {
    const { businesses } = fx();
    const db = t().db;
    const attempt = async (sql: string) => {
      await db.exec("savepoint backstop");
      try {
        await db.query(sql, [businesses.a]);
        return null;
      } catch (error) {
        return (error as { code?: string }).code ?? "unknown";
      } finally {
        await db.exec("rollback to savepoint backstop; release savepoint backstop");
      }
    };
    expect(await attempt(`insert into public.announcements (business_id, text, status) values ($1, 'x', 'ready')`)).toBe(
      "23514",
    );
    expect(
      await attempt(
        `insert into public.announcements (business_id, text, status, audio_path) values ($1, 'x', 'active', 'p.mp3')`,
      ),
    ).toBe("23514");
    expect(
      await attempt(
        `insert into public.announcements (business_id, text, status, audio_path, approved_at)
         values ($1, 'x', 'active', 'p.mp3', now())`,
      ),
    ).toBeNull();
  });
});

describe("playback_preferences", () => {
  it("a user can save preferences with an accessible genre, and read them back", async () => {
    const { users, businesses, genres } = fx();
    await t().asUser(users.a, async (db) => {
      await db.query(
        `insert into public.playback_preferences (user_id, business_id, genre_id, volume, muted) values ($1, $2, $3, 0.5, true)`,
        [users.a, businesses.a, genres.exclusiveA],
      );
      const { rows } = await db.query(`select genre_id, muted from public.playback_preferences`);
      expect(rows).toEqual([{ genre_id: genres.exclusiveA, muted: true }]);
      const updated = await db.query(`update public.playback_preferences set genre_id = $2 where user_id = $1`, [
        users.a,
        genres.open,
      ]);
      expect(updated.affectedRows).toBe(1);
      const cleared = await db.query(`update public.playback_preferences set genre_id = null where user_id = $1`, [users.a]);
      expect(cleared.affectedRows).toBe(1);
    });
  });

  it("rejects a genre that is not accessible (B's exclusive, disabled)", async () => {
    const { users, businesses, genres } = fx();
    for (const genreId of [genres.exclusiveB, genres.disabled, genres.disabledExclusiveA]) {
      await expect(
        t().asUser(users.a, (db) =>
          db.query(`insert into public.playback_preferences (user_id, business_id, genre_id) values ($1, $2, $3)`, [
            users.a,
            businesses.a,
            genreId,
          ]),
        ),
      ).rejects.toMatchObject(rlsDenied);
    }
    await t().db.query(`insert into public.playback_preferences (user_id, business_id, genre_id) values ($1, $2, $3)`, [
      users.a,
      businesses.a,
      genres.open,
    ]);
    await expect(
      t().asUser(users.a, (db) =>
        db.query(`update public.playback_preferences set genre_id = $2 where user_id = $1`, [users.a, genres.exclusiveB]),
      ),
    ).rejects.toMatchObject(rlsDenied);
  });

  it("rejects rows for another user or another business", async () => {
    const { users, businesses } = fx();
    await expect(
      t().asUser(users.a, (db) =>
        db.query(`insert into public.playback_preferences (user_id, business_id) values ($1, $2)`, [users.a2, businesses.a]),
      ),
    ).rejects.toMatchObject(rlsDenied);
    await expect(
      t().asUser(users.a, (db) =>
        db.query(`insert into public.playback_preferences (user_id, business_id) values ($1, $2)`, [users.a, businesses.b]),
      ),
    ).rejects.toMatchObject(rlsDenied);
  });

  it("are private to their owner, even within the same business", async () => {
    const { users, businesses } = fx();
    await t().db.query(`insert into public.playback_preferences (user_id, business_id) values ($1, $2)`, [
      users.a,
      businesses.a,
    ]);
    await t().asUser(users.a2, async (db) => {
      expect((await db.query(`select * from public.playback_preferences`)).rows).toEqual([]);
      expect((await db.query(`update public.playback_preferences set muted = true`)).affectedRows).toBe(0);
      expect((await db.query(`delete from public.playback_preferences`)).affectedRows).toBe(0);
    });
    const admin = await t().asUser(users.admin, (db) => db.query(`select * from public.playback_preferences`));
    expect(admin.rows).toEqual([]);
  });

  it("an inactive business can store a null genre but not a content genre", async () => {
    const { users, businesses, genres } = fx();
    await t().asUser(users.c, (db) =>
      db.query(`insert into public.playback_preferences (user_id, business_id, volume) values ($1, $2, 0.3)`, [
        users.c,
        businesses.c,
      ]),
    );
    await expect(
      t().asUser(users.c, (db) =>
        db.query(`update public.playback_preferences set genre_id = $2 where user_id = $1`, [users.c, genres.open]),
      ),
    ).rejects.toMatchObject(rlsDenied);
  });
});
