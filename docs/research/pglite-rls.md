# Offline testing of Supabase migrations + RLS with PGlite (research notes)

Status: **VERIFIED by running code** on 2026-09-25 (Windows 11, Node 24.19.0, npm 11.17.0,
@electric-sql/pglite 0.5.8 = **PostgreSQL 18.3**, vitest 5.0.1, tsx 4.23.15).
Spike code (temporary): `C:\Users\PC\AppData\Local\Temp\claude\C--Users-PC-Desktop-Music-Radio\fc7faaf9-06fe-4439-bceb-4ec648d11d28\scratchpad\pglite-rls\`
(`spike1..5 *.mjs` scripts plus `vt\`, a passing vitest project with the exact files below).
Anything that was not executed is marked **UNVERIFIED**.

## Verdict

**Yes.** PGlite 0.5.8 runs in memory under Node 24 on Windows, and under vitest 5.0.1 with both `forks` (the default) and `threads`.
It enforces RLS for non-superuser roles exactly like Postgres. With the shim below
(roles + `auth` + `storage`), our migrations and policies can be tested offline:

| # | Check | Result |
|---|-------|--------|
| 1 | `new PGlite()` / `await PGlite.create()` in memory, multi-statement `db.exec()` | OK |
| 2 | `create role anon/authenticated/service_role (bypassrls)`, GRANTs, `SET ROLE`/`RESET ROLE`, `set_config('role', ..., true)` | OK |
| 2 | RLS denied SELECT returns 0 rows, denied INSERT throws `42501 new row violates row-level security policy for table "x"` | OK |
| 2 | Denied UPDATE/DELETE: no error, `affectedRows === 0`. UPDATE that moves a row out of the policy: WITH CHECK error | OK |
| 3 | `auth.uid()/role()/email()/jwt()` (exact supabase/auth definitions) read `request.jwt.claims` (`sub`) | OK |
| 3 | Switching users: `set_config('request.jwt.claims', json, true)` in a tx, `false` at session level, or `SET LOCAL request.jwt.claims = '...'` | OK (all three) |
| 4 | `storage.buckets/objects` incl. generated `path_tokens`, `storage.foldername/filename/extension` (current upstream bodies) | OK |
| 5 | `security definer` + `set search_path = ''` fns called from policies under `authenticated` | OK |
| 6 | `gen_random_uuid()` is core (no extension). `citext`, `pgcrypto`, `uuid-ossp`, `moddatetime`, `pg_trgm`, `unaccent` work **if passed via `extensions` option** | OK |
| 6 | plpgsql triggers (BEFORE UPDATE touch, AFTER INSERT on `auth.users` -> profiles) | OK |
| 7 | `using ((select auth.uid()) = user_id)`: works, EXPLAIN shows `InitPlan 1` (evaluated once) | OK |
| 8 | `npx vitest --version` -> `vitest/5.0.1 win32-x64 node-v24.19.0`; `npx tsx --eval "console.log(1)"` -> `1` | OK, **no fix needed** |

### (8) npm 11 allow-scripts / esbuild
vitest and tsx both run as installed. `esbuild` 0.28.2 works
(`require('esbuild').transformSync(...)` OK) because the native binary ships in the optional dependency
`@esbuild/win32-x64`. esbuild's `postinstall` is only an optimization, and on Windows `bin/esbuild` is a JS shim anyway.
vite 8.3.1 uses rolldown (`@rolldown/binding-win32-x64-msvc` is present). **Do not change package.json.**
If a script ever has to run, npm 11.17 supports `npm approve-scripts <pkg>` (writes a pinned `allowScripts` entry into
package.json; `--allow-scripts-pin=false` writes name-only). Follow it with `npm rebuild <pkg>`. I read this in npm's config
definitions but did **not** run it (UNVERIFIED: running `npm approve-scripts --allow-scripts-pending` was blocked in this session).

## Timings (measured, noisy Windows laptop)

| Operation | Time |
|---|---|
| `import('@electric-sql/pglite')` | ~280 ms |
| `PGlite.create()` cold (runs initdb in WASM) | 1.3-3.0 s |
| `PGlite.create({ extensions: {citext, pgcrypto, uuid_ossp} })` | 2.5-3.8 s |
| + shim + 1 migration (`db.exec`) | +0.1-0.5 s (full build 2.5-3.5 s) |
| `db.dumpDataDir('none')` / `('gzip')` | 81 ms, 39 MB tar / 760 ms, 4.6 MB |
| `PGlite.create({ loadDataDir: snapshot, extensions })` ('none' tar) | **360-410 ms** warm, 760-900 ms first in a new vitest worker (gzip tar: ~1.5 s) |
| Precompiled `pgliteWasmModule` option | no measurable gain once warm, **don't bother** |
| Per test `BEGIN` + createUser + 3 role switches (1 expected RLS error) + `ROLLBACK` | **~18 ms/test** |
| `vitest run`: globalSetup snapshot + 2 files / 7 tests | 3.5-4.5 s total |
| Memory | **~345 MB RSS per live PGlite instance** |

## Isolation strategy (recommended)

1. **globalSetup** (once per `vitest run`): `PGlite.create` + shim + all `supabase/migrations/*.sql`, then
   `dumpDataDir('none')`. Write the tar to a temp file and `project.provide('pgliteSnapshotPath', file)`.
   This also acts as the "do migrations apply cleanly" test.
2. **Per test file** (`beforeAll`): `PGlite.create({ loadDataDir: new Blob([readFileSync(inject('pgliteSnapshotPath'))]), extensions })`
   takes ~0.4-0.9 s.
3. **Per test**: `beforeEach` runs `BEGIN`, `afterEach` runs `ROLLBACK` (~ms). Role switching inside a test uses **SAVEPOINTs**, so an
   expected RLS error does not abort the per-test transaction.
4. Tests whose code under test itself runs `BEGIN/COMMIT` (or `db.transaction()`) cannot use step 3. Give them a
   fresh `createTestDb({ loadDataDir })` per test (~0.4 s).
5. Because of ~350 MB per instance, cap parallelism (e.g. `maxWorkers: 2`) if there are many DB test files. (The cap value is UNVERIFIED; it was not needed with 2 files.)

## Harness API

```ts
createTestDb(opts: { migrationsDir: string } | { loadDataDir: File | Blob }): Promise<TestDb>
interface TestDb {
  db: PGlite;                                    // superuser 'postgres' (bypasses RLS!)
  asUser<T>(userId, fn: (db) => Promise<T>, extraClaims?): Promise<T>;        // role authenticated, claims {sub, role, aud, ...}
  asStorageUser<T>(userId, fn, extraClaims?): Promise<T>;  // + storage.allow_delete_query=true (what Storage API sets)
  asAnon<T>(fn): Promise<T>;                     // role anon, claims {role:'anon'}
  asService<T>(fn): Promise<T>;                  // role service_role (BYPASSRLS)
  createUser({ id?, email?, userMetadata?, appMetadata? }?): Promise<string>;  // insert auth.users (fires signup triggers)
  begin(): Promise<void>; rollback(): Promise<void>;
  snapshot(): Promise<File | Blob>; close(): Promise<void>;
}
useTestDb(): () => TestDb   // vitest hooks: beforeAll restore snapshot, beforeEach BEGIN, afterEach ROLLBACK, afterAll close
```
`asX` mirrors what PostgREST and the Storage API do per request (verified in supabase/storage `src/internal/database/postgres/scope.ts`):
`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true), ...` inside a transaction.
Custom JWT claims for admin checks: `t().asUser(id, fn, { app_metadata: { role: 'admin' } })`, then in SQL
`(select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`.

Suggested layout: `supabase/migrations/<ts>_name.sql` (Supabase CLI convention), `test/db/supabase-shim.sql`,
`test/db/supabase-test-db.ts`, `test/db/use-test-db.ts`, `test/db/global-setup.ts`, `test/**/*.test.ts`, `vitest.config.mts`.
Add `"test": "vitest run"` to package.json scripts (the owner of package.json should do this).

## Shim SQL: `test/db/supabase-shim.sql` (verified, run once as superuser before migrations)

```sql
-- =====================================================================
-- Supabase compatibility shim for PGlite (PostgreSQL 18.3 / PGlite 0.5.8)
-- Mirrors: supabase/postgres init-scripts (roles), supabase/auth migrations
-- (auth.uid/role/email/jwt), supabase/storage tenant migrations (buckets,
-- objects, foldername/filename/extension, protect_delete trigger).
-- Run ONCE as the default PGlite superuser (postgres) BEFORE your migrations.
-- =====================================================================

-- ---------- roles (supabase/postgres 00000000000000-initial-schema.sql) ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit createrole;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to postgres, anon, authenticated, service_role;

-- NOTE: Supabase removed the automatic "grant all on new public tables to
-- anon/authenticated/service_role" default privileges (new projects since
-- 2026-05-30, all existing projects on 2026-10-30). We deliberately do NOT
-- add those default privileges, so tests fail with "permission denied for
-- table" if a migration forgets its explicit GRANTs -- exactly like prod.

create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

-- ---------- auth schema (supabase/postgres 00000000000001 + supabase/auth) ----------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
-- REQUIRED: FK checks (e.g. profiles.id -> auth.users.id) run as the OWNER of
-- auth.users; without schema usage they fail with "permission denied for schema auth".
grant all on schema auth to supabase_auth_admin;

create table if not exists auth.users (
  instance_id uuid null,
  id uuid not null primary key,
  aud varchar(255) null,
  role varchar(255) null,
  email varchar(255) null,
  encrypted_password varchar(255) null,
  email_confirmed_at timestamptz null,
  invited_at timestamptz null,
  confirmation_token varchar(255) null,
  confirmation_sent_at timestamptz null,
  recovery_token varchar(255) null,
  recovery_sent_at timestamptz null,
  email_change varchar(255) null,
  last_sign_in_at timestamptz null,
  raw_app_meta_data jsonb null default '{}'::jsonb,
  raw_user_meta_data jsonb null default '{}'::jsonb,
  is_super_admin bool null,
  created_at timestamptz null default now(),
  updated_at timestamptz null default now(),
  phone text null unique default null,
  phone_confirmed_at timestamptz null,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  banned_until timestamptz null,
  deleted_at timestamptz null,
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false
);
create unique index if not exists users_email_partial_key on auth.users (email) where (is_sso_user = false);
alter table auth.users enable row level security;
alter table auth.users owner to supabase_auth_admin;
-- anon/authenticated get NO privileges on auth.users (same as hosted Supabase).
grant all on auth.users to postgres, service_role;

-- supabase/auth 20220224000811_update_auth_functions.up.sql
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email()
returns text
language sql stable
as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

-- supabase/auth 20220531120530_add_auth_jwt_function.up.sql
create or replace function auth.jwt()
returns jsonb
language sql stable
as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

-- ---------- storage schema (supabase/storage migrations/tenant, as of 0073) ----------
create schema if not exists storage;
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on schema storage to supabase_storage_admin;

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'storage' and t.typname = 'buckettype') then
    create type storage.buckettype as enum ('STANDARD', 'ANALYTICS', 'VECTOR');
  end if;
end $$;

create table if not exists storage.buckets (
  id text not null primary key,
  name text not null,
  owner uuid,                       -- deprecated, use owner_id
  owner_id text default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint default null,        -- bytes
  allowed_mime_types text[] default null,
  type storage.buckettype not null default 'STANDARD'
);
create unique index if not exists bname on storage.buckets using btree (name);

create table if not exists storage.objects (
  id uuid not null default gen_random_uuid() primary key,
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,                       -- deprecated, use owner_id
  owner_id text default null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text default null,
  user_metadata jsonb null
);
create unique index if not exists objects_bucket_id_name_key on storage.objects (bucket_id, name collate "C");
create index if not exists name_prefix_search on storage.objects (name text_pattern_ops);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

-- 0046 + 0073: all DML to API roles (RLS decides), no truncate/references/trigger for anon/authenticated
grant all on storage.buckets, storage.objects to postgres, service_role;
grant select, insert, update, delete on storage.buckets, storage.objects to anon, authenticated;

-- 0060 / 0061 (current definitions, IMMUTABLE)
create or replace function storage.foldername(name text)
    returns text[]
    language plpgsql
    immutable
as $function$
declare
    _parts text[];
begin
    select string_to_array(name, '/') into _parts;
    return _parts[1 : array_length(_parts,1) - 1];
end
$function$;

create or replace function storage.filename(name text)
    returns text
    language plpgsql
    immutable
as $function$
declare
    _parts text[];
begin
    select string_to_array(name, '/') into _parts;
    return _parts[array_length(_parts, 1)];
end
$function$;

create or replace function storage.extension(name text)
    returns text
    language plpgsql
    immutable
as $function$
declare
    _parts text[];
    _filename text;
begin
    select string_to_array(name, '/') into _parts;
    select _parts[array_length(_parts, 1)] into _filename;
    return reverse(split_part(reverse(_filename), '.', 1));
end
$function$;

-- 0037: bucket name length
create or replace function storage.enforce_bucket_name_length()
returns trigger as $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$ language plpgsql;
drop trigger if exists enforce_bucket_name_length_trigger on storage.buckets;
create trigger enforce_bucket_name_length_trigger
before insert or update of name on storage.buckets
for each row execute function storage.enforce_bucket_name_length();

-- 0055: direct SQL DELETE on storage tables is blocked unless the Storage API
-- (which sets storage.allow_delete_query = 'true' per transaction) does it.
create or replace function storage.protect_delete()
returns trigger
language plpgsql
as $$
begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
        raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            using hint = 'This prevents accidental data loss from orphaned objects.',
                  errcode = '42501';
    end if;
    return null;
end;
$$;
drop trigger if exists protect_buckets_delete on storage.buckets;
create trigger protect_buckets_delete before delete on storage.buckets
    for each statement execute function storage.protect_delete();
drop trigger if exists protect_objects_delete on storage.objects;
create trigger protect_objects_delete before delete on storage.objects
    for each statement execute function storage.protect_delete();

alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
```

## Harness: `test/db/supabase-test-db.ts` (verified)

```ts
// Offline Supabase test DB: PGlite + Supabase shim (roles/auth/storage) + our migrations.
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Extensions our migrations may CREATE. Must be passed on EVERY PGlite.create (also when loading a snapshot). */
export const pgliteExtensions = { citext, pgcrypto, uuid_ossp };

const SHIM_SQL = readFileSync(join(import.meta.dirname, 'supabase-shim.sql'), 'utf8');

/** The subset of PGlite a test body needs. */
export type Queryable = Pick<PGlite, 'query' | 'exec' | 'sql'>;
export type Claims = Record<string, unknown>;

export interface TestDb {
  db: PGlite;
  /** Run fn as role `authenticated` with JWT claims {sub: userId, role: 'authenticated', ...}. */
  asUser<T>(userId: string, fn: (db: Queryable) => Promise<T>, extraClaims?: Claims): Promise<T>;
  /** Same as asUser but also sets storage.allow_delete_query=true (what the Storage API does). */
  asStorageUser<T>(userId: string, fn: (db: Queryable) => Promise<T>, extraClaims?: Claims): Promise<T>;
  asAnon<T>(fn: (db: Queryable) => Promise<T>): Promise<T>;
  /** role service_role (BYPASSRLS) - what supabase-js with the secret/service key does. */
  asService<T>(fn: (db: Queryable) => Promise<T>): Promise<T>;
  /** Insert into auth.users as superuser (fires on-signup triggers). Returns the id. */
  createUser(opts?: { id?: string; email?: string; userMetadata?: Claims; appMetadata?: Claims }): Promise<string>;
  /** Per-test isolation: call in beforeEach / afterEach. */
  begin(): Promise<void>;
  rollback(): Promise<void>;
  /** Tarball of the data dir, for loadDataDir. */
  snapshot(): Promise<File | Blob>;
  close(): Promise<void>;
}

export function readMigrations(dir: string): { name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort() // supabase/migrations/<timestamp>_name.sql sorts correctly as strings
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

export async function createTestDb(
  opts: { migrationsDir: string } | { loadDataDir: File | Blob },
): Promise<TestDb> {
  if ('loadDataDir' in opts) {
    const db = await PGlite.create({ extensions: pgliteExtensions, loadDataDir: opts.loadDataDir });
    return wrap(db);
  }
  const db = await PGlite.create({ extensions: pgliteExtensions });
  await db.exec(SHIM_SQL);
  for (const m of readMigrations(opts.migrationsDir)) {
    try {
      await db.exec(m.sql);
    } catch (e) {
      (e as Error).message = `[migration ${m.name}] ${(e as Error).message}`;
      throw e;
    }
  }
  return wrap(db);
}

function wrap(db: PGlite): TestDb {
  let seq = 0;

  // Mirrors PostgREST / Storage API: set_config('role', ..., true) + set_config('request.jwt.claims', ..., true)
  // inside a transaction. We use a SAVEPOINT so (a) it nests inside the per-test BEGIN and
  // (b) an expected error (RLS violation) does not abort the outer test transaction.
  async function runAs<T>(role: string, claims: Claims, fn: (db: Queryable) => Promise<T>, storageApi = false): Promise<T> {
    const ownTx = !db.isInTransaction();
    if (ownTx) await db.exec('begin');
    const sp = `as_${++seq}`;
    await db.exec(`savepoint ${sp}`);
    try {
      await db.query(
        `select set_config('role', $1, true),
                set_config('request.jwt.claims', $2, true),
                set_config('storage.allow_delete_query', $3, true)`,
        [role, JSON.stringify(claims), storageApi ? 'true' : 'false'],
      );
      const out = await fn(db);
      // SET LOCAL values survive RELEASE SAVEPOINT -> reset explicitly before releasing
      await db.exec(
        `reset role;
         select set_config('request.jwt.claims', '', true), set_config('storage.allow_delete_query', 'false', true);
         release savepoint ${sp};`,
      );
      if (ownTx) await db.exec('commit');
      return out;
    } catch (e) {
      await db.exec(`rollback to savepoint ${sp}; release savepoint ${sp};`);
      if (ownTx) await db.exec('rollback');
      throw e;
    }
  }

  const userClaims = (sub: string, extra: Claims = {}): Claims => ({
    sub,
    role: 'authenticated',
    aud: 'authenticated',
    aal: 'aal1',
    is_anonymous: false,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    ...extra,
  });

  return {
    db,
    asUser: (id, fn, extra) => runAs('authenticated', userClaims(id, extra), fn),
    asStorageUser: (id, fn, extra) => runAs('authenticated', userClaims(id, extra), fn, true),
    asAnon: (fn) => runAs('anon', { role: 'anon' }, fn),
    asService: (fn) => runAs('service_role', { role: 'service_role' }, fn, true),
    async createUser({ id = randomUUID(), email, userMetadata = {}, appMetadata = {} } = {}) {
      await db.query(
        `insert into auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
         values ($1, 'authenticated', 'authenticated', $2, $3, $4, now())`,
        [id, email ?? `${id}@test.local`, userMetadata, appMetadata],
      );
      return id;
    },
    begin: async () => {
      await db.exec('begin');
    },
    rollback: async () => {
      await db.exec('rollback');
    },
    snapshot: () => db.dumpDataDir('none'),
    close: () => db.close(),
  };
}
```

### `test/db/global-setup.ts` (verified)

```ts
// vitest globalSetup: build shim+migrations ONCE, dump the data dir to a temp tarball,
// and hand its path to every test file via provide/inject.
import type { TestProject } from 'vitest/node';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from './supabase-test-db';

declare module 'vitest' {
  export interface ProvidedContext {
    pgliteSnapshotPath: string;
  }
}

export default async function setup(project: TestProject) {
  const t = performance.now();
  const tdb = await createTestDb({ migrationsDir: join(import.meta.dirname, '../../supabase/migrations') });
  const blob = await tdb.snapshot();
  await tdb.close();
  const dir = mkdtempSync(join(tmpdir(), 'pglite-snap-'));
  const file = join(dir, 'snapshot.tar');
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  project.provide('pgliteSnapshotPath', file);
  console.log(`[global-setup] snapshot built in ${(performance.now() - t).toFixed(0)}ms -> ${file}`);
  return () => rmSync(dir, { recursive: true, force: true });
}
```

### `test/db/use-test-db.ts` (verified)

```ts
import { afterAll, afterEach, beforeAll, beforeEach, inject } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestDb, type TestDb } from './supabase-test-db';

/**
 * One PGlite per test FILE (restored from the globalSetup snapshot),
 * one BEGIN/ROLLBACK per TEST. Returns a getter because the db exists only after beforeAll.
 */
export function useTestDb(): () => TestDb {
  let tdb: TestDb | undefined;
  beforeAll(async () => {
    const t = performance.now();
    const tar = readFileSync(inject('pgliteSnapshotPath'));
    tdb = await createTestDb({ loadDataDir: new Blob([tar]) });
    console.log(`[use-test-db] restored snapshot in ${(performance.now() - t).toFixed(0)}ms`);
  });
  beforeEach(async () => {
    await tdb!.begin();
  });
  afterEach(async () => {
    await tdb!.rollback();
  });
  afterAll(async () => {
    await tdb?.close();
  });
  return () => tdb!;
}
```

### `vitest.config.mts` (project root)

Verified in scratch as a plain-object `.mjs` config, which needed extra `resolve.alias` entries only because the scratch dir has no
node_modules. In the project, drop the aliases and use `defineConfig` (standard; the `.mts` form in this repo is UNVERIFIED but low risk):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/db/global-setup.ts'],
    hookTimeout: 60_000, // PGlite cold start can take 3-4 s on this machine; CI may be slower
    testTimeout: 30_000,
    // maxWorkers: 2,    // each PGlite instance is ~350 MB RSS
  },
});
```
Both `pool: 'forks'` (default) and `--pool=threads` passed. `import.meta.dirname` works in globalSetup and in test modules.
Type-check: the harness, globalSetup (with `ProvidedContext` augmentation) and tests pass `tsc --strict` using
`moduleResolution: bundler`. The subpath `@electric-sql/pglite/contrib/*` resolves through package `exports` (types: `dist/contrib/*.d.ts`).

### Example test (verified, passing)

```ts
import { describe, expect, it } from 'vitest';
import { useTestDb } from './db/use-test-db';

describe('announcements RLS', () => {
  const t = useTestDb();

  it('owner sees only own rows; other user sees nothing', async () => {
    const alice = await t().createUser({ email: 'alice@x.test' });
    const bob = await t().createUser({ email: 'bob@x.test' });
    await t().asUser(alice, (db) => db.query(`insert into public.announcements (title) values ('Happy hour')`));
    const a = await t().asUser(alice, (db) => db.query<{ title: string }>(`select title from public.announcements`));
    const b = await t().asUser(bob, (db) => db.query(`select title from public.announcements`));
    expect(a.rows.map((r) => r.title)).toEqual(['Happy hour']);
    expect(b.rows).toHaveLength(0);
  });

  it('denied insert throws RLS error (42501)', async () => {
    const alice = await t().createUser();
    const bob = await t().createUser();
    await expect(
      t().asUser(alice, (db) => db.query(`insert into public.announcements (title, business_id) values ('x', $1)`, [bob])),
    ).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/row-level security/) });
    // outer per-test transaction still usable after the expected error
    const n = await t().db.query<{ n: number }>(`select count(*)::int n from public.announcements`);
    expect(n.rows[0].n).toBe(0);
  });

  it('isolation: previous tests left no rows', async () => {
    const r = await t().db.query<{ n: number }>(`select (select count(*) from auth.users)::int n`);
    expect(r.rows[0].n).toBe(0);
  });

  it('anon has no table privilege at all', async () => {
    await expect(t().asAnon((db) => db.query(`select * from public.announcements`))).rejects.toThrow(
      /permission denied for table announcements/,
    );
  });
});
```

### Migration patterns exercised

The migration used by these tests (verified) contains the patterns we will need: explicit GRANTs, RLS on every table,
`(select auth.uid())` policies, a `security definer set search_path = ''` `is_admin()` with `revoke execute ... from public, anon`,
a `handle_new_user` AFTER INSERT trigger on `auth.users`, a bucket row inserted into `storage.buckets`, and folder-scoped
storage policies:

```sql
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = (select auth.uid())), false)
$$;
revoke execute on function public.is_admin() from public, anon;   -- anon then gets "permission denied for function is_admin"
grant execute on function public.is_admin() to authenticated, service_role;

create policy "own announcements insert" on public.announcements
  for insert to authenticated with check ((select auth.uid()) = business_id);
create policy "genres writable by admins" on public.genres
  for insert to authenticated with check ((select public.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcements', 'announcements', false, 10485760, array['audio/mpeg']);

create policy "announcement audio: owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'announcements' and (storage.foldername(name))[1] = (select auth.uid())::text);
```
Simulated upload (what the Storage API writes: `owner` = sub as uuid, `owner_id` = sub as text, per supabase/storage `src/storage/database/pg.ts`):
```ts
await t().asStorageUser(uid, (db) => db.query(
  `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
   values ('announcements', $1, $2::uuid, $2::text, '{"size":1,"mimetype":"audio/mpeg"}')`, [`${uid}/a.mp3`, uid]));
```

## Gotchas (all verified unless marked)

1. **The superuser bypasses RLS**, even with `FORCE ROW LEVEL SECURITY` (verified). `t().db.query(...)` sees everything.
   Every RLS assertion must go through `asUser/asAnon`.
2. **GRANTs are checked before RLS.** A missing grant gives `permission denied for table x` (42501), **not** 0 rows.
   Supabase **stopped auto-granting new `public` tables** to anon/authenticated/service_role (default for new projects from
   2026-05-30, applied to all existing projects 2026-10-30; sequences and functions are affected too; `storage`/`auth` are not).
   So **every migration must `grant ... to authenticated/anon/service_role` explicitly**. The shim deliberately has no default
   privileges on `public`, so a missing grant fails in tests the same way it fails in production.
3. Denied SELECT/UPDATE/DELETE fail **silently** (0 rows, `affectedRows: 0`). Denied INSERT, and an UPDATE whose new row
   fails WITH CHECK, throw `42501` "new row violates row-level security policy for table ...". Assert on `affectedRows`.
4. **FK checks run as the owner of the referenced table.** `profiles.id references auth.users` failed with
   `permission denied for schema auth` until the shim added `grant all on schema auth to supabase_auth_admin` (the owner of auth.users).
5. `set_config(..., true)` / `SET LOCAL` values **survive `RELEASE SAVEPOINT`**, so the harness resets role and claims before releasing.
   After a GUC has been set once in a session, `current_setting('request.jwt.claims', true)` returns `''`, not NULL, and
   `current_setting(...)::jsonb` then throws `invalid input syntax for type json`. Always use `nullif(..., '')`, as `auth.*` does,
   or better, just call `auth.uid()` / `auth.jwt()`.
6. **`db.transaction()` inside a manual `BEGIN` silently COMMITS the outer transaction** (verified: rows survived the outer
   ROLLBACK, and `isInTransaction()` was false afterwards). With the BEGIN/ROLLBACK-per-test strategy, never call
   `db.transaction()` or raw `BEGIN/COMMIT` in test bodies. Use a fresh snapshot per test instead.
7. After an error inside a manual transaction, every later statement fails with `current transaction is aborted...`. `asX` wraps
   calls in savepoints. If you expect an error from a raw `t().db.query`, wrap it in your own `savepoint` / `rollback to savepoint`.
8. Extended-protocol parameter typing: using the same `$2` for a uuid column and a text column gives
   `inconsistent types deduced for parameter $2` (42P08). Cast it: `$2::uuid, $2::text`. Plain JS objects passed for `jsonb`
   params are JSON-serialized automatically.
9. `db.exec(multiStatementSql)` runs as **one implicit transaction**: a failing statement rolls back the whole file (good for migrations).
   `CREATE INDEX CONCURRENTLY` fails inside a multi-statement exec ("cannot run inside a transaction block") but works when it is
   the only statement. Explicit `begin; ...; commit;` inside a file works. (UNVERIFIED: whether the Supabase CLI also wraps each file in a transaction.)
10. **Extensions:** `create extension` works only for contrib modules passed in `PGlite.create({ extensions: {...} })`.
    Otherwise it fails with `extension "moddatetime" is not available`. Pass them **again when restoring a snapshot**.
    Import from `@electric-sql/pglite/contrib/<name>` (named export equal to the file name, e.g. `uuid_ossp`, `pg_trgm`, `moddatetime`).
    Contribs available in 0.5.8: amcheck, auto_explain, bloom, btree_gin, btree_gist, citext, cube, dict_int, dict_xsyn,
    earthdistance, file_fdw, fuzzystrmatch, hstore, intarray, isn, lo, ltree, moddatetime, pageinspect, pg_buffercache,
    pg_freespacemap, pg_stat_statements, pg_surgery, pg_trgm, pg_visibility, pg_walinspect, pgcrypto, seg, tablefunc, tcn,
    tsm_system_rows, tsm_system_time, unaccent, uuid_ossp. **Not available:** pg_net, pg_cron, pg_graphql, pgjwt, supabase_vault,
    pgsodium, http, postgis, and pgvector (not in 0.5.8's exports). Keep those out of RLS-tested migrations, or guard them.
    Supabase installs extensions in schema `extensions`, so write `create extension if not exists x with schema extensions` and
    qualify the calls (`extensions.digest(...)`).
11. **Version skew:** PGlite is **PostgreSQL 18.3**. Hosted Supabase was still on 15/17 as of mid-2026, with PG18 "eventually in 2026"
    according to a Supabase maintainer on 2026-05-04 (UNVERIFIED for today; check with `select version()` in the SQL editor).
    PG18-only features such as `uuidv7()` and `virtual` generated columns **pass locally but would fail in production.** Use `gen_random_uuid()`.
12. **The PGlite superuser can do things the hosted `postgres` role cannot:** e.g. `alter table storage.objects enable row level security`
    fails on Supabase with `must be owner of table objects` (RLS is already enabled there). `create policy ... on storage.objects` is allowed.
    Never `ALTER` storage/auth tables in migrations. Tests will not catch this.
13. **Direct `DELETE` on storage.objects/buckets is blocked** by upstream trigger `storage.protect_delete()` (migration 0055) unless
    `storage.allow_delete_query = 'true'`, which only the Storage API sets. SQL functions or cron jobs that "clean up" storage rows
    will fail in production. Delete files from server code via `supabase.storage.from(b).remove([...])`. The shim reproduces
    this, and `asStorageUser`/`asService` set the flag.
14. `set search_path = ''`: unqualified *tables* fail (`relation "profiles" does not exist`), but `pg_catalog` functions
    (`gen_random_uuid()`, `now()`) still resolve. Extension functions and `auth.*` / `public.*` objects must be schema-qualified.
    A `security definer` function owned by `postgres` bypasses RLS in PGlite (superuser). UNVERIFIED for hosted: `postgres`
    there is not a true superuser but has BYPASSRLS; check with `select rolbypassrls from pg_roles where rolname='postgres'`.
15. `authenticated` has **no privileges on `auth.users`** (same as hosted). Policies must not `select from auth.users`; use
    `public.profiles` (filled by the signup trigger) or a `security definer` helper.
16. The shim's `auth.users` is a **subset** of GoTrue's table (it has id, email, phone, raw_*_meta_data, confirmed_at generated, is_anonymous, ...).
    That is enough for FKs and triggers, but it does not replace testing GoTrue. `storage.*` is also a subset: no search/list functions,
    prefixes, versioning, or S3 multipart tables.
17. This tests **SQL and RLS only**. supabase-js calls (PostgREST/Storage/GoTrue over HTTP) are not exercised. Server code that uses
    supabase-js still needs mocks or a real project.
18. tsx: the project has no `"type": "module"`, so a `.ts` script with top-level await fails under tsx
    (`Top-level await is currently not supported with the "cjs" output format`). Name scripts `.mts` (verified working with PGlite)
    or wrap them in `async function main()`. Vitest has no such problem.
19. ~345 MB RSS per PGlite instance. Always `close()` in `afterAll`.

## Sources
- supabase/storage `migrations/tenant/*` (0002 schema, 0003 path_tokens, 0013/0014 limits, 0018 owner_id, 0046/0073 grants,
  0055 protect_delete, 0060/0061 foldername/filename/extension) and `src/internal/database/postgres/scope.ts`, `src/storage/database/pg.ts`
- supabase/auth `migrations/20220224000811_update_auth_functions.up.sql`, `20220531120530_add_auth_jwt_function.up.sql`
- supabase/postgres `migrations/db/init-scripts/00000000000000-initial-schema.sql` (roles and grants)
- Supabase changelog/discussion #45329, "Tables not exposed to Data and GraphQL API automatically": https://github.com/orgs/supabase/discussions/45329
- "must be owner of table objects": https://github.com/supabase/supabase/issues/36418
- PG18 on Supabase: https://github.com/orgs/supabase/discussions/42681
