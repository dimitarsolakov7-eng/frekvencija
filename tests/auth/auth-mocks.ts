/**
 * Shared fakes for the auth Server Action / route tests. Each test file calls vi.mock itself (vi.mock
 * is hoisted per file) and wires these helpers in.
 */
import { vi } from "vitest";

/** Thrown by the mocked next/navigation redirect(), like the real one throws NEXT_REDIRECT. */
export class RedirectSignal extends Error {
  readonly url: string;
  /** true for permanentRedirect() (308), false for redirect() (307/303). */
  readonly permanent: boolean;

  constructor(url: string, permanent = false) {
    super(`REDIRECT:${url}`);
    this.name = "RedirectSignal";
    this.url = url;
    this.permanent = permanent;
  }
}

/** Factory for `vi.mock("next/navigation", mockNavigation)`. */
export async function mockNavigation() {
  return {
    redirect: (url: string): never => {
      throw new RedirectSignal(url);
    },
    permanentRedirect: (url: string): never => {
      throw new RedirectSignal(url, true);
    },
  };
}

/** Like captureRedirect, but also reports whether the redirect was permanent. */
export async function captureRedirectSignal(run: () => unknown): Promise<RedirectSignal> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RedirectSignal) return error;
    throw error;
  }
  throw new Error("Expected a redirect, but the call returned normally.");
}

export async function captureRedirect(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  throw new Error("Expected a redirect, but the call returned normally.");
}

export function formData(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

export function fakeHeaders(values: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

export interface FakeCookie {
  name: string;
  value: string;
}

export function fakeCookieStore(initial: FakeCookie[]) {
  const jar = new Map(initial.map((cookie) => [cookie.name, cookie.value]));
  return {
    jar,
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: vi.fn((name: string, value: string) => void jar.set(name, value)),
    delete: vi.fn((name: string) => void jar.delete(name)),
  };
}

export const ADMIN_CTX = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.com",
  role: "platform_admin" as const,
  business: null,
};

export const VENUE_CTX = {
  userId: "22222222-2222-4222-8222-222222222222",
  email: "venue@example.com",
  role: "business_user" as const,
  business: { id: "b1", name: "EmeraldBar", stationName: "EmeraldBar Radio", isActive: true },
};
