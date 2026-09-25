import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "@/lib/api/contracts";
import { consumeRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";

const { rpc, createSupabaseAdminClient } = vi.hoisted(() => {
  const rpc = vi.fn();
  return { rpc, createSupabaseAdminClient: vi.fn(() => ({ rpc })) };
});
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient }));

const options = { key: "upload-sign:user-1", max: 120, windowSeconds: 600 };

beforeEach(() => {
  rpc.mockReset();
  createSupabaseAdminClient.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consumeRateLimit", () => {
  it("calls consume_rate_limit with the bucket parameters", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(consumeRateLimit({ ...options, failClosed: false })).resolves.toEqual({ allowed: true, degraded: false });
    expect(rpc).toHaveBeenCalledWith("consume_rate_limit", { p_key: "upload-sign:user-1", p_max: 120, p_window_seconds: 600 });
  });

  it("denies when the bucket is exhausted", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(consumeRateLimit({ ...options, failClosed: false })).resolves.toEqual({ allowed: false, reason: "limited" });
  });

  it("fails open with a warning when the RPC errors and failClosed is false", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(consumeRateLimit({ ...options, failClosed: false })).resolves.toEqual({ allowed: true, degraded: true });
    expect(console.warn).toHaveBeenCalled();
  });

  it("fails closed when asked to", async () => {
    rpc.mockRejectedValue(new TypeError("fetch failed"));
    await expect(consumeRateLimit({ ...options, failClosed: true })).resolves.toEqual({ allowed: false, reason: "unavailable" });
  });

  it("treats a missing secret key as a limiter failure", async () => {
    createSupabaseAdminClient.mockImplementationOnce(() => {
      throw new Error("SUPABASE_SECRET_KEY is not set");
    });
    await expect(consumeRateLimit({ ...options, failClosed: true })).resolves.toEqual({ allowed: false, reason: "unavailable" });
  });

  it("treats a non-boolean answer as a failure", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(consumeRateLimit({ ...options, failClosed: true })).resolves.toEqual({ allowed: false, reason: "unavailable" });
  });

  it("rejects invalid parameters as programming errors", async () => {
    await expect(consumeRateLimit({ key: "", max: 1, windowSeconds: 1, failClosed: false })).rejects.toBeInstanceOf(RangeError);
    await expect(consumeRateLimit({ key: "k", max: 0, windowSeconds: 1, failClosed: false })).rejects.toBeInstanceOf(RangeError);
    await expect(consumeRateLimit({ key: "k", max: 1, windowSeconds: 1.5, failClosed: false })).rejects.toBeInstanceOf(RangeError);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("rateLimitErrorResponse", () => {
  it("returns 429 rate_limited with Retry-After", async () => {
    const response = rateLimitErrorResponse({ allowed: false, reason: "limited" }, 30);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(((await response.json()) as ApiErrorBody).error.code).toBe("rate_limited");
  });

  it("returns 503 unavailable when the limiter failed closed", async () => {
    const response = rateLimitErrorResponse({ allowed: false, reason: "unavailable" });
    expect(response.status).toBe(503);
    expect(((await response.json()) as ApiErrorBody).error.code).toBe("unavailable");
  });
});
