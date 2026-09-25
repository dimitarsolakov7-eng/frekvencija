/**
 * A small in-memory stand-in for the parts of supabase-js the player routes use.
 *
 * `tables` holds the rows the caller can see, i.e. what RLS would return; tests model "RLS hides it"
 * by leaving a row out. Filters, ordering, ranges, embedded selects (`rel!inner(cols)`, embedded
 * filters `rel.col`), `maybeSingle`/`single`, `upsert`, `rpc` and Storage `createSignedUrl` /
 * `createSignedUrls` behave like PostgREST/Storage for the subset used here. Every query and signing
 * call is logged so tests can assert what was asked.
 */
import type { CreateSignedUrlResult } from "@/lib/media/signing";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

export type Row = Record<string, unknown>;

export interface PgError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

export function pgError(code: string, message = `fake error ${code}`): PgError {
  return { code, message, details: null, hint: null };
}

type Filter =
  | { op: "eq"; column: string; value: unknown }
  | { op: "is"; column: string; value: null | boolean }
  | { op: "not"; column: string; operator: string; value: unknown }
  | { op: "in"; column: string; value: readonly unknown[] };

export interface QueryLog {
  table: string;
  operation: "select" | "upsert";
  columns: string | null;
  filters: Filter[];
  orders: { column: string; ascending: boolean }[];
  range: [number, number] | null;
  payload: Row | null;
  onConflict: string | null;
}

export interface SignCall {
  bucket: string;
  path: string;
  expiresIn: number;
}

export interface BatchSignCall {
  bucket: string;
  paths: string[];
  expiresIn: number;
}

/** Storage's batch signing response shape (`createSignedUrls`). */
export type BatchSignResult =
  | { data: { error: string | null; path: string | null; signedURL: string | null; signedUrl: string | null }[]; error: null }
  | { data: null; error: { message: string; statusCode?: string } };

export interface FakeSupabaseOptions {
  tables?: Record<string, Row[]>;
  rpc?: Record<string, { data: unknown; error: PgError | null }>;
  /** Every query on these tables fails with the given error. */
  failTables?: Record<string, PgError>;
  /** Upserts on these tables fail with the given error (reads still work). */
  failUpserts?: Record<string, PgError>;
  /** RLS with-check for upserts: return an error to refuse the proposed row. */
  upsertCheck?: (table: string, row: Row) => PgError | null;
  /** Storage signing; defaults to a deterministic fake URL. */
  sign?: (call: SignCall) => CreateSignedUrlResult | Promise<CreateSignedUrlResult>;
  /**
   * Storage batch signing (`createSignedUrls`). Defaults to signing every path whose object is
   * listed in `objects` for the bucket (or every path when `objects` has no entry for it), and
   * reporting Storage's per-path error for the others, like RLS-hidden or missing objects.
   */
  signBatch?: (call: BatchSignCall) => BatchSignResult | Promise<BatchSignResult>;
  /** Objects visible to the caller per bucket (used by the default batch signing). */
  objects?: Record<string, readonly string[]>;
}

/** Many-to-one embeds resolved through a foreign-key column (e.g. playback_preferences → genres). */
const MANY_TO_ONE: Record<string, Record<string, { fk: string; table: string }>> = {
  playback_preferences: { genres: { fk: "genre_id", table: "genres" } },
};

/** Column defaults applied when an upsert inserts a new row. */
const INSERT_DEFAULTS: Record<string, Row> = {
  playback_preferences: { genre_id: null, volume: 0.8, muted: false },
};

interface Embed {
  name: string;
  inner: boolean;
  columns: SelectSpec;
}

interface SelectSpec {
  star: boolean;
  columns: string[];
  embeds: Embed[];
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function parseSelect(columns: string): SelectSpec {
  const spec: SelectSpec = { star: false, columns: [], embeds: [] };
  for (const token of splitTopLevel(columns)) {
    const open = token.indexOf("(");
    if (open === -1) {
      if (token === "*") spec.star = true;
      else spec.columns.push(token);
      continue;
    }
    const head = token.slice(0, open).trim();
    const body = token.slice(open + 1, token.lastIndexOf(")"));
    const [name, hint] = head.split("!");
    spec.embeds.push({ name: name.trim(), inner: hint?.trim() === "inner", columns: parseSelect(body) });
  }
  return spec;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1; // NULLS LAST for ascending order
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function matches(row: Row, filter: Filter): boolean {
  const value = row[filter.column];
  switch (filter.op) {
    case "eq":
      return value === filter.value;
    case "is":
      return value === filter.value;
    case "not":
      if (filter.operator === "is") return value !== filter.value;
      if (filter.operator === "eq") return value !== filter.value;
      throw new Error(`fake-supabase: unsupported not() operator ${filter.operator}`);
    case "in":
      return filter.value.includes(value);
  }
}

export class FakeSupabase {
  readonly tables: Record<string, Row[]>;
  readonly queries: QueryLog[] = [];
  readonly rpcCalls: string[] = [];
  readonly signCalls: SignCall[] = [];
  readonly batchSignCalls: BatchSignCall[] = [];
  private readonly options: FakeSupabaseOptions;

  constructor(options: FakeSupabaseOptions = {}) {
    this.options = options;
    this.tables = Object.fromEntries(
      Object.entries(options.tables ?? {}).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
    );
  }

  /** The fake typed as the real client (only the members used by the player code exist). */
  get client(): TypedSupabaseClient {
    return {
      from: (table: string) => new FakeQuery(this, table),
      rpc: async (name: string) => {
        this.rpcCalls.push(name);
        return this.options.rpc?.[name] ?? { data: null, error: pgError("PGRST202", `Could not find function ${name}`) };
      },
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (path: string, expiresIn: number): Promise<CreateSignedUrlResult> => {
            const call = { bucket, path, expiresIn };
            this.signCalls.push(call);
            if (this.options.sign) return this.options.sign(call);
            return {
              data: { signedUrl: `https://storage.test/object/sign/${bucket}/${path}?token=signed&ttl=${expiresIn}` },
              error: null,
            };
          },
          createSignedUrls: async (paths: string[], expiresIn: number): Promise<BatchSignResult> => {
            const call = { bucket, paths: [...paths], expiresIn };
            this.batchSignCalls.push(call);
            if (this.options.signBatch) return this.options.signBatch(call);
            const visible = this.options.objects?.[bucket];
            return {
              data: paths.map((path) => {
                if (visible && !visible.includes(path)) {
                  return { error: "Either the object does not exist or you do not have access to it", path, signedURL: null, signedUrl: null };
                }
                const signedURL = `/object/sign/${bucket}/${path}?token=signed&ttl=${expiresIn}`;
                return { error: null, path, signedURL, signedUrl: `https://storage.test${signedURL}` };
              }),
              error: null,
            };
          },
        }),
      },
    } as unknown as TypedSupabaseClient;
  }

  queriesFor(table: string, operation: QueryLog["operation"] = "select"): QueryLog[] {
    return this.queries.filter((query) => query.table === table && query.operation === operation);
  }

  /** @internal */
  execute(log: QueryLog): { data: Row[] | null; error: PgError | null } {
    this.queries.push(log);
    const failure = this.options.failTables?.[log.table];
    if (failure) return { data: null, error: failure };
    if (log.operation === "upsert") return this.executeUpsert(log);

    const spec = parseSelect(log.columns ?? "*");
    // Filter and order on the raw rows (PostgREST may filter on columns it does not return), then
    // project. Embedded filters narrow the inline child arrays; `!inner` drops rows left without any.
    let raw = [...(this.tables[log.table] ?? [])];
    const embedFilters = new Map<string, Filter[]>();
    for (const filter of log.filters) {
      const dot = filter.column.indexOf(".");
      if (dot === -1) {
        if (!raw.every((row) => filter.column in row)) {
          throw new Error(`fake-supabase: filter on unknown column ${log.table}.${filter.column}`);
        }
        raw = raw.filter((row) => matches(row, filter));
      } else {
        const embed = filter.column.slice(0, dot);
        const list = embedFilters.get(embed) ?? [];
        list.push({ ...filter, column: filter.column.slice(dot + 1) });
        embedFilters.set(embed, list);
      }
    }
    for (const [embedName, filters] of embedFilters) {
      if (!spec.embeds.some((candidate) => candidate.name === embedName)) {
        throw new Error(`fake-supabase: filter on ${embedName}, which is not embedded in the select`);
      }
      raw = raw.map((row) => {
        const children = row[embedName];
        if (!Array.isArray(children)) throw new Error(`fake-supabase: embedded filter on to-one relation ${embedName}`);
        return { ...row, [embedName]: children.filter((child: Row) => filters.every((filter) => matches(child, filter))) };
      });
    }

    let pairs = raw.map((row) => ({ row, projected: this.project(log.table, row, spec) }));
    for (const embed of spec.embeds) {
      if (!embed.inner) continue;
      pairs = pairs.filter(({ projected }) => {
        const value = projected[embed.name];
        return Array.isArray(value) ? value.length > 0 : value !== null;
      });
    }
    for (const order of log.orders) {
      if (!raw.every((row) => order.column in row)) {
        throw new Error(`fake-supabase: order by unknown column ${log.table}.${order.column}`);
      }
    }
    if (log.orders.length > 0) {
      pairs.sort((a, b) => {
        for (const order of log.orders) {
          const result = compare(a.row[order.column], b.row[order.column]);
          if (result !== 0) return order.ascending ? result : -result;
        }
        return 0;
      });
    }
    if (log.range) pairs = pairs.slice(log.range[0], log.range[1] + 1);
    return { data: pairs.map(({ projected }) => projected), error: null };
  }

  private executeUpsert(log: QueryLog): { data: Row[] | null; error: PgError | null } {
    const payload = log.payload ?? {};
    const failure = this.options.failUpserts?.[log.table];
    if (failure) return { data: null, error: failure };
    const keys = (log.onConflict ?? "id").split(",").map((key) => key.trim());
    const table = (this.tables[log.table] ??= []);
    const index = table.findIndex((row) => keys.every((key) => row[key] === payload[key]));
    const merged: Row = index >= 0 ? { ...table[index], ...payload } : { ...INSERT_DEFAULTS[log.table], ...payload };
    const refused = this.options.upsertCheck?.(log.table, merged) ?? null;
    if (refused) return { data: null, error: refused };
    if (index >= 0) table[index] = merged;
    else table.push(merged);
    return { data: [this.project(log.table, merged, parseSelect(log.columns ?? "*"))], error: null };
  }

  private project(table: string, row: Row, spec: SelectSpec): Row {
    if (spec.star) return { ...row };
    const result: Row = {};
    for (const column of spec.columns) {
      if (!(column in row)) throw new Error(`fake-supabase: ${table}.${column} is missing from the fixture row`);
      result[column] = row[column];
    }
    for (const embed of spec.embeds) {
      const toOne = MANY_TO_ONE[table]?.[embed.name];
      if (toOne) {
        const target = (this.tables[toOne.table] ?? []).find((candidate) => candidate.id === row[toOne.fk]);
        result[embed.name] = target ? this.project(toOne.table, target, embed.columns) : null;
        continue;
      }
      const children = row[embed.name];
      if (!Array.isArray(children)) throw new Error(`fake-supabase: ${table}.${embed.name} must be an inline array`);
      result[embed.name] = children.map((child: Row) => this.project(embed.name, child, embed.columns));
    }
    return result;
  }
}

class FakeQuery implements PromiseLike<{ data: Row[] | null; error: PgError | null }> {
  private readonly log: QueryLog;
  private readonly fake: FakeSupabase;

  constructor(fake: FakeSupabase, table: string) {
    this.fake = fake;
    this.log = {
      table,
      operation: "select",
      columns: null,
      filters: [],
      orders: [],
      range: null,
      payload: null,
      onConflict: null,
    };
  }

  select(columns = "*") {
    this.log.columns = columns;
    return this;
  }

  upsert(payload: Row, options: { onConflict?: string } = {}) {
    this.log.operation = "upsert";
    this.log.payload = { ...payload };
    this.log.onConflict = options.onConflict ?? null;
    return this;
  }

  eq(column: string, value: unknown) {
    this.log.filters.push({ op: "eq", column, value });
    return this;
  }

  is(column: string, value: null | boolean) {
    this.log.filters.push({ op: "is", column, value });
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    this.log.filters.push({ op: "not", column, operator, value });
    return this;
  }

  in(column: string, value: readonly unknown[]) {
    this.log.filters.push({ op: "in", column, value });
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.log.orders.push({ column, ascending: options.ascending ?? true });
    return this;
  }

  range(from: number, to: number) {
    this.log.range = [from, to];
    return this;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: PgError | null }> {
    const { data, error } = this.fake.execute(this.log);
    if (error) return { data: null, error };
    if (data && data.length > 1) return { data: null, error: pgError("PGRST116", "JSON object requested, multiple rows returned") };
    return { data: data?.[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: PgError | null }> {
    const { data, error } = this.fake.execute(this.log);
    if (error) return { data: null, error };
    if (!data || data.length !== 1) return { data: null, error: pgError("PGRST116", "JSON object requested, multiple (or no) rows returned") };
    return { data: data[0], error: null };
  }

  then<TResult1 = { data: Row[] | null; error: PgError | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: PgError | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.fake.execute(this.log))
      .then(onfulfilled, onrejected);
  }
}
