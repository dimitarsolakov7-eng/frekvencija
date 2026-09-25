/**
 * Browser helpers for the admin announcement JSON endpoints. Every call sends
 * `Content-Type: application/json` (readJson() rejects anything else) and turns error bodies into
 * AdminApiError with the server's user-facing message.
 */
import type {
  AdminPreviewRequest,
  AdminPreviewResponse,
  ApiErrorBody,
  GenerateAnnouncementRequest,
  GenerateAnnouncementResponse,
  TtsOptionsResponse,
} from "@/lib/api/contracts";

export class AdminApiError extends Error {
  /** ApiErrorCode from the server, or "network" / "aborted" for client-side failures. */
  readonly code: string;
  readonly status: number | null;
  readonly fields: Record<string, string>;

  constructor(code: string, message: string, status: number | null = null, fields: Record<string, string> = {}) {
    super(message);
    this.name = "AdminApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

const NETWORK_MESSAGE = "Could not reach the server. Check your connection and try again.";

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

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if (init.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new AdminApiError("aborted", "The request was cancelled.");
    }
    throw new AdminApiError("network", NETWORK_MESSAGE);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body is never a valid answer from our API; handled below.
  }
  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new AdminApiError(payload.error.code, payload.error.message, response.status, payload.error.fields ?? {});
    }
    if (response.status === 401) throw new AdminApiError("unauthenticated", "Your session has expired. Sign in again.", 401);
    throw new AdminApiError(
      response.status >= 500 ? "server_error" : "invalid_request",
      `The server returned an unexpected response (HTTP ${response.status}). Please try again.`,
      response.status,
    );
  }
  if (payload === null || typeof payload !== "object") {
    throw new AdminApiError("server_error", "The server returned an empty response. Please try again.", response.status);
  }
  return payload as T;
}

/** GET /api/admin/tts/options (`refresh` bypasses the server's 10-minute cache). */
export function fetchTtsOptions(options: { signal?: AbortSignal; refresh?: boolean } = {}): Promise<TtsOptionsResponse> {
  return requestJson<TtsOptionsResponse>(`/api/admin/tts/options${options.refresh ? "?refresh=1" : ""}`, {
    method: "GET",
    signal: options.signal,
  });
}

/** POST /api/admin/announcements/[id]/generate — may take up to a minute. */
export function requestAnnouncementGeneration(announcementId: string, body: GenerateAnnouncementRequest): Promise<GenerateAnnouncementResponse> {
  return requestJson<GenerateAnnouncementResponse>(`/api/admin/announcements/${encodeURIComponent(announcementId)}/generate`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** POST /api/admin/media/preview for an announcement's current audio. */
export function fetchAnnouncementPreview(announcementId: string, signal?: AbortSignal): Promise<AdminPreviewResponse> {
  const body: AdminPreviewRequest = { kind: "announcement", id: announcementId };
  return requestJson<AdminPreviewResponse>("/api/admin/media/preview", { method: "POST", body: JSON.stringify(body), signal });
}
