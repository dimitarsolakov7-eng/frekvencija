/**
 * The "genre-cover" upload kind across the shared upload modules: limits, the sign request schema,
 * upload tokens, the browser request builder, and the Storage signing helpers used to display covers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signGenreCoverObject,
  signGenreCoverUrls,
  signStorageObjects,
  type BatchSignedUrlEntry,
  type StorageBatchSigningClient,
  type StorageSigningClient,
} from "@/lib/media/signing";
import { buildSignUploadRequest } from "@/lib/uploads/client";
import { createUploadToken, verifyUploadToken } from "@/lib/uploads/token";
import { checkUploadFile, MAX_GENRE_COVER_BYTES, UPLOAD_RULES } from "@/lib/validation/limits";
import { signUploadRequestSchema } from "@/lib/validation/uploads";

const ADMIN_ID = "5b1b3a52-37a4-4b8e-9d3c-6a8b2f1e0c11";
const GENRE_ID = "0f5b2d7e-1a2b-4c3d-8e4f-000000000001";
const COVER_PATH = `${GENRE_ID}/${"a".repeat(32)}.webp`;
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "fake_secret_test_key_for_genre_cover_uploads");
  vi.stubEnv("UPLOAD_TOKEN_SECRET", "");
  vi.stubEnv("MEDIA_URL_TTL_SECONDS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("genre cover limits", () => {
  it("matches the genre-covers bucket: 3 MB of PNG, JPEG or WebP", () => {
    expect(MAX_GENRE_COVER_BYTES).toBe(3_145_728);
    expect(UPLOAD_RULES["genre-cover"]).toEqual({ bucket: "genre-covers", maxBytes: 3_145_728, label: "Genre cover", media: "image" });
  });

  it("accepts the three image types with a canonical extension", () => {
    expect(checkUploadFile("genre-cover", { name: "house.PNG", size: 1000, type: "image/png" })).toEqual({
      ok: true,
      contentType: "image/png",
      extension: "png",
    });
    expect(checkUploadFile("genre-cover", { name: "house.jpeg", size: 1000, type: "" })).toMatchObject({ ok: true, extension: "jpg" });
    expect(checkUploadFile("genre-cover", { name: "house.webp", size: MAX_GENRE_COVER_BYTES, type: "image/webp" }).ok).toBe(true);
  });

  it("refuses other formats and files above 3 MB", () => {
    expect(checkUploadFile("genre-cover", { name: "house.gif", size: 1000, type: "image/gif" })).toMatchObject({ ok: false, code: "unsupported_media" });
    expect(checkUploadFile("genre-cover", { name: "house.svg", size: 1000, type: "image/svg+xml" })).toMatchObject({
      ok: false,
      code: "unsupported_media",
    });
    expect(checkUploadFile("genre-cover", { name: "house.png", size: MAX_GENRE_COVER_BYTES + 1, type: "image/png" })).toMatchObject({
      ok: false,
      code: "payload_too_large",
      message: expect.stringContaining("the genre cover limit is 3 MB"),
    });
  });
});

describe("sign request schema", () => {
  const file = { fileName: "house.png", fileSize: 1000, contentType: "image/png" };

  it("requires a genre id for a cover", () => {
    expect(signUploadRequestSchema.safeParse({ kind: "genre-cover", genreId: GENRE_ID, ...file }).success).toBe(true);
    expect(signUploadRequestSchema.safeParse({ kind: "genre-cover", ...file }).success).toBe(false);
    expect(signUploadRequestSchema.safeParse({ kind: "genre-cover", genreId: "house", ...file }).success).toBe(false);
  });

  it("names every kind when the kind is unknown", () => {
    const result = signUploadRequestSchema.safeParse({ kind: "banner", ...file });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("genre-cover");
  });
});

describe("upload tokens for covers", () => {
  it("round-trips a genre-cover token bound to the genre", () => {
    const token = createUploadToken(
      { kind: "genre-cover", bucket: "genre-covers", path: COVER_PATH, targetId: GENRE_ID, userId: ADMIN_ID },
      { now: NOW },
    );
    const result = verifyUploadToken(token, { now: NOW + 1000, expectedUserId: ADMIN_ID, expectedKind: "genre-cover" });
    expect(result).toMatchObject({ ok: true, payload: { kind: "genre-cover", bucket: "genre-covers", targetId: GENRE_ID } });
  });

  it("refuses inconsistent claims (wrong bucket, missing genre)", () => {
    expect(() =>
      createUploadToken({ kind: "genre-cover", bucket: "logos", path: COVER_PATH, targetId: GENRE_ID, userId: ADMIN_ID }, { now: NOW }),
    ).toThrow();
    expect(() =>
      createUploadToken({ kind: "genre-cover", bucket: "genre-covers", path: COVER_PATH, targetId: null, userId: ADMIN_ID }, { now: NOW }),
    ).toThrow();
  });
});

describe("browser request builder", () => {
  it("builds a genre-cover sign request from the chosen file", () => {
    const image = new File([new Uint8Array(5)], "house.webp", { type: "image/webp" });
    expect(buildSignUploadRequest({ kind: "genre-cover", genreId: GENRE_ID }, image)).toEqual({
      kind: "genre-cover",
      genreId: GENRE_ID,
      fileName: "house.webp",
      fileSize: 5,
      contentType: "image/webp",
    });
  });
});

describe("signing covers for display", () => {
  function batchClient(respond: (bucket: string, paths: string[], ttl: number) => Awaited<ReturnType<ReturnType<StorageBatchSigningClient["storage"]["from"]>["createSignedUrls"]>>) {
    const calls: { bucket: string; paths: string[]; ttl: number }[] = [];
    const client: StorageBatchSigningClient = {
      storage: {
        from: (bucket) => ({
          createSignedUrls: async (paths, ttl) => {
            calls.push({ bucket, paths, ttl });
            return respond(bucket, paths, ttl);
          },
        }),
      },
    };
    return { client, calls };
  }

  it("signs every distinct path in one request and maps the URLs by path", async () => {
    const { client, calls } = batchClient((_bucket, paths) => ({
      data: paths.map((path): BatchSignedUrlEntry => ({ path, error: null, signedUrl: `https://cdn.test/${path}` })),
      error: null,
    }));
    const urls = await signStorageObjects(client, "genre-covers", ["b.png", null, "a.png", "b.png", "", undefined], 600);
    expect(calls).toEqual([{ bucket: "genre-covers", paths: ["b.png", "a.png"], ttl: 600 }]);
    expect(urls).toEqual(
      new Map([
        ["b.png", "https://cdn.test/b.png"],
        ["a.png", "https://cdn.test/a.png"],
      ]),
    );
  });

  it("leaves out objects Storage could not sign, and never throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const partial = batchClient(() => ({
      data: [
        { path: "a.png", error: null, signedUrl: "https://cdn.test/a.png" },
        { path: "b.png", error: "Object not found", signedUrl: null },
      ],
      error: null,
    }));
    expect(await signStorageObjects(partial.client, "genre-covers", ["a.png", "b.png"], 600)).toEqual(new Map([["a.png", "https://cdn.test/a.png"]]));

    const failed = batchClient(() => ({ data: null, error: { message: "storage down" } }));
    expect(await signStorageObjects(failed.client, "genre-covers", ["a.png"], 600)).toEqual(new Map());

    const throwing: StorageBatchSigningClient = {
      storage: {
        from: () => ({
          createSignedUrls: async () => {
            throw new TypeError("fetch failed");
          },
        }),
      },
    };
    expect(await signStorageObjects(throwing, "genre-covers", ["a.png"], 600)).toEqual(new Map());
  });

  it("does not call Storage without paths", async () => {
    const { client, calls } = batchClient(() => ({ data: [], error: null }));
    expect(await signGenreCoverUrls(client, [null, ""])).toEqual(new Map());
    expect(calls).toEqual([]);
  });

  it("signs genre covers with the baseline lifetime", async () => {
    const { client, calls } = batchClient((_bucket, paths) => ({
      data: paths.map((path) => ({ path, error: null, signedUrl: `https://cdn.test/${path}` })),
      error: null,
    }));
    await signGenreCoverUrls(client, [COVER_PATH]);
    expect(calls).toEqual([{ bucket: "genre-covers", paths: [COVER_PATH], ttl: 7200 }]);
  });

  it("signs a single cover in the genre-covers bucket", async () => {
    const requests: { bucket: string; path: string; ttl: number }[] = [];
    const client: StorageSigningClient = {
      storage: {
        from: (bucket) => ({
          createSignedUrl: async (path, ttl) => {
            requests.push({ bucket, path, ttl });
            return { data: { signedUrl: `https://cdn.test/${path}` }, error: null };
          },
        }),
      },
    };
    const signed = await signGenreCoverObject(client, COVER_PATH);
    expect(signed.url).toBe(`https://cdn.test/${COVER_PATH}`);
    expect(requests).toEqual([{ bucket: "genre-covers", path: COVER_PATH, ttl: 7200 }]);
  });
});
