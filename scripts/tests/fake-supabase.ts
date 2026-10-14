// In-memory stand-in for the parts of supabase-js the seed and demo removal use (PostgREST builder
// subset, Storage upload/list/remove, auth.admin.createUser/listUsers/deleteUser), with the schema's
// keys, cascades and the checks that matter for seeding. `missingSchema` simulates a database without
// the latest migration. Test-only.
import { randomUUID } from "node:crypto";
import type { AdminClient } from "../lib/supabase-admin";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
interface Result {
  data: unknown;
  error: { message: string; code: string } | null;
}

/** Unique column sets per table (primary key first). */
const KEYS: Record<string, string[][]> = {
  profiles: [["id"]],
  businesses: [["id"]],
  business_members: [["business_id", "user_id"], ["user_id"]],
  genres: [["id"], ["slug"]],
  business_genre_access: [["business_id", "genre_id"]],
  tracks: [["id"], ["storage_path"]],
  track_genres: [["track_id", "genre_id"]],
  announcements: [["id"]],
  platform_settings: [["id"]],
};

/** `on delete cascade` of the migrations: deleting a row of the key table deletes the matching rows. */
const CASCADES: Record<string, { table: string; column: string; via: string }[]> = {
  businesses: [
    { table: "announcements", column: "business_id", via: "id" },
    { table: "business_members", column: "business_id", via: "id" },
    { table: "business_genre_access", column: "business_id", via: "id" },
  ],
  genres: [
    { table: "track_genres", column: "genre_id", via: "id" },
    { table: "business_genre_access", column: "genre_id", via: "id" },
  ],
  tracks: [{ table: "track_genres", column: "track_id", via: "id" }],
  profiles: [{ table: "business_members", column: "user_id", via: "id" }],
};

/** Column defaults of the migrations (only the columns the seed reads back). */
const DEFAULTS: Record<string, () => Row> = {
  profiles: () => ({ full_name: null, role: "business_user" }),
  businesses: () => ({
    id: randomUUID(),
    is_active: false,
    branding_version: 1,
    contact_email: null,
    business_type: "other",
    announcement_every_n_tracks: 4,
    announcement_volume: 1,
  }),
  genres: () => ({ id: randomUUID(), is_enabled: true, available_to_all: true, sort_order: 0, cover_path: null }),
  tracks: () => ({ id: randomUUID(), is_active: true, removed_at: null, artist: "" }),
  announcements: () => ({ id: randomUUID(), status: "draft", needs_review: false, branding_version: 1, audio_path: null, approved_at: null }),
  business_members: () => ({}),
  business_genre_access: () => ({}),
  track_genres: () => ({}),
  platform_settings: () => ({
    id: true,
    contact_email: null,
    contact_phone: null,
    privacy_policy: null,
    terms_of_service: null,
    default_announcement_every_n_tracks: 4,
    updated_by: null,
  }),
};

type Op = "select" | "insert" | "upsert" | "update" | "delete";

export interface FakeFailure {
  table: string;
  op: Op;
  message?: string;
}

export class FakeSupabase {
  readonly tables = new Map<string, Row[]>(Object.keys(KEYS).map((name) => [name, []]));
  readonly objects = new Map<string, Uint8Array>(); // "bucket/path" → bytes
  readonly authUsers: { id: string; email: string; password: string | null; email_confirmed_at: string | null }[] = [];
  /** Emails "sent" by inviteUserByEmail and links made by generateLink. */
  readonly invites: { email: string; redirectTo: string | undefined; via: "email" | "link" }[] = [];
  failure: FakeFailure | null = null;
  /** Tables ("platform_settings") or columns ("businesses.business_type") that do not exist yet. */
  readonly missingSchema = new Set<string>();

  constructor() {
    // Migration 20260926000100 inserts the platform_settings singleton row.
    this.rows("platform_settings").push(DEFAULTS.platform_settings());
  }

  /** Adds an auth user (and, like the on_auth_user_created trigger, its profile unless `withProfile` is false). */
  addAuthUser(email: string, options: { password?: string | null; confirmed?: boolean; withProfile?: boolean; role?: string } = {}): string {
    const user = {
      id: randomUUID(),
      email: email.toLowerCase(),
      password: options.password ?? null,
      email_confirmed_at: options.confirmed === false ? null : new Date().toISOString(),
    };
    this.authUsers.push(user);
    if (options.withProfile !== false) {
      this.rows("profiles").push({ id: user.id, email: user.email, full_name: null, role: options.role ?? "business_user" });
    }
    return user.id;
  }

  private inviteUser(email: string, redirectTo: string | undefined, via: "email" | "link") {
    const existing = this.authUsers.find((user) => user.email === email.toLowerCase());
    if (existing?.email_confirmed_at) {
      return { user: null, error: { message: "A user with this email address has already been registered", code: "email_exists", status: 422 } };
    }
    const id = existing?.id ?? this.addAuthUser(email, { confirmed: false });
    this.invites.push({ email: email.toLowerCase(), redirectTo, via });
    return { user: { id, email: email.toLowerCase() }, error: null };
  }

  rows(table: string): Row[] {
    const rows = this.tables.get(table);
    if (!rows) throw new Error(`fake: unknown table ${table}`);
    return rows;
  }

  /** Deletes `doomed` from `table` and, like the migrations' `on delete cascade`, the rows that reference them. */
  private cascadeDelete(table: string, doomed: Row[]): void {
    const rows = this.rows(table);
    for (const row of doomed) rows.splice(rows.indexOf(row), 1);
    for (const cascade of CASCADES[table] ?? []) {
      const parents = new Set(doomed.map((row) => row[cascade.via]));
      this.cascadeDelete(
        cascade.table,
        this.rows(cascade.table).filter((child) => parents.has(child[cascade.column])),
      );
    }
  }

  private violation(table: string, row: Row, ignore?: Row): string | null {
    for (const key of KEYS[table]) {
      const clash = this.rows(table).find((other) => other !== ignore && key.every((column) => other[column] === row[column]));
      if (clash) return `duplicate key value violates unique constraint on ${table}(${key.join(", ")})`;
    }
    if (table === "announcements") {
      if ((row.status === "ready" || row.status === "active") && !row.audio_path) return "announcements_audio_required_check";
      if (row.status === "active" && !row.approved_at) return "announcements_active_requires_approval_check";
    }
    if (table === "business_members" && !this.rows("profiles").some((p) => p.id === row.user_id)) return "business_members_user_id_fkey";
    return null;
  }

  /** The error PostgREST returns for a table or column that does not exist, or null. */
  private schemaError(table: string, op: Op, state: BuilderState): Result["error"] {
    if (this.missingSchema.has(table)) return { message: `Could not find the table 'public.${table}' in the schema cache`, code: "PGRST205" };
    const written = op === "select" ? [] : state.payload.flatMap((row) => Object.keys(row));
    const missingWritten = written.find((column) => this.missingSchema.has(`${table}.${column}`));
    if (missingWritten) return { message: `Could not find the '${missingWritten}' column of '${table}' in the schema cache`, code: "PGRST204" };
    const missingRead = [...state.columns, ...state.filterColumns].find((column) => this.missingSchema.has(`${table}.${column}`));
    if (missingRead) return { message: `column ${table}.${missingRead} does not exist`, code: "42703" };
    return null;
  }

  execute(table: string, op: Op, state: BuilderState): Result {
    if (this.failure && this.failure.table === table && this.failure.op === op) {
      return { data: null, error: { message: this.failure.message ?? `injected ${op} failure on ${table}`, code: "XX000" } };
    }
    const schemaProblem = this.schemaError(table, op, state);
    if (schemaProblem) return { data: null, error: schemaProblem };
    const rows = this.rows(table);
    const matches = (row: Row) => state.filters.every((filter) => filter(row));
    let affected: Row[] = [];
    if (op === "select") {
      affected = rows.filter(matches);
    } else if (op === "delete") {
      affected = rows.filter(matches).map((row) => ({ ...row }));
      this.cascadeDelete(
        table,
        rows.filter(matches),
      );
    } else if (op === "update") {
      for (const row of rows.filter(matches)) {
        const next = { ...row, ...state.payload[0] };
        const problem = this.violation(table, next, row);
        if (problem) return { data: null, error: { message: problem, code: "23514" } };
        Object.assign(row, state.payload[0]);
        affected.push(row);
      }
    } else {
      const staged: Row[] = [];
      for (const input of state.payload) {
        const conflictColumns = state.onConflict?.split(",");
        const existing = conflictColumns ? rows.find((row) => conflictColumns.every((column) => row[column] === input[column])) : undefined;
        if (op === "upsert" && existing) {
          if (!state.ignoreDuplicates) {
            Object.assign(existing, input);
            affected.push(existing);
          }
          continue;
        }
        const row = { ...DEFAULTS[table](), ...input };
        const problem = this.violation(table, row) ?? (staged.some((other) => KEYS[table][0].every((c) => other[c] === row[c])) ? "duplicate in batch" : null);
        if (problem) return { data: null, error: { message: problem, code: "23505" } };
        staged.push(row);
      }
      rows.push(...staged);
      affected.push(...staged);
    }
    const data = state.limit !== null ? affected.slice(0, state.limit) : affected;
    if (state.single === "single") {
      return data.length === 1 ? { data: { ...data[0] }, error: null } : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    }
    if (state.single === "maybe") return { data: data[0] ? { ...data[0] } : null, error: null };
    return { data: op === "select" || state.returning ? data.map((row) => ({ ...row })) : null, error: null };
  }

  client(): AdminClient {
    const storage = {
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array, options: { contentType?: string; upsert?: boolean }) => {
          const key = `${bucket}/${path}`;
          if (options.contentType !== "audio/mpeg") return { data: null, error: { message: "mime type not supported", statusCode: "415" } };
          if (this.objects.has(key) && !options.upsert) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
          this.objects.set(key, body);
          return { data: { path, fullPath: key }, error: null };
        },
        remove: async (paths: string[]) => {
          for (const path of paths) this.objects.delete(`${bucket}/${path}`);
          return { data: paths.map((name) => ({ name })), error: null };
        },
        // One level, like Storage: files get an id, sub-folders come back with id null.
        list: async (prefix = "", options: { limit?: number; offset?: number } = {}) => {
          const folder = prefix ? `${bucket}/${prefix}/` : `${bucket}/`;
          const entries = new Map<string, { name: string; id: string | null }>();
          for (const key of this.objects.keys()) {
            if (!key.startsWith(folder)) continue;
            const [name, ...rest] = key.slice(folder.length).split("/");
            if (!entries.has(name)) entries.set(name, { name, id: rest.length > 0 ? null : `object-${name}` });
          }
          const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
          const offset = options.offset ?? 0;
          return { data: sorted.slice(offset, offset + (options.limit ?? 100)), error: null };
        },
      }),
    };
    const auth = {
      admin: {
        createUser: async ({ email, password, email_confirm }: { email: string; password: string; email_confirm?: boolean }) => {
          if (this.authUsers.some((user) => user.email === email.toLowerCase())) {
            return { data: { user: null }, error: { message: "A user with this email address has already been registered", code: "email_exists", status: 422 } };
          }
          const id = this.addAuthUser(email, { password, confirmed: email_confirm === true });
          return { data: { user: { id, email: email.toLowerCase() } }, error: null };
        },
        listUsers: async ({ page = 1, perPage = 50 }: { page?: number; perPage?: number } = {}) => ({
          data: { users: this.authUsers.slice((page - 1) * perPage, page * perPage).map(({ id, email }) => ({ id, email })) },
          error: null,
        }),
        // Removes the auth user; the profile (and what references it) goes with it, like `on delete cascade`.
        deleteUser: async (id: string) => {
          const index = this.authUsers.findIndex((candidate) => candidate.id === id);
          if (index === -1) return { data: { user: null }, error: { message: "User not found", code: "user_not_found", status: 404 } };
          const [user] = this.authUsers.splice(index, 1);
          this.cascadeDelete(
            "profiles",
            this.rows("profiles").filter((profile) => profile.id === id),
          );
          return { data: { user: { id: user.id, email: user.email } }, error: null };
        },
        getUserById: async (id: string) => {
          const user = this.authUsers.find((candidate) => candidate.id === id);
          return user
            ? { data: { user: { id: user.id, email: user.email, email_confirmed_at: user.email_confirmed_at } }, error: null }
            : { data: { user: null }, error: { message: "User not found", code: "user_not_found", status: 404 } };
        },
        inviteUserByEmail: async (email: string, options: { redirectTo?: string } = {}) => {
          const { user, error } = this.inviteUser(email, options.redirectTo, "email");
          return { data: { user }, error };
        },
        generateLink: async ({ type, email, options = {} }: { type: string; email: string; options?: { redirectTo?: string } }) => {
          if (type !== "invite") throw new Error(`fake: generateLink type ${type} not supported`);
          const { user, error } = this.inviteUser(email, options.redirectTo, "link");
          return user
            ? { data: { user, properties: { hashed_token: `hash-${user.id}`, action_link: "unused", verification_type: "invite" } }, error: null }
            : { data: { user: null, properties: null }, error };
        },
      },
    };
    return { from: (table: string) => new Builder(this, table), storage, auth } as unknown as AdminClient;
  }
}

interface BuilderState {
  filters: Filter[];
  /** Columns named in select() (empty for "*"), checked against `missingSchema`. */
  columns: string[];
  /** Columns used in filters, checked against `missingSchema`. */
  filterColumns: string[];
  payload: Row[];
  onConflict: string | null;
  ignoreDuplicates: boolean;
  returning: boolean;
  limit: number | null;
  single: "single" | "maybe" | null;
}

class Builder implements PromiseLike<Result> {
  private op: Op = "select";
  private readonly state: BuilderState = {
    filters: [],
    columns: [],
    filterColumns: [],
    payload: [],
    onConflict: null,
    ignoreDuplicates: false,
    returning: false,
    limit: null,
    single: null,
  };

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(columns = "*"): this {
    if (this.op !== "select") this.state.returning = true;
    else if (columns !== "*") this.state.columns = columns.split(",").map((column) => column.trim()).filter(Boolean);
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.op = "insert";
    this.state.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = "upsert";
    this.state.payload = Array.isArray(rows) ? rows : [rows];
    this.state.onConflict = options.onConflict ?? KEYS[this.table][0].join(",");
    this.state.ignoreDuplicates = options.ignoreDuplicates ?? false;
    return this;
  }
  update(values: Row): this {
    this.op = "update";
    this.state.payload = [values];
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.state.filterColumns.push(column);
    this.state.filters.push((row) => row[column] === value);
    return this;
  }
  ilike(column: string, pattern: string): this {
    this.state.filterColumns.push(column);
    this.state.filters.push((row) => String(row[column] ?? "").toLowerCase() === pattern.toLowerCase());
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.state.filterColumns.push(column);
    this.state.filters.push((row) => values.includes(row[column]));
    return this;
  }
  limit(count: number): this {
    this.state.limit = count;
    return this;
  }
  single(): this {
    this.state.single = "single";
    return this;
  }
  maybeSingle(): this {
    this.state.single = "maybe";
    return this;
  }
  then<T1 = Result, T2 = never>(onFulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null, onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    return Promise.resolve(this.db.execute(this.table, this.op, this.state)).then(onFulfilled, onRejected);
  }
}
