/**
 * Shared fixtures for the business-user player API tests. The session module itself is mocked in
 * each test file (vi.mock is hoisted per file); these helpers build what the mock returns.
 */
import { expect } from "vitest";
import type { ApiErrorBody, ApiErrorCode } from "@/lib/api/contracts";
import { API_CACHE_CONTROL, jsonError } from "@/lib/api/http";
import type { ApiAccess, BusinessUserSessionContext } from "@/lib/auth/session";
import type { FakeSupabase, Row } from "./fake-supabase";

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const BUSINESS_ID = "22222222-2222-4222-8222-222222222222";
export const OTHER_BUSINESS_ID = "33333333-3333-4333-8333-333333333333";

export const GENRE_JAZZ = "a0000000-0000-4000-8000-000000000001";
export const GENRE_LOUNGE = "a0000000-0000-4000-8000-000000000002";
export const GENRE_HIDDEN = "a0000000-0000-4000-8000-000000000003";

export const TRACK_1 = "b0000000-0000-4000-8000-000000000001";
export const TRACK_2 = "b0000000-0000-4000-8000-000000000002";
export const TRACK_3 = "b0000000-0000-4000-8000-000000000003";
export const TRACK_4 = "b0000000-0000-4000-8000-000000000004";

export const ANN_WELCOME = "c0000000-0000-4000-8000-000000000001";
export const ANN_ROTATION = "c0000000-0000-4000-8000-000000000002";
export const ANN_BOTH = "c0000000-0000-4000-8000-000000000003";
export const ANN_STALE = "c0000000-0000-4000-8000-000000000004";
export const ANN_OTHER_BUSINESS = "c0000000-0000-4000-8000-000000000005";

export const BRANDING_VERSION = 3;

export function businessContext(): BusinessUserSessionContext {
  return {
    userId: USER_ID,
    email: "venue@example.com",
    role: "business_user",
    business: { id: BUSINESS_ID, name: "EmeraldBar", stationName: "EmeraldBar Radio", isActive: true },
  };
}

export function grantAccess(fake: FakeSupabase): ApiAccess<BusinessUserSessionContext> {
  return { ok: true, ctx: businessContext(), supabase: fake.client };
}

export function denyAccess(status: number, code: ApiErrorCode, message: string): ApiAccess<BusinessUserSessionContext> {
  return { ok: false, response: jsonError(status, code, message) };
}

/** The denials requireBusinessUserApi() produces; routes must pass them through untouched. */
export const ACCESS_DENIAL_CASES: readonly { status: number; code: ApiErrorCode; message: string }[] = [
  { status: 401, code: "unauthenticated", message: "Your session has expired. Please sign in again." },
  { status: 403, code: "forbidden", message: "This is only available to venue accounts." },
  { status: 403, code: "no_business", message: "Your account is not linked to a venue yet." },
  { status: 403, code: "business_inactive", message: "This venue is not active. Please contact your administrator." },
  { status: 503, code: "unavailable", message: "Sign-in service is temporarily unavailable. Please try again." },
];

export function jsonRequest(url: string, method: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function expectNoStore(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe(API_CACHE_CONTROL);
}

export async function readError(response: Response): Promise<ApiErrorBody["error"] & { status: number }> {
  expectNoStore(response);
  const body = (await response.json()) as ApiErrorBody;
  return { status: response.status, ...body.error };
}

export async function readOk<T>(response: Response): Promise<T> {
  expectNoStore(response);
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Row factories (complete rows, as RLS would return them)
// ---------------------------------------------------------------------------

export function businessRow(overrides: Row = {}): Row {
  return {
    id: BUSINESS_ID,
    name: "EmeraldBar",
    station_name: "EmeraldBar Radio",
    business_type: "bar",
    name_pronunciation: "Emerald Bar",
    station_name_pronunciation: null,
    contact_email: null,
    announcement_language: "en",
    logo_path: `${BUSINESS_ID}/logo.png`,
    is_active: true,
    announcement_every_n_tracks: 4,
    announcement_volume: 0.9,
    branding_version: BRANDING_VERSION,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

export function genreRow(id: string, overrides: Row = {}): Row {
  return {
    id,
    name: `Genre ${id.slice(-1)}`,
    slug: `genre-${id.slice(-1)}`,
    description: null,
    sort_order: 0,
    is_enabled: true,
    available_to_all: true,
    cover_path: null,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

export function trackRow(id: string, genreIds: readonly string[], overrides: Row = {}): Row {
  return {
    id,
    title: `Track ${id.slice(-4)}`,
    artist: "Test Artist",
    duration_seconds: 180,
    storage_path: `tracks/${id}/0123456789abcdef.mp3`,
    file_size_bytes: 3_000_000,
    mime_type: "audio/mpeg",
    bitrate_kbps: 128,
    sample_rate_hz: 44100,
    original_filename: null,
    is_active: true,
    removed_at: null,
    created_by: null,
    created_at: "2026-09-02T10:00:00.000Z",
    updated_at: "2026-09-02T10:00:00.000Z",
    track_genres: genreIds.map((genreId) => ({ track_id: id, genre_id: genreId, created_at: "2026-09-02T10:00:00.000Z" })),
    ...overrides,
  };
}

export function announcementRow(id: string, overrides: Row = {}): Row {
  const businessId = (overrides.business_id as string | undefined) ?? BUSINESS_ID;
  return {
    id,
    business_id: businessId,
    template_key: "welcome_enjoy",
    placement: "rotation",
    text: "Welcome to EmeraldBar.",
    spoken_text: null,
    language: "en",
    status: "active",
    source: "upload",
    audio_path: `${businessId}/${id}/fedcba9876543210.mp3`,
    audio_duration_seconds: 6.5,
    audio_size_bytes: 100_000,
    voice_id: null,
    voice_name: null,
    model_id: null,
    generation_hash: null,
    generation_started_at: null,
    generation_attempts: 0,
    last_error: null,
    needs_review: false,
    review_reason: null,
    branding_version: BRANDING_VERSION,
    approved_at: "2026-09-03T10:00:00.000Z",
    approved_by: null,
    created_by: null,
    created_at: "2026-09-03T10:00:00.000Z",
    updated_at: "2026-09-03T10:00:00.000Z",
    ...overrides,
  };
}

/** The platform_settings singleton (readable by every signed-in user). */
export function platformSettingsRow(overrides: Row = {}): Row {
  return {
    id: true,
    contact_email: null,
    contact_phone: null,
    privacy_policy: null,
    terms_of_service: null,
    default_announcement_every_n_tracks: 4,
    updated_at: "2026-09-05T10:00:00.000Z",
    updated_by: null,
    ...overrides,
  };
}

export function preferencesRow(overrides: Row = {}): Row {
  return {
    user_id: USER_ID,
    business_id: BUSINESS_ID,
    genre_id: null,
    volume: 0.8,
    muted: false,
    created_at: "2026-09-04T10:00:00.000Z",
    updated_at: "2026-09-04T10:00:00.000Z",
    ...overrides,
  };
}
