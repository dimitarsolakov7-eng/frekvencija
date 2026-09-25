import "server-only";
import {
  getServerEnv,
  MEDIA_URL_TTL_MAX_SECONDS,
  MEDIA_URL_TTL_MIN_SECONDS,
} from "@/lib/env";
import type { StorageBucket } from "@/lib/supabase/types";

/**
 * Signed media URLs (docs/ARCHITECTURE.md §5.6, §9). Business users sign with their OWN client so
 * Storage RLS is enforced a second time; admins sign previews with theirs.
 */

/** Extra lifetime on top of 1.5× the duration, covering buffering, pauses and clock skew. */
const TTL_MARGIN_SECONDS = 900;

/**
 * Signed URL lifetime for an item: long enough for the whole item plus buffering, never below the
 * configured baseline, always within 900–43200 s. Every Range request re-checks expiry, so the URL
 * must outlive playback: `clamp(max(configured, ceil(duration × 1.5) + 900), 900, 43200)`.
 */
export function computeSignedUrlTtl(durationSeconds: number | null | undefined, configuredTtl: number): number {
  const duration = typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const baseline = Number.isFinite(configuredTtl) ? Math.floor(configuredTtl) : MEDIA_URL_TTL_MIN_SECONDS;
  const needed = Math.max(baseline, Math.ceil(duration * 1.5) + TTL_MARGIN_SECONDS);
  return Math.min(MEDIA_URL_TTL_MAX_SECONDS, Math.max(MEDIA_URL_TTL_MIN_SECONDS, needed));
}

/** TTL for an item using MEDIA_URL_TTL_SECONDS as the baseline. */
export function mediaTtlFor(durationSeconds: number | null | undefined): number {
  return computeSignedUrlTtl(durationSeconds, getServerEnv().mediaUrlTtlSeconds);
}

export interface SignedStorageUrl {
  url: string;
  /** ISO timestamp; computed from the time BEFORE the request, so it is never later than the real expiry. */
  expiresAt: string;
}

export type CreateSignedUrlResult =
  | { data: { signedUrl: string }; error: null }
  | { data: null; error: { message: string; status?: number; statusCode?: string } };

/** Minimal structural view of a Supabase client's Storage API (any typed client satisfies it). */
export interface StorageSigningClient {
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): Promise<CreateSignedUrlResult>;
    };
  };
}

export class MediaSigningError extends Error {
  readonly bucket: StorageBucket;
  readonly path: string;
  /** True when Storage reported the object missing or not visible under RLS (HTTP 400 with statusCode "404"/"403"). */
  readonly notFound: boolean;

  constructor(bucket: StorageBucket, path: string, message: string, notFound: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MediaSigningError";
    this.bucket = bucket;
    this.path = path;
    this.notFound = notFound;
  }
}

export async function signStorageObject(
  client: StorageSigningClient,
  bucket: StorageBucket,
  path: string,
  ttlSeconds: number,
): Promise<SignedStorageUrl> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new RangeError(`Signed URL lifetime must be a positive whole number of seconds (got ${ttlSeconds}).`);
  }
  const issuedAt = Date.now();

  let result: CreateSignedUrlResult;
  try {
    result = await client.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  } catch (cause) {
    throw new MediaSigningError(bucket, path, `Could not reach Storage to sign ${bucket}/${path}.`, false, { cause });
  }

  if (result.error || !result.data?.signedUrl) {
    const error = result.error;
    const code = error?.statusCode;
    const notFound = code === "404" || code === "403" || /not found/i.test(error?.message ?? "");
    throw new MediaSigningError(
      bucket,
      path,
      `Signing ${bucket}/${path} failed: ${error?.message ?? "no URL returned"}.`,
      notFound,
      { cause: error ?? undefined },
    );
  }

  return {
    url: result.data.signedUrl,
    expiresAt: new Date(issuedAt + ttlSeconds * 1000).toISOString(),
  };
}

/** Signs a track or announcement object with a lifetime covering its duration. */
export function signAudioObject(
  client: StorageSigningClient,
  bucket: "music" | "announcements",
  path: string,
  durationSeconds: number | null,
): Promise<SignedStorageUrl> {
  return signStorageObject(client, bucket, path, mediaTtlFor(durationSeconds));
}

/** Signs a venue logo with the baseline lifetime. */
export function signLogoObject(client: StorageSigningClient, path: string): Promise<SignedStorageUrl> {
  return signStorageObject(client, "logos", path, mediaTtlFor(null));
}

/** Signs a genre cover (bucket `genre-covers`) with the baseline lifetime. */
export function signGenreCoverObject(client: StorageSigningClient, path: string): Promise<SignedStorageUrl> {
  return signStorageObject(client, "genre-covers", path, mediaTtlFor(null));
}

// ---------------------------------------------------------------------------
// Batch signing (many small images in one Storage request)
// ---------------------------------------------------------------------------

/** One entry of Storage's batch signing response (`createSignedUrls`). */
export interface BatchSignedUrlEntry {
  error: string | null;
  path: string | null;
  signedUrl: string | null;
}

/** Minimal structural view of the Storage batch-signing API (any typed Supabase client satisfies it). */
export interface StorageBatchSigningClient {
  storage: {
    from(bucket: string): {
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): Promise<{ data: BatchSignedUrlEntry[]; error: null } | { data: null; error: { message: string } }>;
    };
  };
}

/**
 * Signs many objects of one bucket in ONE Storage request with the caller's own client (so Storage
 * RLS applies). Returns path → signed URL for the objects that could be signed; missing, forbidden
 * or failed objects are simply absent, and duplicates/blank paths are ignored. Never throws: callers
 * use it for decorative images and fall back to default artwork.
 */
export async function signStorageObjects(
  client: StorageBatchSigningClient,
  bucket: StorageBucket,
  paths: readonly (string | null | undefined)[],
  ttlSeconds: number,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => typeof path === "string" && path !== ""))];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;
  try {
    const { data, error } = await client.storage.from(bucket).createSignedUrls(unique, ttlSeconds);
    if (error || !Array.isArray(data)) {
      console.warn(`[media] could not sign ${unique.length} object(s) in "${bucket}"`, error);
      return urls;
    }
    data.forEach((entry, index) => {
      // Storage echoes each path; fall back to the request order only when it did not.
      const path = entry.path ?? (data.length === unique.length ? unique[index] : null);
      if (path === null || !unique.includes(path) || entry.error || typeof entry.signedUrl !== "string" || entry.signedUrl === "") {
        return;
      }
      urls.set(path, entry.signedUrl);
    });
    const unsigned = unique.length - urls.size;
    if (unsigned > 0) console.warn(`[media] ${unsigned} object(s) in "${bucket}" could not be signed`);
  } catch (error) {
    console.warn(`[media] could not sign ${unique.length} object(s) in "${bucket}"`, error);
  }
  return urls;
}

/** Genre covers for display (baseline lifetime), in one request; never throws, see signStorageObjects(). */
export async function signGenreCoverUrls(
  client: StorageBatchSigningClient,
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  let ttlSeconds: number;
  try {
    ttlSeconds = mediaTtlFor(null);
  } catch (error) {
    console.warn("[media] could not read the signed-URL lifetime; showing default genre artwork", error);
    return new Map();
  }
  return signStorageObjects(client, "genre-covers", paths, ttlSeconds);
}
