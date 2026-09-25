// Offline Supabase test database: PGlite + Supabase shim (roles, auth, storage)
// + the real migrations from supabase/migrations. See docs/research/pglite-rls.md.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const MIGRATIONS_DIR = join(import.meta.dirname, "../../supabase/migrations");

const SHIM_SQL = readFileSync(join(import.meta.dirname, "supabase-shim.sql"), "utf8");

/** The subset of PGlite a test body needs. */
export type Queryable = Pick<PGlite, "query" | "exec">;
export type Claims = Record<string, unknown>;

export interface CreateUserOptions {
  id?: string;
  email?: string;
  userMetadata?: Claims;
  appMetadata?: Claims;
}

export interface TestDb {
  /** Superuser connection: bypasses RLS and grants. Use only for arranging data. */
  readonly db: PGlite;
  /** Run fn as role `authenticated` with the JWT claims PostgREST would set for userId. */
  asUser<T>(userId: string, fn: (db: Queryable) => Promise<T>, extraClaims?: Claims): Promise<T>;
  /** Like asUser, plus storage.allow_delete_query=true (what the Storage API sets per request). */
  asStorageUser<T>(userId: string, fn: (db: Queryable) => Promise<T>, extraClaims?: Claims): Promise<T>;
  /** Run fn as role `anon` (publishable key without a session). */
  asAnon<T>(fn: (db: Queryable) => Promise<T>): Promise<T>;
  /** Run fn as role `service_role` (secret key; BYPASSRLS but still subject to grants). */
  asService<T>(fn: (db: Queryable) => Promise<T>): Promise<T>;
  /** Insert into auth.users as the superuser (fires the signup triggers). Returns the id. */
  createUser(options?: CreateUserOptions): Promise<string>;
  begin(): Promise<void>;
  rollback(): Promise<void>;
  /** Uncompressed tarball of the data directory, for `loadDataDir`. */
  snapshot(): Promise<File | Blob>;
  close(): Promise<void>;
}

export interface Migration {
  name: string;
  sql: string;
}

/** Migration files in the order the Supabase CLI applies them (timestamp prefix). */
export function readMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

/**
 * Either builds a fresh database (shim + every migration, in order) or restores
 * one from a snapshot produced by `snapshot()`.
 */
export async function createTestDb(
  options: { migrationsDir: string } | { loadDataDir: File | Blob },
): Promise<TestDb> {
  if ("loadDataDir" in options) {
    return wrap(await PGlite.create({ loadDataDir: options.loadDataDir }));
  }

  const db = await PGlite.create();
  try {
    await db.exec(SHIM_SQL);
    for (const migration of readMigrations(options.migrationsDir)) {
      try {
        await db.exec(migration.sql);
      } catch (error) {
        throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`, { cause: error });
      }
    }
  } catch (error) {
    await db.close();
    throw error;
  }
  return wrap(db);
}

function wrap(db: PGlite): TestDb {
  let savepointSeq = 0;

  // Mirrors PostgREST / Storage API: set_config('role', …, true) and
  // set_config('request.jwt.claims', …, true) inside a transaction. A SAVEPOINT
  // nests inside the per-test BEGIN and lets an expected error (e.g. an RLS
  // violation) be asserted without aborting the outer test transaction.
  async function runAs<T>(
    role: "authenticated" | "anon" | "service_role",
    claims: Claims,
    fn: (db: Queryable) => Promise<T>,
    storageApi: boolean,
  ): Promise<T> {
    const ownTransaction = !db.isInTransaction();
    if (ownTransaction) await db.exec("begin");
    const savepoint = `as_${++savepointSeq}`;
    await db.exec(`savepoint ${savepoint}`);
    try {
      await db.query(
        `select set_config('role', $1, true),
                set_config('request.jwt.claims', $2, true),
                set_config('storage.allow_delete_query', $3, true)`,
        [role, JSON.stringify(claims), storageApi ? "true" : "false"],
      );
      const result = await fn(db);
      // SET LOCAL values survive RELEASE SAVEPOINT, so reset them explicitly first.
      await db.exec(
        `reset role;
         select set_config('request.jwt.claims', '', true),
                set_config('storage.allow_delete_query', 'false', true);
         release savepoint ${savepoint};`,
      );
      if (ownTransaction) await db.exec("commit");
      return result;
    } catch (error) {
      await db.exec(`rollback to savepoint ${savepoint}; release savepoint ${savepoint};`);
      if (ownTransaction) await db.exec("rollback");
      throw error;
    }
  }

  const userClaims = (sub: string, extra: Claims = {}): Claims => ({
    sub,
    role: "authenticated",
    aud: "authenticated",
    aal: "aal1",
    is_anonymous: false,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    ...extra,
  });

  return {
    db,
    asUser: (userId, fn, extra) => runAs("authenticated", userClaims(userId, extra), fn, false),
    asStorageUser: (userId, fn, extra) => runAs("authenticated", userClaims(userId, extra), fn, true),
    asAnon: (fn) => runAs("anon", { role: "anon" }, fn, false),
    asService: (fn) => runAs("service_role", { role: "service_role" }, fn, true),
    async createUser({ id = randomUUID(), email, userMetadata = {}, appMetadata = {} } = {}) {
      await db.query(
        `insert into auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
         values ($1, 'authenticated', 'authenticated', $2, $3, $4, now())`,
        [id, email ?? `${id}@test.local`, userMetadata, appMetadata],
      );
      return id;
    },
    begin: async () => {
      await db.exec("begin");
    },
    rollback: async () => {
      await db.exec("rollback");
    },
    snapshot: () => db.dumpDataDir("none"),
    close: () => db.close(),
  };
}
