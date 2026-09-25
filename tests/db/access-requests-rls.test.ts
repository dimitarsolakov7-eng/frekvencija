// access_requests + businesses.business_type (20260926000100_frekvencija.sql).
// Requests are inserted only with the secret key (service role) by the public
// server action; admins triage them; nobody else can see or write them.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Tables, TablesInsert } from "@/types/database";
import { createAdmin, insertRow, seedScenario } from "./fixtures";
import type { Queryable } from "./supabase-test-db";
import { setupTestDb } from "./setup-test-db";

const t = setupTestDb(seedScenario);
const fx = () => t.fixtures();

const permissionDenied = { code: "42501", message: expect.stringMatching(/permission denied for table access_requests/) };
const duplicateOpenRequest = {
  code: "23505",
  message: expect.stringMatching(/access_requests_open_email_key/),
};

function request(overrides: Partial<TablesInsert<"access_requests">> = {}): TablesInsert<"access_requests"> {
  return {
    business_name: "Cafe Nova",
    business_type: "cafe",
    contact_name: "Nova Owner",
    email: `owner-${randomUUID()}@test.local`,
    ...overrides,
  };
}

/** What the public server action does with the secret-key client. */
function submit(overrides: Partial<TablesInsert<"access_requests">> = {}): Promise<Tables<"access_requests">> {
  return t().asService((db) => insertRow(db, "access_requests", request(overrides)));
}

const requestIds = async (db: Queryable) =>
  (await db.query<{ id: string }>(`select id from public.access_requests`)).rows.map((row) => row.id).sort();

describe("access_requests: submission", () => {
  it("the service role (secret key) inserts a request that starts as 'new' and unhandled", async () => {
    const row = await submit({ phone: "+381 11 123 4567", message: "We would love a station for our terrace." });
    expect(row).toMatchObject({
      business_name: "Cafe Nova",
      business_type: "cafe",
      contact_name: "Nova Owner",
      phone: "+381 11 123 4567",
      message: "We would love a station for our terrace.",
      status: "new",
      admin_notes: null,
      handled_by: null,
      handled_at: null,
    });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("phone and message are optional", async () => {
    const row = await submit();
    expect(row).toMatchObject({ phone: null, message: null });
  });

  it("anon can neither insert nor read requests", async () => {
    await expect(t().asAnon((db) => insertRow(db, "access_requests", request()))).rejects.toMatchObject(permissionDenied);
    await expect(t().asAnon((db) => db.query(`select * from public.access_requests`))).rejects.toMatchObject(
      permissionDenied,
    );
  });

  it("signed-in users — business members and admins alike — cannot insert (no privilege)", async () => {
    const { users } = fx();
    for (const userId of [users.a, users.c, users.none, users.admin]) {
      await expect(t().asUser(userId, (db) => insertRow(db, "access_requests", request()))).rejects.toMatchObject(
        permissionDenied,
      );
    }
  });

  it("allows only one open request per email, case-insensitively", async () => {
    await submit({ email: "Owner@Cafe-Nova.test" });
    await expect(submit({ email: "owner@cafe-nova.test" })).rejects.toMatchObject(duplicateOpenRequest);
    await expect(submit({ email: "OWNER@CAFE-NOVA.TEST", business_name: "Another venue" })).rejects.toMatchObject(
      duplicateOpenRequest,
    );
    // A different email is unaffected.
    await submit({ email: "manager@cafe-nova.test" });
  });

  it("a 'contacted' request is still open; an approved or declined one frees the email", async () => {
    const first = await submit({ email: "owner@hotel.test" });
    await t().db.query(`update public.access_requests set status = 'contacted' where id = $1`, [first.id]);
    await expect(submit({ email: "owner@hotel.test" })).rejects.toMatchObject(duplicateOpenRequest);

    await t().db.query(`update public.access_requests set status = 'declined' where id = $1`, [first.id]);
    const second = await submit({ email: "owner@hotel.test" });
    await t().db.query(`update public.access_requests set status = 'approved' where id = $1`, [second.id]);
    const third = await submit({ email: "Owner@Hotel.test" });
    expect(third.status).toBe("new");

    // Re-opening an old request while another one is open is refused too.
    await expect(
      t().asService((db) => db.query(`update public.access_requests set status = 'new' where id = $1`, [first.id])),
    ).rejects.toMatchObject(duplicateOpenRequest);
  });

  it("enforces lengths, the email format and the enums", async () => {
    const invalid: [Partial<TablesInsert<"access_requests">>, string][] = [
      [{ business_name: "   " }, "23514"],
      [{ business_name: "x".repeat(121) }, "23514"],
      [{ contact_name: "" }, "23514"],
      [{ contact_name: "x".repeat(121) }, "23514"],
      [{ email: "not-an-email" }, "23514"],
      [{ email: "with space@test.local" }, "23514"],
      [{ email: `${"x".repeat(250)}@t.io` }, "23514"],
      [{ phone: "1".repeat(41) }, "23514"],
      [{ message: "x".repeat(1001) }, "23514"],
      [{ admin_notes: "x".repeat(2001) }, "23514"],
      [{ business_type: "pub" as never }, "22P02"],
      [{ status: "archived" as never }, "22P02"],
    ];
    for (const [overrides, code] of invalid) {
      await expect(submit(overrides), JSON.stringify(overrides).slice(0, 60)).rejects.toMatchObject({ code });
    }
    await expect(
      t().asService((db) =>
        db.query(
          `insert into public.access_requests (business_name, contact_name, email) values ('Cafe', 'Owner', 'o@test.local')`,
        ),
      ),
    ).rejects.toMatchObject({ code: "23502" });

    // Boundaries are accepted.
    const row = await submit({
      business_name: "x".repeat(120),
      contact_name: "y".repeat(120),
      phone: "1".repeat(40),
      message: "m".repeat(1000),
      admin_notes: "n".repeat(2000),
      business_type: "other",
    });
    expect(row.business_name).toHaveLength(120);
  });
});

describe("access_requests: visibility and triage", () => {
  it("business users and users without a business see none and change none", async () => {
    const { users } = fx();
    const existing = await submit();
    for (const userId of [users.a, users.c, users.none]) {
      await t().asUser(userId, async (db) => {
        expect(await requestIds(db)).toEqual([]);
        const update = await db.query(`update public.access_requests set status = 'approved' where id = $1`, [existing.id]);
        expect(update.affectedRows).toBe(0);
        const remove = await db.query(`delete from public.access_requests where id = $1`, [existing.id]);
        expect(remove.affectedRows).toBe(0);
      });
    }
    const { rows } = await t().db.query(`select status from public.access_requests where id = $1`, [existing.id]);
    expect(rows).toEqual([{ status: "new" }]);
  });

  it("admins read every request, newest first", async () => {
    const { users } = fx();
    const older = await submit();
    const newer = await submit();
    await t().db.query(`update public.access_requests set created_at = now() - interval '2 days' where id = $1`, [older.id]);
    const { rows } = await t().asUser(users.admin, (db) =>
      db.query<{ id: string }>(`select id from public.access_requests order by created_at desc`),
    );
    expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
  });

  it("admins update status, notes and handler; updated_at is maintained", async () => {
    const { users } = fx();
    const existing = await submit();
    await t().db.query(`update public.access_requests set updated_at = now() - interval '1 day' where id = $1`, [existing.id]);
    const result = await t().asUser(users.admin, (db) =>
      db.query(
        `update public.access_requests
            set status = 'contacted', admin_notes = 'Called on Monday.', handled_by = $2, handled_at = now()
          where id = $1`,
        [existing.id, users.admin],
      ),
    );
    expect(result.affectedRows).toBe(1);
    const { rows } = await t().db.query(
      `select status, admin_notes, handled_by, handled_at = now() as handled_now, updated_at = now() as touched
         from public.access_requests where id = $1`,
      [existing.id],
    );
    expect(rows).toEqual([
      { status: "contacted", admin_notes: "Called on Monday.", handled_by: users.admin, handled_now: true, touched: true },
    ]);
  });

  it("admins can delete a request", async () => {
    const { users } = fx();
    const existing = await submit();
    const result = await t().asUser(users.admin, (db) =>
      db.query(`delete from public.access_requests where id = $1`, [existing.id]),
    );
    expect(result.affectedRows).toBe(1);
  });

  it("handled_by is cleared when the handling admin's account is deleted", async () => {
    const admin = await createAdmin(t());
    const existing = await submit({ status: "approved", handled_by: admin, handled_at: new Date().toISOString() });
    await t().db.query(`delete from auth.users where id = $1`, [admin]);
    const { rows } = await t().db.query(`select handled_by, status from public.access_requests where id = $1`, [existing.id]);
    expect(rows).toEqual([{ handled_by: null, status: "approved" }]);
  });
});

describe("businesses.business_type", () => {
  const typeOf = async (businessId: string) =>
    (await t().db.query<{ business_type: string }>(`select business_type from public.businesses where id = $1`, [businessId]))
      .rows[0].business_type;

  it("defaults to 'other' (existing and new businesses)", async () => {
    const { users, businesses } = fx();
    expect(await typeOf(businesses.a)).toBe("other");
    const created = await t().asUser(users.admin, (db) =>
      db.query<{ business_type: string }>(
        `insert into public.businesses (name, station_name) values ('Cafe Nova', 'Nova Radio') returning business_type`,
      ),
    );
    expect(created.rows).toEqual([{ business_type: "other" }]);
  });

  it("accepts every enum value and rejects anything else", async () => {
    const { users, businesses } = fx();
    for (const value of ["cafe", "restaurant", "hotel", "bar", "other"]) {
      await t().asUser(users.admin, (db) =>
        db.query(`update public.businesses set business_type = $2 where id = $1`, [businesses.b, value]),
      );
      expect(await typeOf(businesses.b)).toBe(value);
    }
    for (const value of ["pub", "Hotel", ""]) {
      await expect(
        t().asUser(users.admin, (db) =>
          db.query(`update public.businesses set business_type = $2 where id = $1`, [businesses.b, value]),
        ),
      ).rejects.toMatchObject({ code: "22P02" });
    }
    await expect(
      t().asUser(users.admin, (db) => db.query(`update public.businesses set business_type = null where id = $1`, [businesses.b])),
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("members read their venue's type but cannot change it", async () => {
    const { users, businesses } = fx();
    await t().db.query(`update public.businesses set business_type = 'bar' where id = $1`, [businesses.a]);
    await t().asUser(users.a, async (db) => {
      const { rows } = await db.query(`select business_type from public.businesses`);
      expect(rows).toEqual([{ business_type: "bar" }]);
      const update = await db.query(`update public.businesses set business_type = 'hotel' where id = $1`, [businesses.a]);
      expect(update.affectedRows).toBe(0);
    });
    expect(await typeOf(businesses.a)).toBe("bar");
  });

  it("changing the type is not a branding change (no re-review of announcements)", async () => {
    const { users, businesses } = fx();
    await t().asUser(users.admin, (db) =>
      db.query(`update public.businesses set business_type = 'hotel' where id = $1`, [businesses.a]),
    );
    const { rows } = await t().db.query(
      `select b.branding_version,
              (select count(*)::int from public.announcements a where a.business_id = b.id and a.needs_review) as flagged
         from public.businesses b where b.id = $1`,
      [businesses.a],
    );
    // The scenario seeds exactly one needs_review announcement for A.
    expect(rows).toEqual([{ branding_version: 2, flagged: 1 }]);
  });
});
