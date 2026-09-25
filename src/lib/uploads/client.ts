/**
 * Browser upload helpers (docs/ARCHITECTURE.md §8). Files go straight from the browser to Supabase
 * Storage through a signed upload URL — never through Next.js, whose proxy truncates bodies at 10 MB.
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
  CompleteUploadRequest,
  CompleteUploadResponse,
  SignUploadRequest,
  SignUploadResponse,
} from "@/lib/api/contracts";
import { getSupabasePublicConfig } from "@/lib/env";
import { checkUploadFile } from "@/lib/validation/limits";

export type UploadErrorCode = ApiErrorCode | "aborted" | "network";
export type UploadPhase = "signing" | "uploading" | "validating";

/** Upload failure with a message that can be shown to the admin as-is. */
export class UploadError extends Error {
  readonly code: UploadErrorCode;
  /** HTTP status when the failure came from a response. */
  readonly status: number | null;

  constructor(code: UploadErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "UploadError";
    this.code = code;
    this.status = status;
  }
}

export function isUploadAbort(error: unknown): boolean {
  return error instanceof UploadError && error.code === "aborted";
}

const ABORTED_MESSAGE = "Upload cancelled.";
const NETWORK_MESSAGE = "Network error while uploading. Check your connection and try again.";

interface StorageErrorBody {
  statusCode?: string;
  error?: string;
  message?: string;
}

function parseStorageErrorBody(text: string): StorageErrorBody {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as StorageErrorBody) : {};
  } catch {
    return {};
  }
}

/**
 * Supabase Storage answers most client errors with HTTP 400 and the real code in `statusCode`
 * (docs/research/supabase.md §5.5), so map on that first.
 */
export function mapStorageUploadFailure(status: number, responseText: string): UploadError {
  const body = parseStorageErrorBody(responseText);
  const code = body.statusCode ?? String(status);
  const detail = `${body.error ?? ""} ${body.message ?? ""}`;

  switch (code) {
    case "409":
      return new UploadError("conflict", "A file already exists at this storage location. Please upload it again.", status);
    case "413":
      return new UploadError("payload_too_large", "The file is larger than the storage limit allows.", status);
    case "415":
      return new UploadError("unsupported_media", "Storage rejected this file type.", status);
    case "404":
      return new UploadError("not_found", "The upload destination no longer exists. Please upload the file again.", status);
  }
  if (code === "401" || code === "403" || /expired|jwt|signature|unauthori[sz]ed/i.test(detail)) {
    return new UploadError("forbidden", "The upload link expired or was rejected. Please upload the file again.", status);
  }
  if (status >= 500) {
    return new UploadError("unavailable", "File storage is temporarily unavailable. Please try again.", status);
  }
  const reason = body.message ? `: ${body.message}` : "";
  return new UploadError("server_error", `Upload failed (HTTP ${status})${reason}.`, status);
}

function defaultApiKey(): string | null {
  try {
    return getSupabasePublicConfig().publishableKey;
  } catch {
    return null;
  }
}

export interface UploadWithProgressOptions {
  /** Absolute signed upload URL from /api/admin/uploads/sign. */
  signedUrl: string;
  file: Blob;
  /** Normalised content type (see checkUploadFile); overrides the browser-reported type. */
  contentType: string;
  /** Cache-Control max-age in seconds for the stored object (supabase-js default "3600"). */
  cacheControl?: string;
  /** Sent as `apikey` like supabase-js does; defaults to the publishable key. */
  apiKey?: string | null;
  /** Fraction 0–1 of the request body sent. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * XMLHttpRequest replica of storage-js `uploadToSignedUrl` for a Blob (fetch has no upload progress):
 * PUT multipart FormData with, in this order, `cacheControl`, `contentType`, then the file under the
 * empty field name. Content-Type is left to the browser so it includes the multipart boundary.
 */
export function uploadWithProgress(options: UploadWithProgressOptions): Promise<void> {
  const { signedUrl, file, contentType, cacheControl = "3600", onProgress, signal } = options;
  const apiKey = options.apiKey === undefined ? defaultApiKey() : options.apiKey;

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadError("aborted", ABORTED_MESSAGE));
      return;
    }

    const xhr = new XMLHttpRequest();
    const onAbortSignal = () => xhr.abort();
    const settle = (outcome: () => void) => {
      signal?.removeEventListener("abort", onAbortSignal);
      outcome();
    };

    xhr.open("PUT", signedUrl);
    if (apiKey) xhr.setRequestHeader("apikey", apiKey);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(1, event.loaded / event.total));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle(() => {
          onProgress?.(1);
          resolve();
        });
      } else {
        settle(() => reject(mapStorageUploadFailure(xhr.status, xhr.responseText)));
      }
    };
    xhr.onerror = () => settle(() => reject(new UploadError("network", NETWORK_MESSAGE)));
    xhr.ontimeout = () => settle(() => reject(new UploadError("network", NETWORK_MESSAGE)));
    xhr.onabort = () => settle(() => reject(new UploadError("aborted", ABORTED_MESSAGE)));
    signal?.addEventListener("abort", onAbortSignal, { once: true });

    const form = new FormData();
    form.append("cacheControl", cacheControl);
    form.append("contentType", contentType); // must precede the file part to take effect
    form.append("", file);
    xhr.send(form);
  });
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    !!error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new UploadError("aborted", ABORTED_MESSAGE);
    }
    throw new UploadError("network", NETWORK_MESSAGE);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Handled below: a non-JSON body is never a valid answer from our API.
  }

  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new UploadError(payload.error.code, payload.error.message, response.status);
    }
    throw new UploadError(
      response.status >= 500 ? "unavailable" : "server_error",
      `The server returned an unexpected response (HTTP ${response.status}). Please try again.`,
      response.status,
    );
  }
  if (payload === null) {
    throw new UploadError("server_error", "The server returned an empty response. Please try again.", response.status);
  }
  return payload as T;
}

/** What an upload is for; combined with a File by buildSignUploadRequest(). */
export type UploadTarget =
  | { kind: "track" }
  | { kind: "track-replace"; trackId: string }
  | { kind: "announcement"; announcementId: string }
  | { kind: "logo"; businessId: string }
  | { kind: "genre-cover"; genreId: string };

export function buildSignUploadRequest(target: UploadTarget, file: File): SignUploadRequest {
  return { ...target, fileName: file.name, fileSize: file.size, contentType: file.type };
}

export interface UploadFileOptions {
  request: SignUploadRequest;
  file: Blob;
  /** Only for kind "track": title/artist/genre overrides. */
  metadata?: CompleteUploadRequest["metadata"];
  onProgress?: (fraction: number) => void;
  onPhase?: (phase: UploadPhase) => void;
  /**
   * Cancels signing or the byte transfer. Once the bytes are stored the server-side validation is
   * allowed to finish (aborting it would leave the admin unsure whether the item was created).
   */
  signal?: AbortSignal;
}

/**
 * Full admin upload: validate locally → POST /api/admin/uploads/sign → XHR upload with progress →
 * POST /api/admin/uploads/complete. Throws UploadError with a user-facing message.
 */
export async function uploadFile(options: UploadFileOptions): Promise<CompleteUploadResponse> {
  const { request, file, metadata, onProgress, onPhase, signal } = options;

  const check = checkUploadFile(request.kind, { name: request.fileName, size: request.fileSize, type: request.contentType });
  if (!check.ok) throw new UploadError(check.code, check.message);
  if (file.size !== request.fileSize) {
    throw new UploadError("invalid_request", "The selected file changed. Please choose it again.");
  }
  if (signal?.aborted) throw new UploadError("aborted", ABORTED_MESSAGE);

  onPhase?.("signing");
  const signed = await postJson<SignUploadResponse>("/api/admin/uploads/sign", request, signal);

  onPhase?.("uploading");
  onProgress?.(0);
  await uploadWithProgress({ signedUrl: signed.signedUrl, file, contentType: check.contentType, onProgress, signal });

  onPhase?.("validating");
  const completeRequest: CompleteUploadRequest = metadata ? { uploadToken: signed.uploadToken, metadata } : { uploadToken: signed.uploadToken };
  return postJson<CompleteUploadResponse>("/api/admin/uploads/complete", completeRequest);
}
