import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsOptionsResponse } from "@/lib/api/contracts";
import { ElevenLabsError } from "@/lib/tts/elevenlabs";
import { FakeSupabase } from "./fake-supabase";
import { ADMIN_ID, configuredOptions, errorOf, seedWorld, VENUE_USER_ID } from "./fixtures";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeSupabase,
  consumeRateLimit: vi.fn(),
  getTtsOptions: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => h.db.client("user") }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => h.db.client("admin") }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  consumeRateLimit: h.consumeRateLimit,
}));
vi.mock("@/lib/tts/options", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tts/options")>()),
  getTtsOptions: h.getTtsOptions,
}));

const { GET } = await import("@/app/api/admin/tts/options/route");

function options(query = "") {
  return GET(new Request(`http://localhost/api/admin/tts/options${query}`));
}

beforeEach(() => {
  h.db = new FakeSupabase();
  seedWorld(h.db);
  h.db.currentUserId = ADMIN_ID;
  h.consumeRateLimit.mockReset().mockResolvedValue({ allowed: true, degraded: false });
  h.getTtsOptions.mockReset().mockResolvedValue(configuredOptions());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/tts/options", () => {
  it("requires an admin", async () => {
    h.db.currentUserId = null;
    expect(await errorOf(await options())).toMatchObject({ status: 401, code: "unauthenticated" });
    h.db.currentUserId = VENUE_USER_ID;
    expect(await errorOf(await options())).toMatchObject({ status: 403, code: "forbidden" });
    expect(h.getTtsOptions).not.toHaveBeenCalled();
  });

  it("returns the configured options with no-store caching", async () => {
    const response = await options();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await response.json()) as TtsOptionsResponse;
    expect(body).toMatchObject({ configured: true, defaultModelId: "eleven_multilingual_v2" });
    expect(h.getTtsOptions).toHaveBeenCalledWith({ forceRefresh: false });
    expect(h.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("returns configured:false with the reason when no key is set (200, so the UI can explain uploads still work)", async () => {
    h.getTtsOptions.mockResolvedValue({ configured: false, reason: "Text-to-speech is not configured." });
    const response = await options();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false, reason: "Text-to-speech is not configured." });
  });

  it.each([
    ["rate_limited", 429, "rate_limited"],
    ["provider_unavailable", 502, "tts_failed"],
    ["timeout", 504, "tts_failed"],
  ] as const)("maps a transient %s failure to %i %s", async (kind, status, code) => {
    h.getTtsOptions.mockRejectedValue(new ElevenLabsError(kind, `ElevenLabs: ${kind}`));
    expect(await errorOf(await options())).toMatchObject({ status, code });
  });

  it("forces a refresh with ?refresh=1, rate-limited per admin", async () => {
    await options("?refresh=1");
    expect(h.getTtsOptions).toHaveBeenCalledWith({ forceRefresh: true });
    expect(h.consumeRateLimit).toHaveBeenCalledWith({ key: `tts-options-refresh:${ADMIN_ID}`, max: 10, windowSeconds: 600, failClosed: false });

    h.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "limited" });
    expect(await errorOf(await options("?refresh=1"))).toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("answers a generic 500 for unexpected errors", async () => {
    h.getTtsOptions.mockRejectedValue(new Error("boom"));
    expect(await errorOf(await options())).toMatchObject({ status: 500, code: "server_error" });
  });
});
