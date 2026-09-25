/**
 * A small chainable stand-in for the supabase-js query builder, for Server Action tests. Every
 * awaited query is recorded as a `QueryCall` and answered by the test's responder.
 */
import type { TypedSupabaseClient } from "@/lib/supabase/types";

export type QueryOp = "select" | "insert" | "update" | "delete";

export interface QueryCall {
  table: string;
  op: QueryOp;
  columns?: string;
  selectOptions?: unknown;
  /** Columns requested back from a mutation (`.insert().select("id")`). */
  returning?: string;
  payload?: unknown;
  filters: [method: string, ...args: unknown[]][];
  single?: "single" | "maybeSingle";
}

export interface RpcCall {
  fn: string;
  args: unknown;
}

export interface FakeResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
}

export type Responder = (call: QueryCall) => FakeResult | undefined;
export type RpcResponder = (call: RpcCall) => FakeResult | undefined;

const FILTER_METHODS = ["eq", "neq", "is", "not", "in", "ilike", "like", "gt", "lt", "order", "limit", "range"] as const;

export interface FakeClient {
  client: TypedSupabaseClient;
  calls: QueryCall[];
  rpcCalls: RpcCall[];
}

export function createFakeClient(respond: Responder, respondRpc: RpcResponder = () => undefined, extra: Record<string, unknown> = {}): FakeClient {
  const calls: QueryCall[] = [];
  const rpcCalls: RpcCall[] = [];

  function settle(result: FakeResult | undefined) {
    return { data: result?.data ?? null, error: result?.error ?? null, count: result?.count ?? null };
  }

  function from(table: string) {
    const call: QueryCall = { table, op: "select", filters: [] };
    let mutated = false;
    const builder: Record<string, unknown> = {
      select(columns?: string, options?: unknown) {
        if (mutated) call.returning = columns ?? "*";
        else {
          call.columns = columns ?? "*";
          call.selectOptions = options;
        }
        return builder;
      },
      insert(payload: unknown) {
        call.op = "insert";
        call.payload = payload;
        mutated = true;
        return builder;
      },
      update(payload: unknown) {
        call.op = "update";
        call.payload = payload;
        mutated = true;
        return builder;
      },
      delete() {
        call.op = "delete";
        mutated = true;
        return builder;
      },
      single() {
        call.single = "single";
        return builder;
      },
      maybeSingle() {
        call.single = "maybeSingle";
        return builder;
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        calls.push(call);
        return Promise.resolve(settle(respond(call))).then(onFulfilled, onRejected);
      },
    };
    for (const method of FILTER_METHODS) {
      builder[method] = (...args: unknown[]) => {
        call.filters.push([method, ...args]);
        return builder;
      };
    }
    return builder;
  }

  function rpc(fn: string, args: unknown) {
    const call: RpcCall = { fn, args };
    return {
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        rpcCalls.push(call);
        return Promise.resolve(settle(respondRpc(call))).then(onFulfilled, onRejected);
      },
    };
  }

  return { client: { from, rpc, ...extra } as unknown as TypedSupabaseClient, calls, rpcCalls };
}

/** The value of the first `.eq(column, value)` filter, if any. */
export function eqValue(call: QueryCall, column: string): unknown {
  return call.filters.find(([method, name]) => method === "eq" && name === column)?.[2];
}
