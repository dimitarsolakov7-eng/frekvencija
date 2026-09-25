import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "@/lib/api/contracts";
import {
  loadSessionContext,
  requireAdminApi,
  requireAdminPage,
  requireBusinessUserApi,
  requireBusinessUserPage,
  SessionLookupError,
} from "@/lib/auth/session";
import { EnvError } from "@/lib/env";
import type { TypedSupabaseClient } from "@/lib/supabase/types";

const { createSupabaseServerClient } = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

type QueryResult = { data: unknown; error: unknown };

interface FakeOptions {
  claims?: { sub: string; email?: string } | null;
  claimsError?: unknown;
  profile?: QueryResult;
  membership?: QueryResult;
}

const USER_ID = "7d3c1f0e-5a4b-4c2d-9e8f-1a2b3c4d5e6f";

function fakeClient(options: FakeOptions): TypedSupabaseClient {
  const results: Record<string, QueryResult> = {
    profiles: options.profile ?? { data: { email: "venue@example.com", role: "business_user" }, error: null },
    business_members: options.membership ?? {
      data: { business_id: "b1", businesses: { id: "b1", name: "EmeraldBar", station_name: "EmeraldBar Radio", is_active: true } },
      error: null,
    },
  };
  const builder = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => results[table],
    };
    return chain;
  };
  return {
    auth: {
      getClaims: async () =>
        options.claims
          ? { data: { claims: options.claims }, error: null }
          : { data: null, error: options.claimsError ?? null },
    },
    from: builder,
  } as unknown as TypedSupabaseClient;
}

async function errorOf(response: Response) {
  return { status: response.status, ...((await response.json()) as ApiErrorBody).error };
}

beforeEach(() => {
  createSupabaseServerClient.mockReset();
});

describe("loadSessionContext", () => {
  it("returns null when signed out", async () => {
    await expect(loadSessionContext(fakeClient({ claims: null }))).resolves.toBeNull();
  });

  it("maps profile and membership into the session context", async () => {
    await expect(loadSessionContext(fakeClient({ claims: { sub: USER_ID } }))).resolves.toEqual({
      userId: USER_ID,
      email: "venue@example.com",
      role: "business_user",
      business: { id: "b1", name: "EmeraldBar", stationName: "EmeraldBar Radio", isActive: true },
    });
  });

  it("returns business null without a membership", async () => {
    const ctx = await loadSessionContext(
      fakeClient({
        claims: { sub: USER_ID },
        profile: { data: { email: "admin@example.com", role: "platform_admin" }, error: null },
        membership: { data: null, error: null },
      }),
    );
    expect(ctx).toMatchObject({ role: "platform_admin", business: null });
  });

  it("throws instead of guessing when lookups fail", async () => {
    await expect(
      loadSessionContext(fakeClient({ claims: { sub: USER_ID }, profile: { data: null, error: { message: "boom" } } })),
    ).rejects.toMatchObject({ reason: "query_failed" });
    await expect(
      loadSessionContext(fakeClient({ claims: { sub: USER_ID }, profile: { data: null, error: null } })),
    ).rejects.toMatchObject({ reason: "profile_missing" });
    await expect(
      loadSessionContext(fakeClient({ claims: null, claimsError: new AuthRetryableFetchError("offline", 0) })),
    ).rejects.toBeInstanceOf(SessionLookupError);
  });
});

describe("API guards", () => {
  it("requireBusinessUserApi returns ctx and client for an active venue user", async () => {
    const client = fakeClient({ claims: { sub: USER_ID } });
    createSupabaseServerClient.mockResolvedValue(client);
    const access = await requireBusinessUserApi();
    expect(access.ok).toBe(true);
    if (access.ok) {
      expect(access.supabase).toBe(client);
      expect(access.ctx.business.id).toBe("b1");
    }
  });

  it.each([
    [{ claims: null }, 401, "unauthenticated"],
    [
      { claims: { sub: USER_ID }, profile: { data: { email: "a@x", role: "platform_admin" }, error: null } },
      403,
      "forbidden",
    ],
    [{ claims: { sub: USER_ID }, membership: { data: null, error: null } }, 403, "no_business"],
    [
      {
        claims: { sub: USER_ID },
        membership: {
          data: { business_id: "b1", businesses: { id: "b1", name: "E", station_name: "E Radio", is_active: false } },
          error: null,
        },
      },
      403,
      "business_inactive",
    ],
    [{ claims: { sub: USER_ID }, profile: { data: null, error: null } }, 401, "unauthenticated"],
    [{ claims: null, claimsError: new AuthRetryableFetchError("offline", 0) }, 503, "unavailable"],
    [{ claims: { sub: USER_ID }, membership: { data: null, error: { message: "db down" } } }, 500, "server_error"],
  ] as const)("requireBusinessUserApi denies %# with %i %s", async (options, status, code) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createSupabaseServerClient.mockResolvedValue(fakeClient(options as FakeOptions));
    const access = await requireBusinessUserApi();
    expect(access.ok).toBe(false);
    if (!access.ok) {
      expect(await errorOf(access.response)).toMatchObject({ status, code });
      expect(access.response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("requireAdminApi allows admins and forbids venue users", async () => {
    createSupabaseServerClient.mockResolvedValue(
      fakeClient({ claims: { sub: USER_ID }, profile: { data: { email: "a@x", role: "platform_admin" }, error: null } }),
    );
    expect((await requireAdminApi()).ok).toBe(true);

    createSupabaseServerClient.mockResolvedValue(fakeClient({ claims: { sub: USER_ID } }));
    const denied = await requireAdminApi();
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(await errorOf(denied.response)).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("answers 503 when Supabase is not configured", async () => {
    createSupabaseServerClient.mockRejectedValue(new EnvError("NEXT_PUBLIC_SUPABASE_URL", "missing"));
    const access = await requireAdminApi();
    expect(access.ok).toBe(false);
    if (!access.ok) expect(await errorOf(access.response)).toMatchObject({ status: 503, code: "unavailable" });
  });
});

describe("page guards", () => {
  it("redirect signed-out users to /login with next", async () => {
    createSupabaseServerClient.mockResolvedValue(fakeClient({ claims: null }));
    await expect(requireAdminPage()).rejects.toThrow("REDIRECT:/login?next=%2Fadmin");
    await expect(requireBusinessUserPage()).rejects.toThrow("REDIRECT:/login?next=%2Fradio");
  });

  it("send venue users away from admin pages and admins away from venue pages", async () => {
    createSupabaseServerClient.mockResolvedValue(fakeClient({ claims: { sub: USER_ID } }));
    await expect(requireAdminPage()).rejects.toThrow("REDIRECT:/");

    createSupabaseServerClient.mockResolvedValue(
      fakeClient({ claims: { sub: USER_ID }, profile: { data: { email: "a@x", role: "platform_admin" }, error: null } }),
    );
    await expect(requireBusinessUserPage()).rejects.toThrow("REDIRECT:/admin");
  });

  it("requireBusinessUserPage returns the context even for an inactive venue", async () => {
    createSupabaseServerClient.mockResolvedValue(
      fakeClient({
        claims: { sub: USER_ID },
        membership: {
          data: { business_id: "b1", businesses: { id: "b1", name: "E", station_name: "E Radio", is_active: false } },
          error: null,
        },
      }),
    );
    await expect(requireBusinessUserPage()).resolves.toMatchObject({ business: { isActive: false } });
  });
});
