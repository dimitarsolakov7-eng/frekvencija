/**
 * In-memory stand-in for the Supabase clients used by the announcement routes and mutations:
 * - the admin USER client (cookie-bound, RLS) → `db.client("user")`
 * - the secret-key client → `db.client("admin")`
 * Both share one database and one object store. Writes and Storage calls are appended to
 * `db.events` so tests can assert ordering (e.g. "row updated before the old object was removed").
 *
 * Supports the PostgREST subset the code under test uses: select/insert/update/delete, eq, neq, is,
 * in, lt, gt, a flat `or(...)` of `column.op.value` terms, order, maybeSingle/single, and Storage
 * upload/remove/download.
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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string") {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && /\d{4}-\d{2}-\d{2}/.test(a) && /\d{4}-\d{2}-\d{2}/.test(b)) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** Splits `a.eq.1,b.lt."x,y"` at top-level commas, keeping quoted values intact. */
function splitTerms(expression: string): string[] {
  const terms: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of expression) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      terms.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) terms.push(current);
  return terms;
}

function parseLiteral(raw: string): unknown {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function termFilter(term: string): Filter {
  const match = /^([a-z_]+)\.(eq|neq|is|lt|lte|gt|gte)\.(.*)$/.exec(term.trim());
  if (!match) throw new Error(`Fake or(): unsupported term "${term}"`);
  const [, column, op, rawValue] = match;
  const value = parseLiteral(rawValue);
  return (row) => {
    const cell = row[column];
    switch (op) {
      case "eq":
        return cell !== null && cell !== undefined && String(cell) === String(value);
      case "neq":
        return cell !== null && cell !== undefined && String(cell) !== String(value);
      case "is":
        return cell === value || (value === null && cell === undefined);
      case "lt":
        return cell !== null && cell !== undefined && compare(cell, value) < 0;
      case "lte":
        return cell !== null && cell !== undefined && compare(cell, value) <= 0;
      case "gt":
        return cell !== null && cell !== undefined && compare(cell, value) > 0;
      case "gte":
        return cell !== null && cell !== undefined && compare(cell, value) >= 0;
      default:
        return false;
    }
  };
}

export class FakeSupabase {
  readonly tables: Record<string, Row[]> = {};
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly events: string[] = [];
  /** Signed-in user for auth.getClaims() (null = signed out). */
  currentUserId: string | null = null;
  private readonly failures = new Map<string, FakeError[]>();
  private readonly interceptors = new Map<string, (() => void)[]>();
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

  objectPaths(bucket: string): string[] {
    return [...this.objects.keys()].filter((key) => key.startsWith(`${bucket}/`)).map((key) => key.slice(bucket.length + 1));
  }

  /**
   * Makes the next matching call fail. Targets: `db:<table>:<select|insert|update|delete>`,
   * `rpc:<name>`, `storage:<upload|download|remove|createSignedUrl>`.
   */
  failNext(target: string, error: FakeError): void {
    this.failures.set(target, [...(this.failures.get(target) ?? []), error]);
  }

  /** Runs `fn` right before the next matching call executes (same targets as failNext). */
  beforeNext(target: string, fn: () => void): void {
    this.interceptors.set(target, [...(this.interceptors.get(target) ?? []), fn]);
  }

  private take<T>(map: Map<string, T[]>, target: string): T | null {
    const queue = map.get(target);
    if (!queue || queue.length === 0) return null;
    const [first, ...rest] = queue;
    map.set(target, rest);
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
          this.currentUserId ? { data: { claims: { sub: this.currentUserId } }, error: null } : { data: null, error: null },
      },
      from: (table: string) => new FakeQuery(this, table, role),
      rpc: async (name: string) => {
        throw new Error(`Fake rpc ${name} is not implemented`);
      },
      storage: {
        from: (bucket: string) => this.bucketApi(bucket, role),
      },
    };
    return client as unknown as TypedSupabaseClient;
  }

  /** Executes a built query (called by FakeQuery). */
  execute(query: FakeQuery, mode: "many" | "maybeSingle" | "single"): Result {
    const { table, op } = query;
    this.take(this.interceptors, `db:${table}:${op}`)?.();
    const failure = this.take(this.failures, `db:${table}:${op}`);
    if (failure) return { data: null, error: failure };

    const rows = (this.tables[table] ??= []);
    const matches = (row: Row) => query.filters.every((filter) => filter(row));
    let affected: Row[];

    switch (op) {
      case "select":
        affected = rows.filter(matches);
        for (const [column, ascending] of [...query.ordering].reverse()) {
          affected = [...affected].sort((a, b) => (ascending ? 1 : -1) * compare(a[column], b[column]));
        }
        break;
      case "insert": {
        const inputs = Array.isArray(query.payload) ? (query.payload as Row[]) : [query.payload as Row];
        affected = [];
        for (const input of inputs) {
          const now = this.timestamp();
          const row: Row = { id: randomUUID(), created_at: now, updated_at: now, ...clone(input) };
          if (rows.some((existing) => existing.id === row.id)) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
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

  private bucketApi(bucket: string, role: ClientRole) {
    return {
      upload: async (path: string, body: Uint8Array, options: { contentType?: string; upsert?: boolean } = {}) => {
        this.events.push(`storage:${role}:upload:${bucket}/${path}`);
        const failure = this.take(this.failures, "storage:upload");
        if (failure) return { data: null, error: failure };
        if (!options.upsert && this.hasObject(bucket, path)) {
          return { data: null, error: { name: "StorageApiError", message: "The resource already exists", status: 400, statusCode: "409" } };
        }
        this.putObject(bucket, path, new Uint8Array(body), options.contentType ?? "application/octet-stream");
        return { data: { id: randomUUID(), path, fullPath: `${bucket}/${path}` }, error: null };
      },
      download: async (path: string) => {
        this.events.push(`storage:${role}:download:${bucket}/${path}`);
        const object = this.objects.get(`${bucket}/${path}`);
        if (!object) return { data: null, error: { name: "StorageApiError", message: "Object not found", status: 400, statusCode: "404" } };
        return { data: new Blob([object.bytes.slice()], { type: object.contentType }), error: null };
      },
      remove: async (paths: string[]) => {
        this.events.push(...paths.map((path) => `storage:${role}:remove:${bucket}/${path}`));
        const failure = this.take(this.failures, "storage:remove");
        if (failure) return { data: null, error: failure };
        const removed = paths.filter((path) => this.objects.delete(`${bucket}/${path}`));
        return { data: removed.map((name) => ({ name })), error: null };
      },
    };
  }
}

/** Chainable, awaitable query builder with the subset of the PostgREST API the code uses. */
export class FakeQuery implements PromiseLike<Result> {
  op: "select" | "insert" | "update" | "delete" = "select";
  payload: unknown = null;
  returning = false;
  readonly filters: Filter[] = [];
  readonly ordering: [column: string, ascending: boolean][] = [];

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
  lt(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== null && compare(row[column], value) < 0);
    return this;
  }
  or(expression: string): this {
    const terms = splitTerms(expression).map(termFilter);
    this.filters.push((row) => terms.some((term) => term(row)));
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}): this {
    this.ordering.push([column, options.ascending ?? true]);
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
