import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectPreservingSession, updateSession } from "@/lib/supabase/proxy";

type SetAll = (
  cookies: { name: string; value: string; options: Record<string, unknown> }[],
  headers: Record<string, string>,
) => void;

const { state } = vi.hoisted(() => ({
  state: {
    onGetClaims: (() => ({ data: null, error: null })) as (setAll: SetAll) => unknown,
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: SetAll } }) => ({
    auth: { getClaims: async () => state.onGetClaims(options.cookies.setAll) },
  }),
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("updateSession", () => {
  it("reports signed-out users without touching cookies", async () => {
    state.onGetClaims = () => ({ data: null, error: null });
    const { response, authenticated } = await updateSession(new NextRequest("http://localhost/radio"));
    expect(authenticated).toBe(false);
    expect(response.cookies.getAll()).toEqual([]);
  });

  it("keeps cookies and anti-cache headers from every setAll call", async () => {
    state.onGetClaims = (setAll) => {
      setAll(
        [{ name: "sb-abc-auth-token", value: "base64-first", options: { path: "/" } }],
        { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", Expires: "0", Pragma: "no-cache" },
      );
      // @supabase/ssr sends the headers only with the first write per client.
      setAll([{ name: "sb-abc-auth-token-code-verifier", value: "", options: { path: "/", maxAge: 0 } }], {});
      return { data: { claims: { sub: "user-1" } }, error: null };
    };
    const request = new NextRequest("http://localhost/radio");
    const { response, authenticated } = await updateSession(request);

    expect(authenticated).toBe(true);
    const names = response.cookies.getAll().map((cookie) => cookie.name).sort();
    expect(names).toEqual(["sb-abc-auth-token", "sb-abc-auth-token-code-verifier"]);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    // Server Components of this request see the refreshed cookie.
    expect(request.cookies.get("sb-abc-auth-token")?.value).toBe("base64-first");
  });

  it("returns unknown (null) when the auth service is unreachable", async () => {
    const { AuthRetryableFetchError } = await import("@supabase/supabase-js");
    state.onGetClaims = () => ({ data: null, error: new AuthRetryableFetchError("fetch failed", 0) });
    const { authenticated } = await updateSession(new NextRequest("http://localhost/admin"));
    expect(authenticated).toBeNull();
  });

  it("does not crash the request when getClaims throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.onGetClaims = () => {
      throw new Error("unexpected");
    };
    const { response, authenticated } = await updateSession(new NextRequest("http://localhost/admin"));
    expect(authenticated).toBeNull();
    expect(response.status).toBe(200);
    vi.restoreAllMocks();
  });
});

describe("redirectPreservingSession", () => {
  it("copies cookies and cache headers, 307 for GET and 303 for POST", () => {
    const source = NextResponse.next();
    source.cookies.set("sb-abc-auth-token", "", { maxAge: 0, path: "/" });
    source.headers.set("Cache-Control", "private, no-store");

    const get = redirectPreservingSession(source, new URL("http://localhost/login?next=%2Fadmin"), "GET");
    expect(get.status).toBe(307);
    expect(get.headers.get("location")).toBe("http://localhost/login?next=%2Fadmin");
    expect(get.cookies.get("sb-abc-auth-token")).toMatchObject({ value: "", maxAge: 0 });
    expect(get.headers.get("cache-control")).toBe("private, no-store");

    const post = redirectPreservingSession(source, new URL("http://localhost/login"), "POST");
    expect(post.status).toBe(303);
  });
});
