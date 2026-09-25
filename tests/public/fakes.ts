/**
 * Minimal fakes of the supabase-js calls made by src/lib/data/public.ts and the request-access action.
 * Query builders are thenables, like PostgREST builders, so `await client.from(...).select(...)...` works.
 */
import { vi } from "vitest";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

export interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

export interface GenreRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  cover_path: string | null;
}

export type SignedUrlsResult =
  | { data: { path: string | null; signedUrl: string | null; signedURL: string | null; error: string | null }[]; error: null }
  | { data: null; error: { message: string } };

export function signedCoverUrl(path: string): string {
  return `https://abc.supabase.co/storage/v1/object/sign/genre-covers/${path}?token=t`;
}

export interface FakeClientOptions {
  /** Result of the genres query. */
  genres?: { data: GenreRow[] | null; error: { message: string; code?: string } | null };
  /** Result of createSignedUrls (default: every path signed). */
  signed?: (paths: string[]) => SignedUrlsResult;
  /** Result of the platform_settings query. */
  settings?: { data: Record<string, unknown> | null; error: { message: string } | null };
  /** Result of the access_requests insert. */
  insert?: () => Promise<{ error: { code?: string; message: string } | null }>;
}

export function createFakeClient(options: FakeClientOptions = {}) {
  const calls: RecordedCall[] = [];
  const inserted: Record<string, unknown>[] = [];

  const createSignedUrls = vi.fn(async (paths: string[], expiresIn: number) => {
    calls.push({ table: "storage:genre-covers", method: "createSignedUrls", args: [paths, expiresIn] });
    if (options.signed) return options.signed(paths);
    return {
      data: paths.map((path) => ({ path, signedUrl: signedCoverUrl(path), signedURL: signedCoverUrl(path), error: null })),
      error: null,
    };
  });

  function builder(table: string) {
    const result = (): unknown => {
      if (table === "genres") return options.genres ?? { data: [], error: null };
      if (table === "platform_settings") return options.settings ?? { data: null, error: null };
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    }
    chain.maybeSingle = async () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return result();
    };
    chain.insert = async (payload: Record<string, unknown>) => {
      calls.push({ table, method: "insert", args: [payload] });
      inserted.push(payload);
      return options.insert ? options.insert() : { error: null };
    };
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return chain;
  }

  const from = vi.fn((table: string) => builder(table));
  const storageFrom = vi.fn(() => ({ createSignedUrls }));
  const client = { from, storage: { from: storageFrom } } as unknown as TypedSupabaseClient;
  return { client, calls, inserted, from, storageFrom, createSignedUrls };
}
