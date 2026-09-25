/**
 * In-memory stand-in for the two Supabase clients the upload/preview routes use:
 * - the admin USER client (cookie-bound, RLS) → `db.client("user")`
 * - the secret-key client → `db.client("admin")`
 * Both share one database and one object store. Every write and every Storage call is appended to
 * `db.events` so tests can assert ordering (e.g. "row updated before the old object was removed").
 */
import { randomUUID } from "node:crypto";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

export type Row = Record<string, unknown>;
export type ClientRole = "user" | "admin";

export interface FakeError {
  code?: string;
  message: string;
  status?: number;
  statusCode?: string;
  name?: string;
}

type Result = { data: unknown; error: FakeError | null };
type Filter = (row: Row) => boolean;

const TABLE_DEFAULTS: Record<string, () => Row> = {
  tracks: () => ({
    artist: "Unknown Artist",
    mime_type: "audio/mpeg",
    bitrate_kbps: null,
    sample_rate_hz: null,
    original_filename: null,
    is_active: true,
    removed_at: null,
    created_by: null,
  }),
};

const UNIQUE_COLUMNS: Record<string, readonly string[]> = {
  tracks: ["id", "storage_path"],
  genres: ["id"],
  businesses: ["id"],
  announcements: ["id"],
  profiles: ["id"],
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class FakeSupabase {
  readonly tables: Record<string, Row[]> = {};
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly events: string[] = [];
  /** Signed-in user for auth.getClaims() (null = signed out). */
  currentUserId: string | null = null;
  private readonly failures = new Map<string, FakeError[]>();
  private clock = 0;

  // -------------------------------------------------------------------------
  // Test controls
  // -------------------------------------------------------------------------

  seed(table: string, rows: Row[]): void {
    this.tables[table] = [...(this.tables[table] ?? []), ...rows.map((row) => clone(row))];
  }

  rows(table: string): Row[] {
    return clone(this.tables[table] ?? []);
  }

  row(table: string, id: string): Row | undefined {
    return this.rows(table).find((row) => row.id === id);
  }

  /** Mutates a row directly (no event), e.g. to simulate a concurrent change. */
  patchRow(table: string, id: string, patch: Row): void {
    const row = (this.tables[table] ?? []).find((candidate) => candidate.id === id);
    if (!row) throw new Error(`No ${table} row ${id}`);
    Object.assign(row, patch);
  }

  putObject(bucket: string, path: string, bytes: Uint8Array, contentType = "application/octet-stream"): void {
    this.objects.set(`${bucket}/${path}`, { bytes, contentType });
  }

  hasObject(bucket: string, path: string): boolean {
    return this.objects.has(`${bucket}/${path}`);
  }

  /**
   * Makes the next matching call fail. Targets: `db:<table>:<select|insert|update|delete>`,
   * `rpc:<name>`, `storage:<createSignedUploadUrl|createSignedUrl|download|remove>`.
   */
  failNext(target: string, error: FakeError): void {
    this.failures.set(target, [...(this.failures.get(target) ?? []), error]);
  }

  private takeFailure(target: string): FakeError | null {
    const queue = this.failures.get(target);
    if (!queue || queue.length === 0) return null;
    const [first, ...rest] = queue;
    this.failures.set(target, rest);
    return first;
  }

  private timestamp(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 8, 25, 12, 0, 0) + this.clock).toISOString();
  }

  // -------------------------------------------------------------------------
  // Client
  // -------------------------------------------------------------------------

  client(role: ClientRole): TypedSupabaseClient {
    const client = {
      auth: {
        getClaims: async () =>
          this.currentUserId
            ? { data: { claims: { sub: this.currentUserId } }, error: null }
            : { data: null, error: null },
      },
      from: (table: string) => new FakeQuery(this, table, role),
      rpc: async (name: string, args: Row) => this.rpc(name, args, role),
      storage: {
        from: (bucket: string) => this.bucketApi(bucket, role),
      },
    };
    return client as unknown as TypedSupabaseClient;
  }

  /** Executes a built query (called by FakeQuery). */
  execute(query: FakeQuery, mode: "many" | "maybeSingle" | "single"): Result {
    const { table, op } = query;
    const failure = this.takeFailure(`db:${table}:${op}`);
    if (failure) return { data: null, error: failure };

    const rows = (this.tables[table] ??= []);
    const matches = (row: Row) => query.filters.every((filter) => filter(row));
    let affected: Row[];

    switch (op) {
      case "select":
        affected = rows.filter(matches);
        break;
      case "insert": {
        const inputs = Array.isArray(query.payload) ? (query.payload as Row[]) : [query.payload as Row];
        affected = [];
        for (const input of inputs) {
          const now = this.timestamp();
          const row: Row = { id: randomUUID(), ...(TABLE_DEFAULTS[table]?.() ?? {}), created_at: now, updated_at: now, ...clone(input) };
          for (const column of UNIQUE_COLUMNS[table] ?? []) {
            if (rows.some((existing) => existing[column] === row[column])) {
              return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${column}` } };
            }
          }
          rows.push(row);
          affected.push(row);
        }
        this.events.push(`db:${query.role}:insert:${table}`);
        break;
      }
      case "update": {
        affected = rows.filter(matches);
        for (const row of affected) Object.assign(row, clone(query.payload as Row), { updated_at: this.timestamp() });
        this.events.push(`db:${query.role}:update:${table}${affected.length === 0 ? ":none" : ""}`);
        break;
      }
      case "delete": {
        affected = rows.filter(matches);
        this.tables[table] = rows.filter((row) => !matches(row));
        this.events.push(`db:${query.role}:delete:${table}`);
        break;
      }
    }

    const data = clone(affected);
    if (mode === "maybeSingle") {
      if (data.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
      return { data: data[0] ?? null, error: null };
    }
    if (mode === "single") {
      if (data.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
      return { data: data[0], error: null };
    }
    return { data: op === "select" || query.returning ? data : null, error: null };
  }

  private async rpc(name: string, args: Row, role: ClientRole): Promise<Result> {
    const failure = this.takeFailure(`rpc:${name}`);
    if (failure) return { data: null, error: failure };
    if (name !== "set_track_genres") throw new Error(`Fake rpc ${name} is not implemented`);
    if (role !== "user") throw new Error("set_track_genres must be called with the admin user's client");
    const trackId = args.p_track_id as string;
    const genreIds = args.p_genre_ids as string[];
    if (!this.row("tracks", trackId)) return { data: null, error: { code: "23503", message: "unknown track" } };
    if (genreIds.some((id) => !this.row("genres", id))) return { data: null, error: { code: "23503", message: "unknown genre" } };
    const others = (this.tables.track_genres ?? []).filter((row) => row.track_id !== trackId);
    this.tables.track_genres = [...others, ...genreIds.map((genre_id) => ({ track_id: trackId, genre_id, created_at: this.timestamp() }))];
    this.events.push(`rpc:${role}:set_track_genres`);
    return { data: null, error: null };
  }

  private bucketApi(bucket: string, role: ClientRole) {
    return {
      createSignedUploadUrl: async (path: string) => {
        this.events.push(`storage:${role}:createSignedUploadUrl:${bucket}/${path}`);
        const failure = this.takeFailure("storage:createSignedUploadUrl");
        if (failure) return { data: null, error: failure };
        return {
          data: { signedUrl: `https://storage.test/storage/v1/object/upload/sign/${bucket}/${path}?token=upload-jwt`, token: "upload-jwt", path },
          error: null,
        };
      },
      createSignedUrl: async (path: string, expiresIn: number) => {
        this.events.push(`storage:${role}:createSignedUrl:${bucket}/${path}`);
        const failure = this.takeFailure("storage:createSignedUrl");
        if (failure) return { data: null, error: failure };
        if (!this.hasObject(bucket, path)) {
          return { data: null, error: { name: "StorageApiError", message: "Object not found", status: 400, statusCode: "404" } };
        }
        return { data: { signedUrl: `https://storage.test/storage/v1/object/sign/${bucket}/${path}?token=read-jwt&ttl=${expiresIn}` }, error: null };
      },
      download: async (path: string) => {
        this.events.push(`storage:${role}:download:${bucket}/${path}`);
        const failure = this.takeFailure("storage:download");
        if (failure) return { data: null, error: failure };
        const object = this.objects.get(`${bucket}/${path}`);
        if (!object) {
          return { data: null, error: { name: "StorageApiError", message: "Object not found", status: 400, statusCode: "404" } };
        }
        return { data: new Blob([object.bytes.slice()], { type: object.contentType }), error: null };
      },
      remove: async (paths: string[]) => {
        this.events.push(...paths.map((path) => `storage:${role}:remove:${bucket}/${path}`));
        const failure = this.takeFailure("storage:remove");
        if (failure) return { data: null, error: failure };
        const removed = paths.filter((path) => this.objects.delete(`${bucket}/${path}`));
        return { data: removed.map((name) => ({ name })), error: null };
      },
    };
  }
}

/** Chainable, awaitable query builder with the subset of the PostgREST API the routes use. */
export class FakeQuery implements PromiseLike<Result> {
  op: "select" | "insert" | "update" | "delete" = "select";
  payload: unknown = null;
  returning = false;
  readonly filters: Filter[] = [];

  constructor(
    private readonly db: FakeSupabase,
    readonly table: string,
    readonly role: ClientRole,
  ) {}

  select(): this {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(values: unknown): this {
    this.op = "insert";
    this.payload = values;
    return this;
  }
  update(values: unknown): this {
    this.op = "update";
    this.payload = values;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: null | boolean): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  maybeSingle(): Promise<Result> {
    return Promise.resolve(this.db.execute(this, "maybeSingle"));
  }
  single(): Promise<Result> {
    return Promise.resolve(this.db.execute(this, "single"));
  }
  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve(this.db.execute(this, "many")).then(onfulfilled, onrejected);
  }
}
