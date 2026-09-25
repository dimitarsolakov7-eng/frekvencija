/**
 * Browser helper for POST /api/admin/media/preview (track audio for admins). Sends
 * `Content-Type: application/json` (readJson() rejects anything else) and turns error bodies into
 * CatalogApiError carrying the server's user-facing message.
 */
import type { AdminPreviewRequest, AdminPreviewResponse, ApiErrorBody } from "@/lib/api/contracts";

export class CatalogApiError extends Error {
  /** ApiErrorCode from the server, or "network" / "aborted". */
  readonly code: string;
  readonly status: number | null;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "CatalogApiError";
    this.code = code;
    this.status = status;
  }
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

function isPreviewResponse(value: unknown): value is AdminPreviewResponse {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { url?: unknown }).url === "string" &&
    typeof (value as { expiresAt?: unknown }).expiresAt === "string"
  );
}

/** Short-lived signed URL for a track's audio (any status), signed with the admin's own session. */
export async function fetchTrackPreview(trackId: string, signal?: AbortSignal): Promise<AdminPreviewResponse> {
  const body: AdminPreviewRequest = { kind: "track", id: trackId };
  let response: Response;
  try {
    response = await fetch("/api/admin/media/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new CatalogApiError("aborted", "The preview was cancelled.");
    }
    throw new CatalogApiError("network", "Could not reach the server. Check your connection and try again.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Handled below: our API always answers JSON.
  }
  if (!response.ok) {
    if (isApiErrorBody(payload)) throw new CatalogApiError(payload.error.code, payload.error.message, response.status);
    if (response.status === 401) throw new CatalogApiError("unauthenticated", "Your session has expired. Sign in again.", 401);
    throw new CatalogApiError("server_error", `The server returned an unexpected response (HTTP ${response.status}).`, response.status);
  }
  if (!isPreviewResponse(payload)) {
    throw new CatalogApiError("server_error", "The server returned an unexpected response. Please try again.", response.status);
  }
  return payload;
}
