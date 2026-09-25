// Keeps src/types/database.ts and the migrations in lock-step, and checks the
// schema-wide security invariants (RLS everywhere, explicit grants, no anon access).
//
// The contract literals below are type-checked against `Database` (tsc fails if a
// column, its nullability, its insert optionality or its enum drifts), and the
// test compares the same literals with the migrated catalog at runtime.
import { describe, expect, it } from "vitest";
import type { Database } from "@/types/database";
import { setupTestDb } from "./setup-test-db";
import { readMigrations } from "./supabase-test-db";

type PublicSchema = Database["public"];
type TableDefs = PublicSchema["Tables"];
type EnumDefs = PublicSchema["Enums"];
type FunctionDefs = PublicSchema["Functions"];

type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
type EnumName<V> = { [E in keyof EnumDefs]: Equals<V, EnumDefs[E]> extends true ? E : never }[keyof EnumDefs];
type Kind<V> = [EnumName<V>] extends [never]
  ? [V] extends [string]
    ? "string"
    : [V] extends [number]
      ? "number"
      : [V] extends [boolean]
        ? "boolean"
        : "json"
  : `enum:${EnumName<V> & string}`;
/** e.g. "string | null?" = text column, nullable, optional on insert. */
type ColumnContract<Row, Insert, K extends keyof Row> = `${Kind<NonNullable<Row[K]>>}${null extends Row[K]
  ? " | null"
  : ""}${K extends keyof Insert ? (Partial<Pick<Insert, K>> extends Pick<Insert, K> ? "?" : "") : " (missing from Insert)"}`;
type TableContract<T extends { Row: object; Insert: object }> = {
  [K in keyof T["Row"]]-?: ColumnContract<T["Row"], T["Insert"], K>;
};
/** Insert/Update must have exactly the Row keys, and every Update key must be optional. */
type ShapeIsConsistent<T extends { Row: object; Insert: object; Update: object }> =
  Equals<keyof T["Insert"], keyof T["Row"]> extends true
    ? Equals<keyof T["Update"], keyof T["Row"]> extends true
      ? Partial<T["Update"]> extends T["Update"]
        ? true
        : false
      : false
    : false;

const tableShapesConsistent: { [T in keyof TableDefs]: ShapeIsConsistent<TableDefs[T]> } = {
  profiles: true,
  businesses: true,
  business_members: true,
  genres: true,
  business_genre_access: true,
  tracks: true,
  track_genres: true,
  announcements: true,
  playback_preferences: true,
  rate_limit_buckets: true,
  access_requests: true,
  platform_settings: true,
};

const columnContract: { [T in keyof TableDefs]: TableContract<TableDefs[T]> } = {
  profiles: {
    id: "string",
    email: "string",
    full_name: "string | null?",
    role: "enum:app_role?",
    created_at: "string?",
    updated_at: "string?",
  },
  businesses: {
    id: "string?",
    name: "string",
    station_name: "string",
    name_pronunciation: "string | null?",
    station_name_pronunciation: "string | null?",
    contact_email: "string | null?",
    announcement_language: "string?",
    logo_path: "string | null?",
    is_active: "boolean?",
    announcement_every_n_tracks: "number?",
    announcement_volume: "number?",
    branding_version: "number?",
    business_type: "enum:business_type?",
    created_at: "string?",
    updated_at: "string?",
  },
  business_members: {
    business_id: "string",
    user_id: "string",
    created_at: "string?",
  },
  genres: {
    id: "string?",
    name: "string",
    slug: "string",
    description: "string | null?",
    sort_order: "number?",
    is_enabled: "boolean?",
    available_to_all: "boolean?",
    cover_path: "string | null?",
    created_at: "string?",
    updated_at: "string?",
  },
  business_genre_access: {
    business_id: "string",
    genre_id: "string",
    created_at: "string?",
  },
  tracks: {
    id: "string?",
    title: "string",
    artist: "string?",
    duration_seconds: "number",
    storage_path: "string",
    file_size_bytes: "number",
    mime_type: "string?",
    bitrate_kbps: "number | null?",
    sample_rate_hz: "number | null?",
    original_filename: "string | null?",
    is_active: "boolean?",
    removed_at: "string | null?",
    created_by: "string | null?",
    created_at: "string?",
    updated_at: "string?",
  },
  track_genres: {
    track_id: "string",
    genre_id: "string",
    created_at: "string?",
  },
  announcements: {
    id: "string?",
    business_id: "string",
    template_key: "string | null?",
    placement: "enum:announcement_placement?",
    text: "string",
    spoken_text: "string | null?",
    language: "string?",
    status: "enum:announcement_status?",
    source: "enum:announcement_source | null?",
    audio_path: "string | null?",
    audio_duration_seconds: "number | null?",
    audio_size_bytes: "number | null?",
    voice_id: "string | null?",
    voice_name: "string | null?",
    model_id: "string | null?",
    generation_hash: "string | null?",
    generation_started_at: "string | null?",
    generation_attempts: "number?",
    last_error: "string | null?",
    needs_review: "boolean?",
    review_reason: "string | null?",
    branding_version: "number?",
    approved_at: "string | null?",
    approved_by: "string | null?",
    created_by: "string | null?",
    created_at: "string?",
    updated_at: "string?",
  },
  playback_preferences: {
    user_id: "string",
    business_id: "string",
    genre_id: "string | null?",
    volume: "number?",
    muted: "boolean?",
    created_at: "string?",
    updated_at: "string?",
  },
  rate_limit_buckets: {
    key: "string",
    window_started_at: "string",
    count: "number",
  },
  access_requests: {
    id: "string?",
    business_name: "string",
    business_type: "enum:business_type",
    contact_name: "string",
    email: "string",
    phone: "string | null?",
    message: "string | null?",
    status: "enum:access_request_status?",
    admin_notes: "string | null?",
    handled_by: "string | null?",
    handled_at: "string | null?",
    created_at: "string?",
    updated_at: "string?",
  },
  platform_settings: {
    id: "boolean?",
    contact_email: "string | null?",
    contact_phone: "string | null?",
    privacy_policy: "string | null?",
    terms_of_service: "string | null?",
    default_announcement_every_n_tracks: "number?",
    updated_at: "string?",
    updated_by: "string | null?",
  },
};

const enumContract: { [E in keyof EnumDefs]: Record<EnumDefs[E], true> } = {
  app_role: { platform_admin: true, business_user: true },
  announcement_status: { draft: true, generating: true, ready: true, failed: true, active: true },
  announcement_source: { upload: true, tts: true },
  announcement_placement: { welcome: true, rotation: true, both: true },
  business_type: { cafe: true, restaurant: true, hotel: true, bar: true, other: true },
  access_request_status: { new: true, contacted: true, approved: true, declined: true },
};

const functionArgsContract: { [F in keyof FunctionDefs]: Record<keyof FunctionDefs[F]["Args"] & string, true> } = {
  consume_rate_limit: { p_key: true, p_max: true, p_window_seconds: true },
  reorder_genres: { p_genre_ids: true },
  set_business_genre_access: { p_business_id: true, p_genre_ids: true },
  set_track_genres: { p_track_id: true, p_genre_ids: true },
  genre_track_counts: {},
};

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  is_identity: "YES" | "NO";
  is_generated: "ALWAYS" | "NEVER";
}

function describeColumn(column: ColumnInfo): string {
  const kind = (() => {
    switch (column.data_type) {
      case "USER-DEFINED":
        return `enum:${column.udt_name}`;
      case "uuid":
      case "text":
      case "character varying":
      case "timestamp with time zone":
      case "date":
        return "string";
      case "smallint":
      case "integer":
      case "bigint":
      case "numeric":
      case "real":
      case "double precision":
        return "number";
      case "boolean":
        return "boolean";
      case "json":
      case "jsonb":
        return "json";
      default:
        return `unmapped:${column.data_type}`;
    }
  })();
  const nullable = column.is_nullable === "YES";
  const optional =
    nullable || column.column_default !== null || column.is_identity === "YES" || column.is_generated === "ALWAYS";
  return `${kind}${nullable ? " | null" : ""}${optional ? "?" : ""}`;
}

const t = setupTestDb();

describe("schema contract (src/types/database.ts ↔ migrations)", () => {
  it("Insert/Update shapes are consistent with Row for every table", () => {
    expect(Object.values(tableShapesConsistent).every(Boolean)).toBe(true);
  });

  it("every public table and column matches the Database type", async () => {
    const { rows } = await t().db.query<ColumnInfo>(
      `select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
              c.column_default, c.is_identity, c.is_generated
         from information_schema.columns c
         join information_schema.tables tb
           on tb.table_schema = c.table_schema and tb.table_name = c.table_name
        where c.table_schema = 'public' and tb.table_type = 'BASE TABLE'
        order by c.table_name, c.ordinal_position`,
    );
    const actual: Record<string, Record<string, string>> = {};
    for (const column of rows) {
      (actual[column.table_name] ??= {})[column.column_name] = describeColumn(column);
    }
    expect(actual).toEqual(columnContract);
  });

  it("enums match the Database type", async () => {
    const { rows } = await t().db.query<{ name: string; labels: string[] }>(
      `select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
         from pg_type t
         join pg_enum e on e.enumtypid = t.oid
        where t.typnamespace = 'public'::regnamespace
        group by t.typname`,
    );
    const actual = Object.fromEntries(rows.map((row) => [row.name, [...row.labels].sort()]));
    const expected = Object.fromEntries(
      Object.entries(enumContract).map(([name, labels]) => [name, Object.keys(labels).sort()]),
    );
    expect(actual).toEqual(expected);
  });

  it("public functions (the RPC surface) match the Database type", async () => {
    const { rows } = await t().db.query<{ name: string; args: string[] }>(
      `select p.proname as name,
              coalesce(
                array(
                  select a.name
                    from unnest(p.proargnames, coalesce(p.proargmodes, array_fill('i'::"char", array[cardinality(p.proargnames)])))
                         as a(name, mode)
                   where a.mode in ('i', 'b')
                ),
                '{}'
              ) as args
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.prorettype <> 'trigger'::regtype`,
    );
    const actual = Object.fromEntries(rows.map((row) => [row.name, [...row.args].sort()]));
    const expected = Object.fromEntries(
      Object.entries(functionArgsContract).map(([name, args]) => [name, Object.keys(args).sort()]),
    );
    expect(actual).toEqual(expected);
  });

  it("uses the Supabase default FK constraint names listed in Relationships", async () => {
    const { rows } = await t().db.query<{ name: string }>(
      `select conname as name
         from pg_constraint
        where contype = 'f' and connamespace = 'public'::regnamespace
        order by conname`,
    );
    expect(rows.map((row) => row.name)).toEqual(
      [
        "access_requests_handled_by_fkey",
        "announcements_approved_by_fkey",
        "announcements_business_id_fkey",
        "announcements_created_by_fkey",
        "business_genre_access_business_id_fkey",
        "business_genre_access_genre_id_fkey",
        "business_members_business_id_fkey",
        "business_members_user_id_fkey",
        "playback_preferences_business_id_fkey",
        "playback_preferences_genre_id_fkey",
        "playback_preferences_user_id_fkey",
        "platform_settings_updated_by_fkey",
        "profiles_id_fkey",
        "track_genres_genre_id_fkey",
        "track_genres_track_id_fkey",
        "tracks_created_by_fkey",
      ].sort(),
    );
  });
});

describe("schema-wide security invariants", () => {
  it("enables RLS on every public table", async () => {
    const { rows } = await t().db.query<{ relname: string }>(
      `select relname from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("gives anon only SELECT on platform_settings, nothing on any other public table and no function", async () => {
    const tables = await t().db.query<{ relname: string; privilege: string }>(
      `select c.relname, p.privilege
         from pg_class c
        cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as p(privilege)
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and has_table_privilege('anon', c.oid, p.privilege)
        order by 1, 2`,
    );
    expect(tables.rows).toEqual([{ relname: "platform_settings", privilege: "select" }]);
    const columns = await t().db.query<{ relname: string; privilege: string }>(
      `select c.relname, p.privilege
         from pg_class c
        cross join unnest(array['select', 'insert', 'update', 'references']) as p(privilege)
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and has_any_column_privilege('anon', c.oid, p.privilege)
        order by 1, 2`,
    );
    expect(columns.rows).toEqual([{ relname: "platform_settings", privilege: "select" }]);
    const functions = await t().db.query<{ proname: string }>(
      `select p.proname from pg_proc p
        where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
          and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(functions.rows).toEqual([]);
    const schema = await t().db.query<{ usage: boolean }>(`select has_schema_privilege('anon', 'private', 'usage') as usage`);
    expect(schema.rows[0].usage).toBe(false);
  });

  it("lets authenticated update only profiles.full_name", async () => {
    const { rows } = await t().db.query<{ table_update: boolean; full_name: boolean; role: boolean; email: boolean }>(
      `select has_table_privilege('authenticated', 'public.profiles', 'update') as table_update,
              has_column_privilege('authenticated', 'public.profiles', 'full_name', 'update') as full_name,
              has_column_privilege('authenticated', 'public.profiles', 'role', 'update') as role,
              has_column_privilege('authenticated', 'public.profiles', 'email', 'update') as email`,
    );
    expect(rows[0]).toEqual({ table_update: false, full_name: true, role: false, email: false });
  });

  it("keeps rate_limit_buckets and consume_rate_limit to the service role", async () => {
    const { rows } = await t().db.query<Record<string, boolean>>(
      `select has_table_privilege('authenticated', 'public.rate_limit_buckets', 'select') as auth_table,
              has_table_privilege('service_role', 'public.rate_limit_buckets', 'select, insert, update, delete') as service_table,
              has_function_privilege('authenticated', 'public.consume_rate_limit(text, integer, integer)', 'execute') as auth_fn,
              has_function_privilege('service_role', 'public.consume_rate_limit(text, integer, integer)', 'execute') as service_fn`,
    );
    expect(rows[0]).toEqual({ auth_table: false, service_table: true, auth_fn: false, service_fn: true });
  });

  it("grants access_requests and platform_settings exactly (no API insert; settings read-only for anon)", async () => {
    const privileges = async (role: string, table: string) =>
      (
        await t().db.query<{ privilege: string }>(
          `select p.privilege
             from unnest(array['select', 'insert', 'update', 'delete', 'truncate']) as p(privilege)
            where has_table_privilege($1, $2::regclass, p.privilege)
            order by 1`,
          [role, table],
        )
      ).rows.map((row) => row.privilege);
    expect(await privileges("anon", "public.access_requests")).toEqual([]);
    expect(await privileges("authenticated", "public.access_requests")).toEqual(["delete", "select", "update"]);
    expect(await privileges("service_role", "public.access_requests")).toEqual(["delete", "insert", "select", "update"]);
    expect(await privileges("anon", "public.platform_settings")).toEqual(["select"]);
    expect(await privileges("authenticated", "public.platform_settings")).toEqual(["select", "update"]);
    expect(await privileges("service_role", "public.platform_settings")).toEqual(["insert", "select", "update"]);
  });

  it("pins search_path to '' on every function in public and private", async () => {
    const { rows } = await t().db.query<{ proname: string }>(
      `select p.proname from pg_proc p
        where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
          and not coalesce(p.proconfig, '{}') @> array['search_path=""']`,
    );
    expect(rows).toEqual([]);
  });

  it("the storage migration is re-runnable and restores drifted bucket settings", async () => {
    const storageMigration = readMigrations().find((migration) => migration.name.endsWith("_storage.sql"));
    if (!storageMigration) throw new Error("storage migration not found");
    // Drop the file's own BEGIN/COMMIT: it must not commit the per-test transaction.
    const body = storageMigration.sql.replace(/^(begin|commit);\r?$/gm, "");
    expect(body).not.toMatch(/^(begin|commit);/m);
    const policyNames = async () =>
      (
        await t().db.query<{ policyname: string }>(
          `select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1`,
        )
      ).rows.map((row) => row.policyname);

    const before = await policyNames();
    // 7 from the storage migration + 5 genre-covers policies from 20260926000100_frekvencija.sql.
    expect(before).toHaveLength(12);
    await t().db.query(`update storage.buckets set public = true, file_size_limit = 1 where id = 'music'`);
    await t().db.exec(body);
    expect(t().db.isInTransaction()).toBe(true);
    expect(await policyNames()).toEqual(before);
    const { rows } = await t().db.query(`select public, file_size_limit::float8 as size from storage.buckets where id = 'music'`);
    expect(rows).toEqual([{ public: false, size: 52428800 }]);
  });

  it("the Frekvencija migration's storage section is re-runnable and restores the genre-covers bucket", async () => {
    const migration = readMigrations().find((file) => file.name.endsWith("_frekvencija.sql"));
    if (!migration) throw new Error("frekvencija migration not found");
    // The storage section runs from its header comment to the end of the file.
    const start = migration.sql.search(/^-- 8\. Storage: `genre-covers` bucket/m);
    expect(start).toBeGreaterThan(0);
    const section = migration.sql.slice(start).replace(/^(begin|commit);\r?$/gm, "");
    expect(section).not.toMatch(/^(begin|commit);/m);
    expect(section).toMatch(/insert into storage\.buckets/);
    const policyNames = async () =>
      (
        await t().db.query<{ policyname: string }>(
          `select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1`,
        )
      ).rows.map((row) => row.policyname);

    const before = await policyNames();
    expect(before.filter((name) => name.startsWith("genre-covers: ")).sort()).toEqual([
      "genre-covers: admin delete",
      "genre-covers: admin insert",
      "genre-covers: admin select",
      "genre-covers: admin update",
      "genre-covers: member read accessible covers",
    ]);
    // The pre-existing "media: admin …" policies are untouched by the new bucket.
    expect(before.filter((name) => name.startsWith("media: admin "))).toHaveLength(4);
    await t().db.query(
      `update storage.buckets set public = true, file_size_limit = 1, allowed_mime_types = array['image/gif'] where id = 'genre-covers'`,
    );
    await t().db.exec(section);
    expect(t().db.isInTransaction()).toBe(true);
    expect(await policyNames()).toEqual(before);
    const { rows } = await t().db.query(
      `select public, file_size_limit::float8 as size, allowed_mime_types from storage.buckets where id = 'genre-covers'`,
    );
    expect(rows).toEqual([{ public: false, size: 3145728, allowed_mime_types: ["image/png", "image/jpeg", "image/webp"] }]);
  });

  it("creates the four private buckets with size limits and MIME types", async () => {
    const { rows } = await t().db.query<{
      id: string;
      public: boolean;
      file_size_limit: number;
      allowed_mime_types: string[];
    }>(`select id, public, file_size_limit::float8 as file_size_limit, allowed_mime_types from storage.buckets order by id`);
    expect(rows).toEqual([
      { id: "announcements", public: false, file_size_limit: 10485760, allowed_mime_types: ["audio/mpeg", "audio/mp3"] },
      {
        id: "genre-covers",
        public: false,
        file_size_limit: 3145728,
        allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
      },
      { id: "logos", public: false, file_size_limit: 2097152, allowed_mime_types: ["image/png", "image/jpeg", "image/webp"] },
      { id: "music", public: false, file_size_limit: 52428800, allowed_mime_types: ["audio/mpeg", "audio/mp3"] },
    ]);
  });
});
