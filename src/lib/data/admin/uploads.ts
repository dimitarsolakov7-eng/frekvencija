import "server-only";
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { UploadKind } from "@/lib/api/contracts";
import { describeDbError } from "@/lib/actions/state";
import { jsonError, jsonServerError } from "@/lib/api/http";
import { EnvError, getServerEnv } from "@/lib/env";
import type { StorageBucket, TypedSupabaseClient } from "@/lib/supabase/types";
import type { UploadTokenFailure } from "@/lib/uploads/token";
import { MAX_FILE_NAME_LENGTH } from "@/lib/validation/limits";

/**
 * Server helpers for the admin upload API (POST /api/admin/uploads/sign and /complete,
 * docs/ARCHITECTURE.md §8): object-path layout, the original-file-name envelope around the upload
 * token, and honest mapping of Storage/Postgres failures.
 *
 * ORIGINAL FILE NAME
 * The foundation upload token (src/lib/uploads/token.ts) binds kind/bucket/path/target/admin/expiry in a
 * strict payload with no room for the original file name, and CompleteUploadRequest has no field for
 * it either. So the sign endpoint returns, as the opaque `uploadToken`, an envelope
 *
 *     <foundation payload>.<foundation signature>.<base64url(UTF-8 file name)>.<envelope MAC>
 *
 * where the envelope MAC is HMAC-SHA256 over everything before it, keyed with a key derived (HKDF,
 * separate label) from the same secret as the foundation token. The complete endpoint opens the
 * envelope, then verifies the inner token as usual. Browser code passes the value back untouched
 * (uploadFile() already does), so nothing in the client changes. The name is sanitised when sealed
 * and again when opened (basename only, no control/bidi characters, ≤ 255 characters).
 */

// ---------------------------------------------------------------------------
// Object paths (docs/ARCHITECTURE.md §5.6)
// ---------------------------------------------------------------------------

/** Canonical object-path extension of an image upload (logos and genre covers). */
export type ImageExtension = "png" | "jpg" | "webp";
/** @deprecated Same as ImageExtension (kept for existing callers). */
export type LogoExtension = ImageExtension;

export const IMAGE_CONTENT_TYPE_BY_EXTENSION: Readonly<Record<ImageExtension, "image/png" | "image/jpeg" | "image/webp">> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};
/** Same as IMAGE_CONTENT_TYPE_BY_EXTENSION (kept for existing callers). */
export const LOGO_CONTENT_TYPE_BY_EXTENSION = IMAGE_CONTENT_TYPE_BY_EXTENSION;

export function isImageExtension(value: string): value is ImageExtension {
  return value === "png" || value === "jpg" || value === "webp";
}
/** Same as isImageExtension (kept for existing callers). */
export const isLogoExtension = isImageExtension;

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const OBJECT_NAME = "[0-9a-f]{32}";
const TRACK_PATH = new RegExp(`^tracks/(${UUID})/${OBJECT_NAME}\\.mp3$`);
const ANNOUNCEMENT_PATH = new RegExp(`^(${UUID})/(${UUID})/${OBJECT_NAME}\\.mp3$`);
/** `{ownerId}/{random}.{png|jpg|webp}`: logos (owner = business) and genre covers (owner = genre). */
const IMAGE_PATH = new RegExp(`^(${UUID})/${OBJECT_NAME}\\.(png|jpg|webp)$`);

/** 32 random hex characters: an ASCII-safe, unguessable object name that is never reused. */
export function randomObjectName(): string {
  return randomBytes(16).toString("hex");
}

/** `tracks/{trackId}/{random}.mp3` in bucket `music`. */
export function buildTrackObjectPath(trackId: string): string {
  return `tracks/${trackId}/${randomObjectName()}.mp3`;
}

/** `{businessId}/{announcementId}/{random}.mp3` in bucket `announcements`. */
export function buildAnnouncementObjectPath(businessId: string, announcementId: string): string {
  return `${businessId}/${announcementId}/${randomObjectName()}.mp3`;
}

/** `{businessId}/{random}.{png|jpg|webp}` in bucket `logos`. */
export function buildLogoObjectPath(businessId: string, extension: ImageExtension): string {
  return `${businessId}/${randomObjectName()}.${extension}`;
}

/** `{genreId}/{random}.{png|jpg|webp}` in bucket `genre-covers`. */
export function buildGenreCoverObjectPath(genreId: string, extension: ImageExtension): string {
  return `${genreId}/${randomObjectName()}.${extension}`;
}

export type UploadPathParts =
  | { kind: "track" | "track-replace"; trackId: string }
  | { kind: "announcement"; businessId: string; announcementId: string }
  | { kind: "logo"; businessId: string; extension: ImageExtension }
  | { kind: "genre-cover"; genreId: string; extension: ImageExtension };

/**
 * Splits an object path issued by the sign endpoint back into its ids. Returns null when the path does
 * not have the layout of its kind (the path comes from a signed token, so this is defence in depth).
 */
export function parseUploadObjectPath(kind: UploadKind, path: string): UploadPathParts | null {
  switch (kind) {
    case "track":
    case "track-replace": {
      const match = TRACK_PATH.exec(path);
      return match ? { kind, trackId: match[1] } : null;
    }
    case "announcement": {
      const match = ANNOUNCEMENT_PATH.exec(path);
      return match ? { kind, businessId: match[1], announcementId: match[2] } : null;
    }
    case "logo": {
      const match = IMAGE_PATH.exec(path);
      return match && isImageExtension(match[2]) ? { kind, businessId: match[1], extension: match[2] } : null;
    }
    case "genre-cover": {
      const match = IMAGE_PATH.exec(path);
      return match && isImageExtension(match[2]) ? { kind, genreId: match[1], extension: match[2] } : null;
    }
  }
}

/** True when the ids in the path agree with the token's `targetId` (null only for a new track). */
export function pathMatchesTarget(parts: UploadPathParts, targetId: string | null): boolean {
  switch (parts.kind) {
    case "track":
      return targetId === null;
    case "track-replace":
      return parts.trackId === targetId;
    case "announcement":
      return parts.announcementId === targetId;
    case "logo":
      return parts.businessId === targetId;
    case "genre-cover":
      return parts.genreId === targetId;
  }
}

// ---------------------------------------------------------------------------
// Original file name
// ---------------------------------------------------------------------------

/** Control characters, zero-width/bidi formatting characters and separators that must not be stored. */
function isUnsafeCodePoint(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff ||
    (code >= 0xd800 && code <= 0xdfff) // lone surrogate halves
  );
}

/**
 * The name to store in `tracks.original_filename`: base name only (no client directory), unsafe
 * characters replaced by spaces, whitespace collapsed, at most 255 UTF-16 units without splitting a
 * surrogate pair. Null when nothing printable remains.
 */
export function sanitizeOriginalFileName(value: string): string | null {
  const base = value.split(/[\\/]/).pop() ?? "";
  let printable = "";
  for (const char of base) {
    printable += isUnsafeCodePoint(char.codePointAt(0) ?? 0) ? " " : char;
  }
  const cleaned = printable.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= MAX_FILE_NAME_LENGTH) return cleaned;
  let out = "";
  for (const char of cleaned) {
    if (out.length + char.length > MAX_FILE_NAME_LENGTH) break;
    out += char;
  }
  return out.trimEnd() || null;
}

// ---------------------------------------------------------------------------
// Upload envelope (foundation token + original file name)
// ---------------------------------------------------------------------------

const ENVELOPE_KEY_INFO = "venue-radio/upload-token/file-name-envelope/v1";
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function envelopeKey(): Buffer {
  const env = getServerEnv();
  const secret = env.uploadTokenSecret ?? env.supabaseSecretKey;
  if (!secret) {
    throw new EnvError(
      "UPLOAD_TOKEN_SECRET",
      "Upload tokens need UPLOAD_TOKEN_SECRET or SUPABASE_SECRET_KEY (legacy: SUPABASE_SERVICE_ROLE_KEY) to be set.",
    );
  }
  return Buffer.from(hkdfSync("sha256", secret, "", ENVELOPE_KEY_INFO, 32));
}

function envelopeMac(body: string): Buffer {
  return createHmac("sha256", envelopeKey()).update(body).digest();
}

/** Wraps a foundation upload token together with the (sanitised) original file name. */
export function sealUploadEnvelope(uploadToken: string, originalFileName: string | null): string {
  const cleanName = originalFileName === null ? null : sanitizeOriginalFileName(originalFileName);
  const nameSegment = cleanName === null ? "" : Buffer.from(cleanName, "utf8").toString("base64url");
  const body = `${uploadToken}.${nameSegment}`;
  return `${body}.${envelopeMac(body).toString("base64url")}`;
}

export type OpenedUploadEnvelope =
  | { ok: true; uploadToken: string; originalFileName: string | null }
  | { ok: false; reason: Extract<UploadTokenFailure, "malformed" | "bad_signature"> };

/**
 * Checks the envelope MAC and returns the inner foundation token (still to be verified with
 * verifyUploadToken) and the original file name.
 */
export function openUploadEnvelope(envelope: string): OpenedUploadEnvelope {
  const parts = envelope.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [payload, signature, nameSegment, mac] = parts;
  if (!BASE64URL.test(payload) || !BASE64URL.test(signature) || !BASE64URL.test(mac)) {
    return { ok: false, reason: "malformed" };
  }
  if (nameSegment !== "" && !BASE64URL.test(nameSegment)) return { ok: false, reason: "malformed" };

  const expected = envelopeMac(`${payload}.${signature}.${nameSegment}`);
  const provided = Buffer.from(mac, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  const originalFileName =
    nameSegment === "" ? null : sanitizeOriginalFileName(Buffer.from(nameSegment, "base64url").toString("utf8"));
  return { ok: true, uploadToken: `${payload}.${signature}`, originalFileName };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type StorageFailureKind = "not_found" | "forbidden" | "conflict" | "too_large" | "unsupported" | "unavailable" | "unknown";

interface StorageErrorLike {
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  name?: unknown;
}

/**
 * Supabase Storage answers most client errors with HTTP 400 and the real code in `statusCode`
 * (docs/research/supabase.md §5.5), so classify on that first; a missing HTTP status means the
 * request never got an answer (network failure, StorageUnknownError).
 */
export function classifyStorageError(error: unknown): StorageFailureKind {
  if (!error || typeof error !== "object") return "unknown";
  const e = error as StorageErrorLike;
  const statusCode = typeof e.statusCode === "string" ? e.statusCode : "";
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.status === "number" ? e.status : null;
  const message = typeof e.message === "string" ? e.message : "";

  if (statusCode === "404" || code === "NoSuchKey" || code === "NoSuchBucket" || status === 404 || /not found/i.test(message)) {
    return "not_found";
  }
  if (statusCode === "401" || statusCode === "403" || code === "AccessDenied" || status === 401 || status === 403) {
    return "forbidden";
  }
  if (statusCode === "409" || code === "ResourceAlreadyExists" || status === 409) return "conflict";
  if (statusCode === "413" || code === "EntityTooLarge" || status === 413) return "too_large";
  if (statusCode === "415" || code === "InvalidMimeType" || status === 415) return "unsupported";
  const numericStatusCode = Number(statusCode);
  if ((status !== null && status >= 500) || (Number.isInteger(numericStatusCode) && numericStatusCode >= 500)) {
    return "unavailable";
  }
  if (status === null && (e.name === "StorageUnknownError" || /fetch failed|network|ECONN|ETIMEDOUT/i.test(message))) {
    return "unavailable";
  }
  return "unknown";
}

export type DownloadOutcome =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "missing" | "too_large" | "unavailable" | "failed"; cause?: unknown };

/**
 * Downloads an uploaded object with the secret-key client (bypasses RLS). Refuses objects larger
 * than `maxBytes` before reading them into memory.
 */
export async function downloadStorageObject(
  admin: TypedSupabaseClient,
  bucket: StorageBucket,
  path: string,
  maxBytes: number,
): Promise<DownloadOutcome> {
  let result: Awaited<ReturnType<ReturnType<TypedSupabaseClient["storage"]["from"]>["download"]>>;
  try {
    result = await admin.storage.from(bucket).download(path, {}, { cache: "no-store" });
  } catch (cause) {
    return { ok: false, reason: "unavailable", cause };
  }
  if (result.error || !result.data) {
    const kind = classifyStorageError(result.error);
    if (kind === "not_found") return { ok: false, reason: "missing", cause: result.error };
    return { ok: false, reason: kind === "unavailable" ? "unavailable" : "failed", cause: result.error };
  }
  const blob = result.data;
  if (blob.size > maxBytes) return { ok: false, reason: "too_large" };
  return { ok: true, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

/**
 * Best-effort removal with the secret-key client. Never throws: a failure only leaves an orphaned
 * object behind, which is logged so it can be cleaned up.
 */
export async function removeStorageObjects(
  admin: TypedSupabaseClient,
  bucket: StorageBucket,
  paths: readonly string[],
  context: string,
): Promise<boolean> {
  if (paths.length === 0) return true;
  try {
    const { error } = await admin.storage.from(bucket).remove([...paths]);
    if (error) {
      console.error(`[uploads] ${context}: could not remove ${bucket}/${paths.join(", ")}`, error);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[uploads] ${context}: could not remove ${bucket}/${paths.join(", ")}`, error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Database errors
// ---------------------------------------------------------------------------

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/**
 * JSON error for a failed PostgREST call: permission → 403, missing row → 404, uniqueness → 409,
 * bad values → 400; anything else is logged and answered with a generic 500.
 */
export function dbErrorResponse(context: string, error: PostgrestLikeError): Response {
  switch (error.code) {
    case "42501":
      return jsonError(403, "forbidden", describeDbError(error));
    case "PGRST116":
      return jsonError(404, "not_found", describeDbError(error));
    case "23505":
      return jsonError(409, "conflict", describeDbError(error));
    case "23503":
    case "23514":
    case "22023":
    case "22004":
    case "22P02":
      return jsonError(400, "invalid_request", describeDbError(error));
    default:
      return jsonServerError(context, error);
  }
}
