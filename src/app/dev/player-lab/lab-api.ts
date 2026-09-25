/**
 * In-browser fake of the business-user player API for the dev player lab. It behaves like the real
 * route handlers as the engine sees them (PlayerApiError kinds, 404/410 for ineligible items, 401
 * for an expired session), serves the demo audio through /api/dev/audio/[id], and lets the lab
 * inject faults.
 */
import type {
  AnnouncementsResponse,
  GenreTracksResponse,
  PlaybackPreferences,
  SignMediaRequest,
  SignedMedia,
} from "@/lib/api/contracts";
import { PlayerApiError, type PlayerApi } from "@/lib/player/types";
import type { LabCatalog } from "./lab-catalog";

// ---------------------------------------------------------------------------
// Faults
// ---------------------------------------------------------------------------

export interface LabFaults {
  /** One-shot: the next sign request answers 410 (item no longer playable). */
  nextSignGone: boolean;
  /** One-shot: the next signed track URL points at a file that does not exist (media error). */
  nextTrackBrokenUrl: boolean;
  /** Announcement list and announcement signing fail with 500. */
  announcementsFail: boolean;
  /** Every request fails like a dropped connection. */
  offline: boolean;
  /** Every request answers 401 (session expired). */
  sessionExpired: boolean;
  /** Every request takes 1.5 s. */
  slowApi: boolean;
  /** Signed URLs expire after a few seconds (the dev audio route enforces ?exp). */
  shortUrls: boolean;
}

export type LabFaultName = keyof LabFaults;

export const NO_LAB_FAULTS: Readonly<LabFaults> = Object.freeze({
  nextSignGone: false,
  nextTrackBrokenUrl: false,
  announcementsFail: false,
  offline: false,
  sessionExpired: false,
  slowApi: false,
  shortUrls: false,
});

/** Observable fault switches (useSyncExternalStore-compatible). */
export class LabFaultStore {
  private faults: Readonly<LabFaults> = NO_LAB_FAULTS;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): Readonly<LabFaults> => this.faults;

  readonly set = (name: LabFaultName, value: boolean): void => {
    if (this.faults[name] === value) return;
    this.faults = { ...this.faults, [name]: value };
    for (const listener of [...this.listeners]) listener();
  };

  /** Turns a one-shot fault off and reports whether it was armed. */
  consume(name: LabFaultName): boolean {
    if (!this.faults[name]) return false;
    this.set(name, false);
    return true;
  }

  readonly reset = (): void => {
    if (this.faults === NO_LAB_FAULTS) return;
    this.faults = NO_LAB_FAULTS;
    for (const listener of [...this.listeners]) listener();
  };
}

// ---------------------------------------------------------------------------
// Fake API
// ---------------------------------------------------------------------------

export interface LabApiOptions {
  catalog: LabCatalog;
  businessKey: string;
  everyNTracks: number;
  /** 0.10–1.00 gain for announcements. */
  announcementVolume?: number;
  faults: LabFaultStore;
  /** Normal simulated latency (ms). */
  latencyMs?: number;
  /** Latency while the "slow API" fault is on (ms). */
  slowLatencyMs?: number;
  /** Signed URL lifetime (s). */
  urlLifetimeSeconds?: number;
  /** Signed URL lifetime while the "short URLs" fault is on (s). */
  shortUrlLifetimeSeconds?: number;
  now?: () => number;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

export const LAB_DEFAULT_LATENCY_MS = 120;
export const LAB_SLOW_LATENCY_MS = 1_500;
export const LAB_SHORT_URL_SECONDS = 20;

/** URL of a demo file served by the dev audio route (optionally expiring like a signed URL). */
export function labAudioUrl(id: string, expiresAtMs: number | null): string {
  const path = `/api/dev/audio/${encodeURIComponent(id)}`;
  return expiresAtMs === null ? path : `${path}?exp=${Math.floor(expiresAtMs)}`;
}

function abortError(): DOMException {
  return new DOMException("The request was aborted.", "AbortError");
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function describe(error: unknown): string {
  if (error instanceof PlayerApiError) return `${error.kind}${error.status ? ` ${error.status}` : ""}: ${error.message}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function createLabPlayerApi(options: LabApiOptions): PlayerApi {
  const {
    catalog,
    faults,
    latencyMs = LAB_DEFAULT_LATENCY_MS,
    slowLatencyMs = LAB_SLOW_LATENCY_MS,
    urlLifetimeSeconds = 7_200,
    shortUrlLifetimeSeconds = LAB_SHORT_URL_SECONDS,
    announcementVolume = 1,
  } = options;
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? (() => undefined);
  const genres = new Map(catalog.genres.map((genre) => [genre.id, genre]));
  const business = catalog.businesses.find((item) => item.key === options.businessKey) ?? null;
  let preferences: PlaybackPreferences = { genreId: null, volume: 0.8, muted: false };
  let brokenUrls = 0;

  /** Latency plus the connection-level faults every real request can hit. */
  async function gate(signal: AbortSignal | undefined): Promise<void> {
    await delay(faults.getSnapshot().slowApi ? slowLatencyMs : latencyMs, signal);
    const current = faults.getSnapshot();
    if (current.offline) throw new PlayerApiError("network", "Could not reach the server (lab: API offline).");
    if (current.sessionExpired) {
      throw new PlayerApiError("auth", "Your session has expired (lab: simulated 401).", 401, "unauthenticated");
    }
  }

  async function traced<T>(name: string, detail: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    try {
      const result = await run();
      log(`api.${name}`, { ...detail, outcome: "ok" });
      return result;
    } catch (error) {
      const aborted = typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
      log(`api.${name}`, { ...detail, outcome: aborted ? "aborted" : "error", error: aborted ? undefined : describe(error) });
      throw error;
    }
  }

  function signedUntil(): { expiresAtMs: number; short: boolean } {
    const short = faults.getSnapshot().shortUrls;
    return { expiresAtMs: now() + (short ? shortUrlLifetimeSeconds : urlLifetimeSeconds) * 1000, short };
  }

  return {
    getGenreTracks: (genreId, signal) =>
      traced("getGenreTracks", { genreId }, async (): Promise<GenreTracksResponse> => {
        await gate(signal);
        const genre = genres.get(genreId);
        if (!genre) throw new PlayerApiError("unavailable", "This genre is not available (lab: 404).", 404, "not_found");
        return { genreId, tracks: genre.tracks.map((track) => ({ ...track })), fetchedAt: new Date(now()).toISOString() };
      }),

    getAnnouncements: (signal) =>
      traced("getAnnouncements", {}, async (): Promise<AnnouncementsResponse> => {
        await gate(signal);
        if (faults.getSnapshot().announcementsFail) {
          throw new PlayerApiError("server", "Announcements could not be loaded (lab: simulated 500).", 500, "server_error");
        }
        return {
          // The real api-client requires `text` (display wording) on every announcement.
          announcements: (business?.announcements ?? []).map(({ id, placement, durationSeconds, text }) => ({
            id,
            placement,
            durationSeconds,
            text,
          })),
          settings: { everyNTracks: options.everyNTracks, volume: announcementVolume },
          brandingVersion: 1,
          fetchedAt: new Date(now()).toISOString(),
        };
      }),

    signMedia: (request: SignMediaRequest, signal) =>
      traced("signMedia", { kind: request.kind, id: request.id }, async (): Promise<SignedMedia> => {
        await gate(signal);
        if (faults.consume("nextSignGone")) {
          throw new PlayerApiError("unavailable", `This ${request.kind} is no longer playable (lab: simulated 410).`, 410, "not_found");
        }
        const { expiresAtMs, short } = signedUntil();
        const expiresAt = new Date(expiresAtMs).toISOString();
        if (request.kind === "track") {
          const track = genres.get(request.genreId)?.tracks.find((item) => item.id === request.id);
          if (!track) throw new PlayerApiError("unavailable", "This track is not available (lab: 404).", 404, "not_found");
          const url = faults.consume("nextTrackBrokenUrl")
            ? labAudioUrl(`lab-missing-file-${++brokenUrls}`, null)
            : labAudioUrl(track.id, short ? expiresAtMs : null);
          return { kind: "track", id: track.id, url, expiresAt, durationSeconds: track.durationSeconds, title: track.title, artist: track.artist };
        }
        if (faults.getSnapshot().announcementsFail) {
          throw new PlayerApiError("server", "The announcement could not be signed (lab: simulated 500).", 500, "server_error");
        }
        const announcement = business?.announcements.find((item) => item.id === request.id);
        if (!announcement) throw new PlayerApiError("unavailable", "This announcement is not available (lab: 404).", 404, "not_found");
        return {
          kind: "announcement",
          id: announcement.id,
          url: labAudioUrl(announcement.id, short ? expiresAtMs : null),
          expiresAt,
          durationSeconds: announcement.durationSeconds,
        };
      }),

    savePreferences: (update) =>
      traced("savePreferences", { ...update }, async (): Promise<PlaybackPreferences> => {
        await gate(undefined);
        preferences = { ...preferences, ...update };
        return { ...preferences };
      }),
  };
}
