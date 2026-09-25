import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAnnouncements } from "@/app/api/player/announcements/route";
import { GET as getGenreTracks } from "@/app/api/player/genres/[genreId]/tracks/route";
import { PUT as putPreferences } from "@/app/api/player/preferences/route";
import { POST as postMediaSign } from "@/app/api/media/sign/route";
import { ACCESS_DENIAL_CASES, denyAccess, GENRE_JAZZ, jsonRequest, readError, TRACK_1, BUSINESS_ID } from "./helpers";

const { requireBusinessUserApi, consumeRateLimit } = vi.hoisted(() => ({
  requireBusinessUserApi: vi.fn(),
  consumeRateLimit: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireBusinessUserApi }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  consumeRateLimit,
}));

const ROUTES: readonly { name: string; call: () => Promise<Response> }[] = [
  {
    name: "GET /api/player/genres/[genreId]/tracks",
    call: () => getGenreTracks(new Request(`http://localhost/api/player/genres/${GENRE_JAZZ}/tracks`), { params: Promise.resolve({ genreId: GENRE_JAZZ }) }),
  },
  { name: "GET /api/player/announcements", call: () => getAnnouncements() },
  {
    name: "PUT /api/player/preferences",
    call: () => putPreferences(jsonRequest("/api/player/preferences", "PUT", { volume: 0.5, businessId: BUSINESS_ID })),
  },
  {
    name: "POST /api/media/sign",
    call: () => postMediaSign(jsonRequest("/api/media/sign", "POST", { kind: "track", id: TRACK_1, genreId: GENRE_JAZZ })),
  },
];

beforeEach(() => {
  requireBusinessUserApi.mockReset();
  consumeRateLimit.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(ROUTES)("$name access control", ({ call }) => {
  it.each(ACCESS_DENIAL_CASES)("passes the $code ($status) denial through unchanged", async (denial) => {
    requireBusinessUserApi.mockResolvedValue(denyAccess(denial.status, denial.code, denial.message));

    const error = await readError(await call());

    expect(error).toEqual({ status: denial.status, code: denial.code, message: denial.message });
    expect(requireBusinessUserApi).toHaveBeenCalledTimes(1);
    // Nothing else runs for a denied caller (no rate-limit bucket is consumed either).
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("answers an unexpected guard failure with a generic 500 that leaks nothing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    requireBusinessUserApi.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"));

    const response = await call();
    const text = await response.clone().text();
    const error = await readError(response);

    expect(error.status).toBe(500);
    expect(error.code).toBe("server_error");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("hunter2");
    expect(consoleError).toHaveBeenCalled();
  });
});
