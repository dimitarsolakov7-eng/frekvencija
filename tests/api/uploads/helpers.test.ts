import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAnnouncementObjectPath,
  buildGenreCoverObjectPath,
  buildLogoObjectPath,
  buildTrackObjectPath,
  classifyStorageError,
  dbErrorResponse,
  isImageExtension,
  openUploadEnvelope,
  parseUploadObjectPath,
  pathMatchesTarget,
  sanitizeOriginalFileName,
  sealUploadEnvelope,
} from "@/lib/data/admin/uploads";
import { createUploadToken } from "@/lib/uploads/token";
import { BUSINESS_ID, DRAFT_ANNOUNCEMENT_ID, errorOf, GENRE_JAZZ, TRACK_ID } from "./fixtures";

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "fake_secret_test_key_for_upload_helper_tests");
  vi.stubEnv("UPLOAD_TOKEN_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("object paths", () => {
  it("builds the documented layouts with a 32-hex random name", () => {
    expect(buildTrackObjectPath(TRACK_ID)).toMatch(new RegExp(`^tracks/${TRACK_ID}/[0-9a-f]{32}\\.mp3$`));
    expect(buildAnnouncementObjectPath(BUSINESS_ID, DRAFT_ANNOUNCEMENT_ID)).toMatch(
      new RegExp(`^${BUSINESS_ID}/${DRAFT_ANNOUNCEMENT_ID}/[0-9a-f]{32}\\.mp3$`),
    );
    expect(buildLogoObjectPath(BUSINESS_ID, "webp")).toMatch(new RegExp(`^${BUSINESS_ID}/[0-9a-f]{32}\\.webp$`));
  });

  it("parses paths back per kind and checks them against the token target", () => {
    const track = parseUploadObjectPath("track-replace", buildTrackObjectPath(TRACK_ID));
    expect(track).toEqual({ kind: "track-replace", trackId: TRACK_ID });
    expect(track && pathMatchesTarget(track, TRACK_ID)).toBe(true);
    expect(track && pathMatchesTarget(track, BUSINESS_ID)).toBe(false);

    const fresh = parseUploadObjectPath("track", buildTrackObjectPath(TRACK_ID));
    expect(fresh && pathMatchesTarget(fresh, null)).toBe(true);

    const announcement = parseUploadObjectPath("announcement", buildAnnouncementObjectPath(BUSINESS_ID, DRAFT_ANNOUNCEMENT_ID));
    expect(announcement).toEqual({ kind: "announcement", businessId: BUSINESS_ID, announcementId: DRAFT_ANNOUNCEMENT_ID });
    expect(announcement && pathMatchesTarget(announcement, DRAFT_ANNOUNCEMENT_ID)).toBe(true);

    const logo = parseUploadObjectPath("logo", buildLogoObjectPath(BUSINESS_ID, "jpg"));
    expect(logo).toEqual({ kind: "logo", businessId: BUSINESS_ID, extension: "jpg" });
    expect(logo && pathMatchesTarget(logo, BUSINESS_ID)).toBe(true);
  });

  it("lays out genre covers as {genreId}/{random}.{ext} and checks them against the genre", () => {
    const path = buildGenreCoverObjectPath(GENRE_JAZZ, "webp");
    expect(path).toMatch(new RegExp(`^${GENRE_JAZZ}/[0-9a-f]{32}\\.webp$`));
    const cover = parseUploadObjectPath("genre-cover", path);
    expect(cover).toEqual({ kind: "genre-cover", genreId: GENRE_JAZZ, extension: "webp" });
    expect(cover && pathMatchesTarget(cover, GENRE_JAZZ)).toBe(true);
    expect(cover && pathMatchesTarget(cover, BUSINESS_ID)).toBe(false);
    expect(parseUploadObjectPath("genre-cover", `${GENRE_JAZZ}/${"a".repeat(32)}.gif`)).toBeNull();
    expect(parseUploadObjectPath("genre-cover", `covers/${GENRE_JAZZ}/${"a".repeat(32)}.png`)).toBeNull();
    expect(isImageExtension("jpg")).toBe(true);
    expect(isImageExtension("jpeg")).toBe(false);
  });

  it("rejects paths that do not have the layout of their kind", () => {
    expect(parseUploadObjectPath("track", `tracks/${TRACK_ID}/../x.mp3`)).toBeNull();
    expect(parseUploadObjectPath("track", `${BUSINESS_ID}/${"a".repeat(32)}.png`)).toBeNull();
    expect(parseUploadObjectPath("logo", `${BUSINESS_ID}/${"a".repeat(32)}.svg`)).toBeNull();
    expect(parseUploadObjectPath("announcement", buildTrackObjectPath(TRACK_ID))).toBeNull();
  });
});

describe("sanitizeOriginalFileName", () => {
  it("keeps ordinary names, including non-ASCII ones", () => {
    expect(sanitizeOriginalFileName("01 - Blue_Moon.mp3")).toBe("01 - Blue_Moon.mp3");
    expect(sanitizeOriginalFileName("Сливовица – Live.mp3")).toBe("Сливовица – Live.mp3");
  });

  it("drops client directories, control and bidi characters", () => {
    expect(sanitizeOriginalFileName("C:\\fakepath\\song.mp3")).toBe("song.mp3");
    expect(sanitizeOriginalFileName("evil\u202egnp.mp3")).toBe("evil gnp.mp3");
    expect(sanitizeOriginalFileName("a\u0000b\tc\n.mp3")).toBe("a b c .mp3");
    expect(sanitizeOriginalFileName("\u200b\u0007 ")).toBeNull();
  });

  it("caps the length at 255 without splitting a surrogate pair", () => {
    const long = `${"a".repeat(254)}😀tail.mp3`;
    const cleaned = sanitizeOriginalFileName(long);
    expect(cleaned).toBe("a".repeat(254));
    expect(sanitizeOriginalFileName("b".repeat(300))?.length).toBe(255);
  });
});

describe("upload envelope", () => {
  function token() {
    return createUploadToken({
      kind: "track-replace",
      bucket: "music",
      path: buildTrackObjectPath(TRACK_ID),
      targetId: TRACK_ID,
      userId: "0a1b2c3d-0000-4000-8000-00000000a001",
    });
  }

  it("round-trips the inner token and the file name", () => {
    const inner = token();
    expect(openUploadEnvelope(sealUploadEnvelope(inner, "Mañana.mp3"))).toEqual({ ok: true, uploadToken: inner, originalFileName: "Mañana.mp3" });
    expect(openUploadEnvelope(sealUploadEnvelope(inner, null))).toEqual({ ok: true, uploadToken: inner, originalFileName: null });
  });

  it("stays within the 4096-character limit of the complete request for the longest name", () => {
    const envelope = sealUploadEnvelope(token(), "😀".repeat(200));
    expect(envelope.length).toBeLessThan(4096);
    expect(openUploadEnvelope(envelope).ok).toBe(true);
  });

  it("rejects a changed name, a changed inner token and malformed input", () => {
    const envelope = sealUploadEnvelope(token(), "song.mp3");
    const parts = envelope.split(".");

    const renamed = [...parts];
    renamed[2] = Buffer.from("other.mp3").toString("base64url");
    expect(openUploadEnvelope(renamed.join("."))).toEqual({ ok: false, reason: "bad_signature" });

    const swapped = [...parts];
    swapped[0] = `${swapped[0][0] === "e" ? "f" : "e"}${swapped[0].slice(1)}`;
    expect(openUploadEnvelope(swapped.join("."))).toEqual({ ok: false, reason: "bad_signature" });

    expect(openUploadEnvelope(`${parts[0]}.${parts[1]}`)).toEqual({ ok: false, reason: "malformed" });
    expect(openUploadEnvelope(`${parts[0]}.${parts[1]}.a b.${parts[3]}`)).toEqual({ ok: false, reason: "malformed" });
  });

  it("is keyed separately from the foundation token secret label", () => {
    const envelope = sealUploadEnvelope(token(), "song.mp3");
    vi.stubEnv("SUPABASE_SECRET_KEY", "fake_secret_a_completely_different_key_value");
    expect(openUploadEnvelope(envelope)).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("classifyStorageError", () => {
  it("classifies Storage API errors by statusCode first", () => {
    expect(classifyStorageError({ status: 400, statusCode: "404", message: "Object not found" })).toBe("not_found");
    expect(classifyStorageError({ status: 400, statusCode: "403", message: "new row violates row-level security policy" })).toBe("forbidden");
    expect(classifyStorageError({ status: 400, statusCode: "409", message: "The resource already exists" })).toBe("conflict");
    expect(classifyStorageError({ status: 400, statusCode: "413", message: "too big" })).toBe("too_large");
    expect(classifyStorageError({ status: 400, statusCode: "415", message: "mime type not supported" })).toBe("unsupported");
    expect(classifyStorageError({ status: 503, statusCode: "503", message: "unavailable" })).toBe("unavailable");
    expect(classifyStorageError({ name: "StorageUnknownError", message: "fetch failed" })).toBe("unavailable");
    expect(classifyStorageError({ status: 400, statusCode: "400", message: "odd" })).toBe("unknown");
    expect(classifyStorageError(null)).toBe("unknown");
  });
});

describe("dbErrorResponse", () => {
  it("maps PostgREST codes to honest statuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await errorOf(dbErrorResponse("t", { code: "42501", message: "denied" }))).toMatchObject({ status: 403, code: "forbidden" });
    expect(await errorOf(dbErrorResponse("t", { code: "PGRST116", message: "none" }))).toMatchObject({ status: 404, code: "not_found" });
    expect(await errorOf(dbErrorResponse("t", { code: "23505", message: "dup" }))).toMatchObject({ status: 409, code: "conflict" });
    expect(await errorOf(dbErrorResponse("t", { code: "23514", message: "check" }))).toMatchObject({ status: 400, code: "invalid_request" });
    const unknown = await errorOf(dbErrorResponse("t", { code: "", message: "TypeError: fetch failed" }));
    expect(unknown).toMatchObject({ status: 500, code: "server_error" });
    expect(unknown.message).not.toContain("fetch failed");
  });
});
