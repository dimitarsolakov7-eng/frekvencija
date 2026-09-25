import "server-only";
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { UploadKind } from "@/lib/api/contracts";
import { EnvError, getServerEnv } from "@/lib/env";
import { UPLOAD_RULES, type UploadBucket } from "@/lib/validation/limits";

/**
 * HMAC-signed upload tokens (docs/ARCHITECTURE.md §8). The sign endpoint issues one per signed upload URL;
 * the complete endpoint trusts only what the token binds: kind, bucket, object path, target, admin, expiry.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, payload segment))>`.
 */

export const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;
const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 4096;
const KEY_DERIVATION_INFO = "venue-radio/upload-token/v1";
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface UploadTokenPayload {
  v: 1;
  kind: UploadKind;
  bucket: UploadBucket;
  path: string;
  /** trackId (track-replace), announcementId, businessId (logo), genreId (genre-cover); null for a new track. */
  targetId: string | null;
  /** Admin who requested the upload; the same user must complete it. */
  userId: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
  nonce: string;
}

export type UploadTokenClaims = Pick<UploadTokenPayload, "kind" | "bucket" | "path" | "targetId" | "userId">;

export type UploadTokenFailure =
  | "malformed"
  | "bad_signature"
  | "invalid_payload"
  | "expired"
  | "kind_mismatch"
  | "user_mismatch";

export type VerifyUploadTokenResult =
  | { ok: true; payload: UploadTokenPayload }
  | { ok: false; reason: UploadTokenFailure };

const payloadSchema = z.strictObject({
  v: z.literal(1),
  kind: z.enum(["track", "track-replace", "announcement", "logo", "genre-cover"]),
  bucket: z.enum(["music", "announcements", "logos", "genre-covers"]),
  path: z.string().min(1).max(512),
  targetId: z.string().min(1).max(64).nullable(),
  userId: z.string().min(1).max(64),
  exp: z.number().int().positive(),
  nonce: z.string().regex(BASE64URL).min(16).max(64),
});

/** Structural consistency every genuine token satisfies (defence in depth if the key ever leaks). */
function isConsistent(payload: UploadTokenPayload): boolean {
  if (UPLOAD_RULES[payload.kind].bucket !== payload.bucket) return false;
  const needsTarget = payload.kind !== "track";
  if (needsTarget !== (payload.targetId !== null)) return false;
  return !payload.path.startsWith("/") && !payload.path.split("/").some((segment) => segment === "" || segment === "..");
}

function signingKey(): Buffer {
  const env = getServerEnv();
  // Domain separation: even if the same secret is reused elsewhere, keys derived for this label differ.
  const secret = env.uploadTokenSecret ?? env.supabaseSecretKey;
  if (!secret) {
    throw new EnvError(
      "UPLOAD_TOKEN_SECRET",
      "Upload tokens need UPLOAD_TOKEN_SECRET or SUPABASE_SECRET_KEY (legacy: SUPABASE_SERVICE_ROLE_KEY) to be set.",
    );
  }
  return Buffer.from(hkdfSync("sha256", secret, "", KEY_DERIVATION_INFO, 32));
}

function sign(segment: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(segment).digest();
}

function nowSeconds(nowMs: number): number {
  return Math.floor(nowMs / 1000);
}

export function createUploadToken(claims: UploadTokenClaims, options: { now?: number } = {}): string {
  const payload: UploadTokenPayload = {
    v: 1,
    kind: claims.kind,
    bucket: claims.bucket,
    path: claims.path,
    targetId: claims.targetId,
    userId: claims.userId,
    exp: nowSeconds(options.now ?? Date.now()) + UPLOAD_TOKEN_TTL_SECONDS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success || !isConsistent(payload)) {
    throw new Error(`Refusing to sign an inconsistent upload token for kind "${claims.kind}".`);
  }
  const segment = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${segment}.${sign(segment, signingKey()).toString("base64url")}`;
}

export interface VerifyUploadTokenOptions {
  now?: number;
  /** Reject tokens issued for another kind (or kinds). */
  expectedKind?: UploadKind | readonly UploadKind[];
  /** Reject tokens issued to another user. */
  expectedUserId?: string;
}

export function verifyUploadToken(token: string, options: VerifyUploadTokenOptions = {}): VerifyUploadTokenResult {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [segment, signature] = parts;
  if (!BASE64URL.test(segment) || !BASE64URL.test(signature)) return { ok: false, reason: "malformed" };

  // Authenticate before parsing anything attacker-controlled.
  const expected = sign(segment, signingKey());
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success || !isConsistent(parsed.data)) return { ok: false, reason: "invalid_payload" };
  const payload = parsed.data;

  const now = nowSeconds(options.now ?? Date.now());
  if (payload.exp <= now) return { ok: false, reason: "expired" };
  if (payload.exp > now + UPLOAD_TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS) return { ok: false, reason: "invalid_payload" };

  if (options.expectedKind !== undefined) {
    const kinds: readonly UploadKind[] = typeof options.expectedKind === "string" ? [options.expectedKind] : options.expectedKind;
    if (!kinds.includes(payload.kind)) return { ok: false, reason: "kind_mismatch" };
  }
  if (options.expectedUserId !== undefined && payload.userId !== options.expectedUserId) {
    return { ok: false, reason: "user_mismatch" };
  }
  return { ok: true, payload };
}

/** User-facing message for a rejected token (the complete endpoint answers 400/403 with it). */
export function describeUploadTokenFailure(reason: UploadTokenFailure): string {
  switch (reason) {
    case "expired":
      return "This upload took too long and its authorisation expired. Please upload the file again.";
    case "user_mismatch":
      return "This upload was started by a different account.";
    case "kind_mismatch":
      return "This upload token is for a different kind of file.";
    default:
      return "The upload token is invalid. Please upload the file again.";
  }
}
