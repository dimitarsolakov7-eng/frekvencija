// platform_settings singleton (20260926000100_frekvencija.sql): public content
// readable by everyone (anon included); only platform admins may update it; the
// single row is created by the migration and can never be duplicated or deleted
// through the API roles.
import { describe, expect, it } from "vitest";
import { createAdmin, seedScenario } from "./fixtures";
import type { Queryable } from "./supabase-test-db";
import { setupTestDb } from "./setup-test-db";

const t = setupTestDb(seedScenario);
const fx = () => t.fixtures();

const permissionDenied = { code: "42501", message: expect.stringMatching(/permission denied for table platform_settings/) };

const PUBLIC_COLUMNS = `id, contact_email, contact_phone, privacy_policy, terms_of_service, default_announcement_every_n_tracks`;

const DEFAULTS = {
  id: true,
  contact_email: null,
  contact_phone: null,
  privacy_policy: null,
  terms_of_service: null,
  default_announcement_every_n_tracks: 4,
};

const readSettings = async (db: Queryable) => (await db.query(`select ${PUBLIC_COLUMNS} from public.platform_settings`)).rows;

describe("platform_settings: the singleton row", () => {
  it("exists after the migrations, with the documented defaults", async () => {
    const { rows } = await t().db.query(`select ${PUBLIC_COLUMNS}, updated_by from public.platform_settings`);
    expect(rows).toEqual([{ ...DEFAULTS, updated_by: null }]);
  });

  it("cannot be duplicated, even by the service role", async () => {
    await expect(
      t().asService((db) => db.query(`insert into public.platform_settings (contact_email) values ('x@test.local')`)),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(t().asService((db) => db.query(`insert into public.platform_settings (id) values (false)`))).rejects.toMatchObject(
      { code: "23514" },
    );
    const { rows } = await t().db.query<{ n: number }>(`select count(*)::int as n from public.platform_settings`);
    expect(rows[0].n).toBe(1);
  });

  it("cannot be deleted through the API roles", async () => {
    const { users } = fx();
    await expect(t().asService((db) => db.query(`delete from public.platform_settings`))).rejects.toMatchObject(
      permissionDenied,
    );
    await expect(t().asUser(users.admin, (db) => db.query(`delete from public.platform_settings`))).rejects.toMatchObject(
      permissionDenied,
    );
  });

  it("the service role can upsert it (maintenance scripts)", async () => {
    await t().asService((db) =>
      db.query(
        `insert into public.platform_settings (id, contact_email) values (true, 'hello@test.local')
         on conflict (id) do update set contact_email = excluded.contact_email`,
      ),
    );
    const { rows } = await t().db.query(`select contact_email from public.platform_settings`);
    expect(rows).toEqual([{ contact_email: "hello@test.local" }]);
  });
});

describe("platform_settings: reading", () => {
  it("anon (no session) can read it", async () => {
    expect(await t().asAnon(readSettings)).toEqual([DEFAULTS]);
    // Including select * (every column is public content).
    const { rows } = await t().asAnon((db) => db.query(`select * from public.platform_settings`));
    expect(rows).toHaveLength(1);
  });

  it("business users (active or inactive), users without a business and admins can read it", async () => {
    const { users } = fx();
    for (const userId of [users.a, users.b, users.c, users.none, users.admin]) {
      expect(await t().asUser(userId, readSettings)).toEqual([DEFAULTS]);
    }
  });
});

describe("platform_settings: writing", () => {
  it("anon cannot insert, update or delete", async () => {
    await expect(
      t().asAnon((db) => db.query(`update public.platform_settings set contact_email = 'evil@test.local'`)),
    ).rejects.toMatchObject(permissionDenied);
    await expect(t().asAnon((db) => db.query(`insert into public.platform_settings (id) values (true)`))).rejects.toMatchObject(
      permissionDenied,
    );
    await expect(t().asAnon((db) => db.query(`delete from public.platform_settings`))).rejects.toMatchObject(permissionDenied);
  });

  it("business users cannot update (RLS) nor insert or delete (no privilege)", async () => {
    const { users } = fx();
    for (const userId of [users.a, users.c, users.none]) {
      await t().asUser(userId, async (db) => {
        const update = await db.query(
          `update public.platform_settings
              set privacy_policy = 'Hijacked', default_announcement_every_n_tracks = 1
            where id`,
        );
        expect(update.affectedRows).toBe(0);
      });
      await expect(
        t().asUser(userId, (db) => db.query(`insert into public.platform_settings (id) values (true)`)),
      ).rejects.toMatchObject(permissionDenied);
      await expect(t().asUser(userId, (db) => db.query(`delete from public.platform_settings`))).rejects.toMatchObject(
        permissionDenied,
      );
    }
    expect(await readSettings(t().db)).toEqual([DEFAULTS]);
  });

  it("admins update every setting; updated_at is maintained", async () => {
    const { users } = fx();
    await t().db.query(`update public.platform_settings set updated_at = now() - interval '1 day'`);
    const result = await t().asUser(users.admin, (db) =>
      db.query(
        `update public.platform_settings
            set contact_email = 'hello@frekvencija.test',
                contact_phone = '+381 11 000 000',
                privacy_policy = $1,
                terms_of_service = 'Terms text',
                default_announcement_every_n_tracks = 6,
                updated_by = $2
          where id`,
        ["p".repeat(50_000), users.admin],
      ),
    );
    expect(result.affectedRows).toBe(1);
    const { rows } = await t().db.query(
      `select contact_email, contact_phone, char_length(privacy_policy) as privacy_length, terms_of_service,
              default_announcement_every_n_tracks, updated_by, updated_at = now() as touched
         from public.platform_settings`,
    );
    expect(rows).toEqual([
      {
        contact_email: "hello@frekvencija.test",
        contact_phone: "+381 11 000 000",
        privacy_length: 50_000,
        terms_of_service: "Terms text",
        default_announcement_every_n_tracks: 6,
        updated_by: users.admin,
        touched: true,
      },
    ]);
  });

  it("admins can clear optional settings back to null", async () => {
    const { users } = fx();
    await t().db.query(`update public.platform_settings set contact_email = 'x@test.local', privacy_policy = 'Text'`);
    await t().asUser(users.admin, (db) =>
      db.query(`update public.platform_settings set contact_email = null, privacy_policy = null where id`),
    );
    expect(await readSettings(t().db)).toEqual([DEFAULTS]);
  });

  it("rejects out-of-range values and a changed id", async () => {
    const { users } = fx();
    const invalid: [string, unknown][] = [
      ["default_announcement_every_n_tracks = $1", 0],
      ["default_announcement_every_n_tracks = $1", 51],
      ["contact_email = $1", "not-an-email"],
      ["contact_email = $1", `${"x".repeat(250)}@t.io`],
      ["contact_phone = $1", "1".repeat(41)],
      ["privacy_policy = $1", "p".repeat(50_001)],
      ["terms_of_service = $1", "t".repeat(50_001)],
      ["id = $1", false],
    ];
    for (const [assignment, value] of invalid) {
      await expect(
        t().asUser(users.admin, (db) => db.query(`update public.platform_settings set ${assignment} where id`, [value])),
        assignment,
      ).rejects.toMatchObject({ code: "23514" });
    }
    expect(await readSettings(t().db)).toEqual([DEFAULTS]);
  });

  it("updated_by is cleared when that admin's account is deleted", async () => {
    const admin = await createAdmin(t());
    await t().db.query(`update public.platform_settings set updated_by = $1`, [admin]);
    await t().db.query(`delete from auth.users where id = $1`, [admin]);
    const { rows } = await t().db.query(`select updated_by from public.platform_settings`);
    expect(rows).toEqual([{ updated_by: null }]);
  });
});
