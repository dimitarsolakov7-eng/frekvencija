/**
 * Browser implementation of PlayerApi against the business-user route handlers
 * (docs/ARCHITECTURE.md §7). Every failure becomes a PlayerApiError whose `kind` tells the engine
 * how to react; a caller-initiated abort is re-thrown as the AbortError itself.
 */
import type {
  AnnouncementPlacement,
  AnnouncementSummary,
  AnnouncementsResponse,
  GenreTracksResponse,
  PlaybackPreferences,
  SignMediaRequest,
  SignedMedia,
  TrackSummary,
  UpdatePreferencesRequest,
} from "@/lib/api/contracts";
import { PlayerApiError, type PlayerApi } from "./types";

export const DEFAULT_PLAYER_API_TIMEOUT_MS = 15_000;

export interface PlayerApiClientOptions {
  fetch?: typeof fetch;
  /** Prefix for the API paths (default: same origin). */
  baseUrl?: string;
  /** Per-request timeout covering the response body too. */
  timeoutMs?: number;
}

type Parser<T> = (json: unknown) => T | null;

export function createPlayerApi(options: PlayerApiClientOptions = {}): PlayerApi {
  // Wrapped so a bare `window.fetch` reference is never invoked with the wrong `this`.
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_PLAYER_API_TIMEOUT_MS;

  async function request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    parse: Parser<T>,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    // Two parallel requests carrying the same expired session can race on Supabase's single-use
    // refresh token; the loser sees 401 although the session is fine. Retry a 401 exactly once.
    let response = await send(method, path, body, signal);
    if (response.status === 401) response = await send(method, path, body, signal);
    return interpret(response, parse);
  }

  async function send(
    method: string,
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<{ status: number; ok: boolean; text: string }> {
    if (signal?.aborted) throw abortReason(signal);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.status, ok: response.ok, text };
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      if (timedOut) throw new PlayerApiError("network", "The request timed out.");
      throw new PlayerApiError("network", describeNetworkFailure(error));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  return {
    getGenreTracks: (genreId, signal) =>
      request("GET", `/api/player/genres/${encodeURIComponent(genreId)}/tracks`, parseGenreTracks, undefined, signal),
    getAnnouncements: (signal) => request("GET", "/api/player/announcements", parseAnnouncements, undefined, signal),
    signMedia: (req: SignMediaRequest, signal) => request("POST", "/api/media/sign", parseSignedMedia, req, signal),
    savePreferences: (update: UpdatePreferencesRequest) =>
      request("PUT", "/api/player/preferences", parsePreferencesResponse, update, undefined),
  };
}

function interpret<T>(response: { status: number; ok: boolean; text: string }, parse: Parser<T>): T {
  if (response.ok) {
    const parsed = parse(parseJson(response.text));
    if (parsed === null) throw new PlayerApiError("server", "The server sent an unexpected response.", response.status);
    return parsed;
  }
  const body = parseErrorBody(response.text);
  const message = body?.message ?? `Request failed with status ${response.status}.`;
  const code = body?.code ?? null;
  const { status } = response;
  if (status === 401) throw new PlayerApiError("auth", message, status, code);
  if (status === 403) throw new PlayerApiError("forbidden", message, status, code);
  if (status === 404 || status === 410) throw new PlayerApiError("unavailable", message, status, code);
  if (status === 429) throw new PlayerApiError("rate_limited", message, status, code);
  // 5xx, and any other status the player cannot act on, is a server-side problem.
  throw new PlayerApiError("server", message, status, code);
}

function abortReason(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason;
  if (typeof reason === "object" && reason !== null && (reason as { name?: unknown }).name === "AbortError") return reason;
  return new DOMException("The request was aborted.", "AbortError");
}

function describeNetworkFailure(error: unknown): string {
  return error instanceof TypeError ? "Could not reach the server." : "The request failed.";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parseErrorBody(text: string): { code: string; message: string } | null {
  const json = parseJson(text);
  if (!isRecord(json) || !isRecord(json.error)) return null;
  const { code, message } = json.error;
  if (typeof code !== "string" || typeof message !== "string") return null;
  return { code, message };
}

// ---------------------------------------------------------------------------
// Response validation (the engine must never act on a half-shaped payload)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

const PLACEMENTS: readonly AnnouncementPlacement[] = ["welcome", "rotation", "both"];

function parseTrack(value: unknown): TrackSummary | null {
  if (!isRecord(value)) return null;
  const { id, title, artist, durationSeconds } = value;
  if (typeof id !== "string" || typeof title !== "string" || typeof artist !== "string") return null;
  if (!isFiniteNumber(durationSeconds)) return null;
  return { id, title, artist, durationSeconds };
}

export function parseGenreTracks(json: unknown): GenreTracksResponse | null {
  if (!isRecord(json) || typeof json.genreId !== "string" || !Array.isArray(json.tracks)) return null;
  const tracks: TrackSummary[] = [];
  for (const entry of json.tracks) {
    const track = parseTrack(entry);
    if (!track) return null;
    tracks.push(track);
  }
  return { genreId: json.genreId, tracks, fetchedAt: typeof json.fetchedAt === "string" ? json.fetchedAt : "" };
}

function parseAnnouncement(value: unknown): AnnouncementSummary | null {
  if (!isRecord(value)) return null;
  const { id, placement, durationSeconds, text } = value;
  if (typeof id !== "string" || !PLACEMENTS.includes(placement as AnnouncementPlacement)) return null;
  if (!isNullableNumber(durationSeconds) || typeof text !== "string") return null;
  return { id, placement: placement as AnnouncementPlacement, durationSeconds, text };
}

export function parseAnnouncements(json: unknown): AnnouncementsResponse | null {
  if (!isRecord(json) || !Array.isArray(json.announcements) || !isRecord(json.settings)) return null;
  const { everyNTracks, volume } = json.settings;
  if (!isFiniteNumber(everyNTracks) || !isFiniteNumber(volume)) return null;
  const announcements: AnnouncementSummary[] = [];
  for (const entry of json.announcements) {
    const announcement = parseAnnouncement(entry);
    if (!announcement) return null;
    announcements.push(announcement);
  }
  return {
    announcements,
    settings: { everyNTracks, volume },
    brandingVersion: isFiniteNumber(json.brandingVersion) ? json.brandingVersion : 0,
    fetchedAt: typeof json.fetchedAt === "string" ? json.fetchedAt : "",
  };
}

export function parseSignedMedia(json: unknown): SignedMedia | null {
  if (!isRecord(json)) return null;
  const { kind, id, url, expiresAt, durationSeconds, title, artist } = json;
  if (kind !== "track" && kind !== "announcement") return null;
  if (typeof id !== "string" || typeof url !== "string" || url === "" || typeof expiresAt !== "string") return null;
  if (!isNullableNumber(durationSeconds)) return null;
  const signed: SignedMedia = { kind, id, url, expiresAt, durationSeconds };
  if (typeof title === "string") signed.title = title;
  if (typeof artist === "string") signed.artist = artist;
  return signed;
}

function parsePreferences(value: unknown): PlaybackPreferences | null {
  if (!isRecord(value)) return null;
  const { genreId, volume, muted } = value;
  if (!(genreId === null || typeof genreId === "string") || !isFiniteNumber(volume) || typeof muted !== "boolean") {
    return null;
  }
  return { genreId, volume, muted };
}

export function parsePreferencesResponse(json: unknown): PlaybackPreferences | null {
  return isRecord(json) ? parsePreferences(json.preferences) : null;
}
