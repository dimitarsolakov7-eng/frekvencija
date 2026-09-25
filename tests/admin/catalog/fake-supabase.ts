/**
 * Minimal recording fake of the supabase-js surface used by the catalogue loaders and actions:
 * chainable query builders (every call is recorded, the builder resolves when awaited), rpc(), and
 * storage.from(bucket).list/remove. Every awaited operation is appended to `events` in order.
 */
import type { TypedSupabaseClient } from "@/lib/supabase/types";

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface RecordedQuery {
  table: string;
  calls: RecordedCall[];
}

export interface FakeResult {
  data?: unknown;
  error?: { code?: string; message?: string; details?: string } | null;
  count?: number | null;
}

export type QueryResponder = (query: RecordedQuery) => FakeResult;
export type RpcResponder = (name: string, args: unknown) => FakeResult;

export interface StorageFake {
  list?: (bucket: string, path: string) => FakeResult;
  remove?: (bucket: string, paths: string[]) => FakeResult;
  /** Batch signing; default: every path signed as `https://storage.test/sign/{bucket}/{path}?ttl={expiresIn}`. */
  createSignedUrls?: (bucket: string, paths: string[], expiresIn: number) => FakeResult;
}

export interface FakeSupabase {
  client: TypedSupabaseClient;
  queries: RecordedQuery[];
  rpcCalls: { name: string; args: unknown }[];
  storageCalls: { bucket: string; method: "list" | "remove" | "createSignedUrls"; args: unknown[] }[];
  /** Order in which operations were awaited, e.g. "tracks:select", "rpc:set_track_genres", "storage:remove". */
  events: string[];
}

function settle(result: FakeResult) {
  return { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null };
}

/** The first "verb" of a query (select/insert/update/upsert/delete). */
export function verbOf(query: RecordedQuery): string {
  return query.calls.find((call) => ["select", "insert", "update", "upsert", "delete"].includes(call.method))?.method ?? "?";
}

export function callsTo(query: RecordedQuery, method: string): unknown[][] {
  return query.calls.filter((call) => call.method === method).map((call) => call.args);
}

export function isCountQuery(query: RecordedQuery): boolean {
  const select = query.calls.find((call) => call.method === "select");
  const options = select?.args[1] as { head?: boolean } | undefined;
  return options?.head === true;
}

export function createFakeSupabase(
  options: { respond?: QueryResponder; rpc?: RpcResponder; storage?: StorageFake; events?: string[] } = {},
): FakeSupabase {
  const queries: RecordedQuery[] = [];
  const rpcCalls: FakeSupabase["rpcCalls"] = [];
  const storageCalls: FakeSupabase["storageCalls"] = [];
  const events = options.events ?? [];
  const respond = options.respond ?? (() => ({ data: [] }));

  function from(table: string) {
    const query: RecordedQuery = { table, calls: [] };
    queries.push(query);
    const builder: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") {
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
              events.push(`${table}:${verbOf(query)}`);
              return Promise.resolve()
                .then(() => settle(respond(query)))
                .then(resolve, reject);
            };
          }
          return (...args: unknown[]) => {
            query.calls.push({ method: String(property), args });
            return builder;
          };
        },
      },
    );
    return builder;
  }

  function rpc(name: string, args: unknown) {
    rpcCalls.push({ name, args });
    return {
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        events.push(`rpc:${name}`);
        return Promise.resolve()
          .then(() => settle(options.rpc ? options.rpc(name, args) : { data: null }))
          .then(resolve, reject);
      },
    };
  }

  const storage = {
    from(bucket: string) {
      return {
        async list(path: string, ...rest: unknown[]) {
          storageCalls.push({ bucket, method: "list", args: [path, ...rest] });
          events.push("storage:list");
          return settle(options.storage?.list ? options.storage.list(bucket, path) : { data: [] });
        },
        async remove(paths: string[]) {
          storageCalls.push({ bucket, method: "remove", args: [paths] });
          events.push("storage:remove");
          return settle(options.storage?.remove ? options.storage.remove(bucket, paths) : { data: paths.map((name) => ({ name })) });
        },
        async createSignedUrls(paths: string[], expiresIn: number) {
          storageCalls.push({ bucket, method: "createSignedUrls", args: [paths, expiresIn] });
          events.push("storage:createSignedUrls");
          return settle(
            options.storage?.createSignedUrls
              ? options.storage.createSignedUrls(bucket, paths, expiresIn)
              : {
                  data: paths.map((path) => ({ path, error: null, signedUrl: `https://storage.test/sign/${bucket}/${path}?ttl=${expiresIn}` })),
                },
          );
        },
      };
    },
  };

  const client = { from, rpc, storage } as unknown as TypedSupabaseClient;
  return { client, queries, rpcCalls, storageCalls, events };
}
