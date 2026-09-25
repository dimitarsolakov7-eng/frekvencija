import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeSignedUrlTtl,
  type CreateSignedUrlResult,
  MediaSigningError,
  mediaTtlFor,
  signStorageObject,
  type StorageSigningClient,
} from "@/lib/media/signing";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("computeSignedUrlTtl", () => {
  it("uses the configured TTL when it already covers the item", () => {
    // 3 min track: ceil(180 × 1.5) + 900 = 1170 < 7200
    expect(computeSignedUrlTtl(180, 7200)).toBe(7200);
  });

  it("extends the TTL for long items", () => {
    // 2 h mix: ceil(7200 × 1.5) + 900 = 11700
    expect(computeSignedUrlTtl(7200, 7200)).toBe(11_700);
    expect(computeSignedUrlTtl(100.2, 900)).toBe(Math.ceil(100.2 * 1.5) + 900);
  });

  it("clamps to 900–43200 seconds", () => {
    expect(computeSignedUrlTtl(0, 60)).toBe(900);
    expect(computeSignedUrlTtl(null, 10)).toBe(900);
    expect(computeSignedUrlTtl(100_000, 7200)).toBe(43_200);
    expect(computeSignedUrlTtl(10, 999_999)).toBe(43_200);
  });

  it("treats unknown or invalid durations as zero", () => {
    expect(computeSignedUrlTtl(undefined, 7200)).toBe(7200);
    expect(computeSignedUrlTtl(Number.NaN, 7200)).toBe(7200);
    expect(computeSignedUrlTtl(-50, 1000)).toBe(1000);
    expect(computeSignedUrlTtl(Number.POSITIVE_INFINITY, 1000)).toBe(1000);
  });

  it("always returns an integer", () => {
    expect(Number.isInteger(computeSignedUrlTtl(33.333, 1000.7))).toBe(true);
  });
});

describe("mediaTtlFor", () => {
  it("uses MEDIA_URL_TTL_SECONDS as the baseline", () => {
    vi.stubEnv("MEDIA_URL_TTL_SECONDS", "3600");
    expect(mediaTtlFor(60)).toBe(3600);
    expect(mediaTtlFor(3000)).toBe(5400);
  });
});

function fakeClient(result: CreateSignedUrlResult) {
  const createSignedUrl = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ createSignedUrl });
  return { client: { storage: { from } } as StorageSigningClient, from, createSignedUrl };
}

describe("signStorageObject", () => {
  it("returns the URL and an expiry computed from the request start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T10:00:00.000Z"));
    const { client, from, createSignedUrl } = fakeClient({
      data: { signedUrl: "https://ref.supabase.co/storage/v1/object/sign/music/tracks/a/b.mp3?token=t" },
      error: null,
    });
    const signed = await signStorageObject(client, "music", "tracks/a/b.mp3", 7200);
    expect(from).toHaveBeenCalledWith("music");
    expect(createSignedUrl).toHaveBeenCalledWith("tracks/a/b.mp3", 7200);
    expect(signed).toEqual({
      url: "https://ref.supabase.co/storage/v1/object/sign/music/tracks/a/b.mp3?token=t",
      expiresAt: "2026-09-25T12:00:00.000Z",
    });
  });

  it("throws a typed not-found error when RLS hides the object", async () => {
    const { client } = fakeClient({ data: null, error: { message: "Object not found", status: 400, statusCode: "404" } });
    const error = await signStorageObject(client, "announcements", "b/a/x.mp3", 900).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MediaSigningError);
    expect(error).toMatchObject({ bucket: "announcements", path: "b/a/x.mp3", notFound: true });
  });

  it("throws a non-not-found error for other failures", async () => {
    const { client } = fakeClient({ data: null, error: { message: "Internal error", status: 500, statusCode: "500" } });
    await expect(signStorageObject(client, "music", "tracks/a/b.mp3", 900)).rejects.toMatchObject({
      name: "MediaSigningError",
      notFound: false,
    });
  });

  it("wraps thrown network errors", async () => {
    const createSignedUrl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = { storage: { from: () => ({ createSignedUrl }) } } as StorageSigningClient;
    await expect(signStorageObject(client, "logos", "b/logo.png", 900)).rejects.toMatchObject({
      name: "MediaSigningError",
      notFound: false,
    });
  });

  it("rejects invalid lifetimes before calling Storage", async () => {
    const { client, createSignedUrl } = fakeClient({ data: { signedUrl: "x" }, error: null });
    await expect(signStorageObject(client, "music", "p", 0)).rejects.toBeInstanceOf(RangeError);
    await expect(signStorageObject(client, "music", "p", 1.5)).rejects.toBeInstanceOf(RangeError);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
