import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAdmin } from "./fixtures";
import { setupTestDb } from "./setup-test-db";

const t = setupTestDb();

async function roleOf(id: string): Promise<string> {
  const { rows } = await t().db.query<{ role: string }>(`select role from public.profiles where id = $1`, [id]);
  return rows[0].role;
}

describe("auth.users → profiles triggers", () => {
  it("creates a business_user profile with the email on signup", async () => {
    const id = await t().createUser({ email: "new@test.local" });
    const { rows } = await t().db.query(`select email, role, full_name from public.profiles where id = $1`, [id]);
    expect(rows).toEqual([{ email: "new@test.local", role: "business_user", full_name: null }]);
  });

  it("ignores a role smuggled in user metadata (and app metadata)", async () => {
    const id = await t().createUser({
      userMetadata: { role: "platform_admin" },
      appMetadata: { role: "platform_admin" },
    });
    expect(await roleOf(id)).toBe("business_user");
  });

  it("does not block users without an email (phone sign-ups)", async () => {
    const id = randomUUID();
    await t().db.query(`insert into auth.users (id, aud, role, phone) values ($1, 'authenticated', 'authenticated', '+10000000000')`, [id]);
    const { rows } = await t().db.query(`select email from public.profiles where id = $1`, [id]);
    expect(rows).toEqual([{ email: "" }]);
  });

  it("syncs profiles.email when the auth email changes", async () => {
    const id = await t().createUser({ email: "old@test.local" });
    await t().db.query(`update auth.users set email = 'changed@test.local' where id = $1`, [id]);
    const { rows } = await t().db.query(`select email from public.profiles where id = $1`, [id]);
    expect(rows).toEqual([{ email: "changed@test.local" }]);
  });

  it("deletes the profile when the auth user is deleted", async () => {
    const id = await t().createUser();
    await t().db.query(`delete from auth.users where id = $1`, [id]);
    const { rows } = await t().db.query(`select 1 from public.profiles where id = $1`, [id]);
    expect(rows).toEqual([]);
  });
});

describe("profiles RLS and privileges", () => {
  it("anon cannot read profiles at all", async () => {
    await expect(t().asAnon((db) => db.query(`select * from public.profiles`))).rejects.toMatchObject({
      code: "42501",
      message: expect.stringMatching(/permission denied for table profiles/),
    });
  });

  it("a user reads only their own profile; an admin reads all", async () => {
    const alice = await t().createUser();
    const bob = await t().createUser();
    const admin = await createAdmin(t());

    const seenByAlice = await t().asUser(alice, (db) => db.query<{ id: string }>(`select id from public.profiles`));
    expect(seenByAlice.rows.map((row) => row.id)).toEqual([alice]);

    const seenByAdmin = await t().asUser(admin, (db) =>
      db.query<{ id: string }>(`select id from public.profiles where id = any($1::uuid[])`, [[alice, bob, admin]]),
    );
    expect(seenByAdmin.rows.map((row) => row.id).sort()).toEqual([alice, bob, admin].sort());
  });

  it("a user can update their own full_name", async () => {
    const alice = await t().createUser();
    const result = await t().asUser(alice, (db) =>
      db.query(`update public.profiles set full_name = 'Alice Example' where id = $1`, [alice]),
    );
    expect(result.affectedRows).toBe(1);
    const { rows } = await t().db.query(`select full_name from public.profiles where id = $1`, [alice]);
    expect(rows).toEqual([{ full_name: "Alice Example" }]);
  });

  it("a user cannot update someone else's full_name (not even an admin's)", async () => {
    const alice = await t().createUser();
    const bob = await t().createUser();
    const result = await t().asUser(alice, (db) =>
      db.query(`update public.profiles set full_name = 'hijacked' where id = $1`, [bob]),
    );
    expect(result.affectedRows).toBe(0);
  });

  it("the full_name length check still applies", async () => {
    const alice = await t().createUser();
    await expect(
      t().asUser(alice, (db) => db.query(`update public.profiles set full_name = repeat('x', 121) where id = $1`, [alice])),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("a user cannot change their own role (column privilege)", async () => {
    const alice = await t().createUser();
    await expect(
      t().asUser(alice, (db) => db.query(`update public.profiles set role = 'platform_admin' where id = $1`, [alice])),
    ).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table profiles/) });
    expect(await roleOf(alice)).toBe("business_user");
  });

  it("a user cannot change their email or id, insert or delete profiles", async () => {
    const alice = await t().createUser();
    const denied = { code: "42501", message: expect.stringMatching(/permission denied/) };
    await expect(
      t().asUser(alice, (db) => db.query(`update public.profiles set email = 'x@test.local' where id = $1`, [alice])),
    ).rejects.toMatchObject(denied);
    await expect(
      t().asUser(alice, (db) =>
        db.query(`insert into public.profiles (id, email) values ($1, 'y@test.local')`, [randomUUID()]),
      ),
    ).rejects.toMatchObject(denied);
    await expect(
      t().asUser(alice, (db) => db.query(`delete from public.profiles where id = $1`, [alice])),
    ).rejects.toMatchObject(denied);
  });

  it("the guard trigger blocks a role change even if a column grant is added by mistake", async () => {
    const alice = await t().createUser();
    // Simulate a future migration accidentally granting the column (rolled back after the test).
    await t().db.exec(`grant update (role) on public.profiles to authenticated`);
    await expect(
      t().asUser(alice, (db) => db.query(`update public.profiles set role = 'platform_admin' where id = $1`, [alice])),
    ).rejects.toMatchObject({ code: "42501", message: "Changing a profile role is not allowed" });
    expect(await roleOf(alice)).toBe("business_user");
  });

  it("an admin cannot promote users through the Data API either", async () => {
    const admin = await createAdmin(t());
    const alice = await t().createUser();
    await expect(
      t().asUser(admin, (db) => db.query(`update public.profiles set role = 'platform_admin' where id = $1`, [alice])),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await roleOf(alice)).toBe("business_user");
  });

  it("the service role (secret key) and SQL editor can change roles", async () => {
    const alice = await t().createUser();
    const bob = await t().createUser();
    const result = await t().asService((db) =>
      db.query(`update public.profiles set role = 'platform_admin' where id = $1`, [alice]),
    );
    expect(result.affectedRows).toBe(1);
    expect(await roleOf(alice)).toBe("platform_admin");

    await t().db.query(`update public.profiles set role = 'platform_admin' where id = $1`, [bob]);
    expect(await roleOf(bob)).toBe("platform_admin");
  });
});
