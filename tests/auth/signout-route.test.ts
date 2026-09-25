import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCookieStore } from "./auth-mocks";
import { GET, POST } from "@/app/auth/signout/route";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

const signOut = vi.fn();

function post(headers: Record<string, string> = { origin: "https://radio.example.com", host: "radio.example.com" }) {
  return new Request("https://radio.example.com/auth/signout", { method: "POST", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.createSupabaseServerClient.mockResolvedValue({ auth: { signOut } });
  signOut.mockResolvedValue({ error: null });
});

describe("POST /auth/signout", () => {
  it("signs out this device only and redirects to /login with 303", async () => {
    const response = await POST(post());
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("clears the session cookies itself when Supabase could not sign out", async () => {
    const store = fakeCookieStore([
      { name: "sb-abc-auth-token", value: "x" },
      { name: "sb-abc-auth-token.0", value: "x" },
      { name: "sb-abc-auth-token.1", value: "x" },
      { name: "sb-abc-auth-token-code-verifier", value: "keep" },
      { name: "theme", value: "dark" },
    ]);
    mocks.cookies.mockResolvedValue(store);
    signOut.mockResolvedValue({ error: new AuthRetryableFetchError("down", 503) });

    const response = await POST(post());
    expect(response.status).toBe(303);
    expect([...store.jar.keys()]).toEqual(["sb-abc-auth-token-code-verifier", "theme"]);
  });

  it("still redirects when the client cannot be created", async () => {
    mocks.cookies.mockResolvedValue(fakeCookieStore([]));
    mocks.createSupabaseServerClient.mockRejectedValue(new Error("env missing"));
    const response = await POST(post());
    expect(response.status).toBe(303);
  });

  it("allows same-origin requests without an Origin header and behind a proxy host", async () => {
    expect((await POST(post({}))).status).toBe(303);
    expect(
      (await POST(post({ origin: "https://radio.example.com", host: "internal:3000", "x-forwarded-host": "radio.example.com" }))).status,
    ).toBe(303);
  });

  it("refuses cross-site sign-out posts", async () => {
    const response = await POST(post({ origin: "https://evil.example", host: "radio.example.com" }));
    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("GET /auth/signout", () => {
  it("is not allowed", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
