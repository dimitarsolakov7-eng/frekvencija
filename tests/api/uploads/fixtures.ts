import type { ApiErrorBody } from "@/lib/api/contracts";
import type { Mp3Metadata } from "@/lib/audio/mp3";
import type { FakeSupabase } from "./fake-supabase";

export const ADMIN_ID = "0a1b2c3d-0000-4000-8000-00000000a001";
export const OTHER_ADMIN_ID = "0a1b2c3d-0000-4000-8000-00000000a002";
export const VENUE_USER_ID = "0a1b2c3d-0000-4000-8000-00000000b001";

export const BUSINESS_ID = "1b000000-0000-4000-8000-000000000001";
export const GENRE_JAZZ = "2c000000-0000-4000-8000-000000000001";
export const GENRE_LOUNGE = "2c000000-0000-4000-8000-000000000002";

export const TRACK_ID = "3d000000-0000-4000-8000-000000000001";
export const REMOVED_TRACK_ID = "3d000000-0000-4000-8000-000000000002";
export const TRACK_PATH = `tracks/${TRACK_ID}/${"a".repeat(32)}.mp3`;
export const REMOVED_TRACK_PATH = `tracks/${REMOVED_TRACK_ID}/${"b".repeat(32)}.mp3`;

export const DRAFT_ANNOUNCEMENT_ID = "4e000000-0000-4000-8000-000000000001";
export const ACTIVE_ANNOUNCEMENT_ID = "4e000000-0000-4000-8000-000000000002";
export const GENERATING_ANNOUNCEMENT_ID = "4e000000-0000-4000-8000-000000000003";
export const ACTIVE_ANNOUNCEMENT_PATH = `${BUSINESS_ID}/${ACTIVE_ANNOUNCEMENT_ID}/${"c".repeat(32)}.mp3`;
export const OLD_LOGO_PATH = `${BUSINESS_ID}/${"d".repeat(32)}.png`;
/** Jazz already has a cover; Lounge has none. */
export const OLD_COVER_PATH = `${GENRE_JAZZ}/${"e".repeat(32)}.jpg`;

export const UNKNOWN_ID = "9f000000-0000-4000-8000-000000000099";

export const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]);
/** Minimal PNG header (signature + IHDR chunk type) — enough for sniffImage(). */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);

export function mp3Metadata(overrides: Partial<Mp3Metadata> = {}): Mp3Metadata {
  return {
    ok: true,
    durationSeconds: 187.42,
    bitrateKbps: 192,
    sampleRateHz: 44100,
    channels: 2,
    codec: "MPEG 1 Layer 3",
    title: null,
    artist: null,
    ...overrides,
  };
}

const CREATED = "2026-09-20T10:00:00.000Z";

function announcementRow(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    business_id: BUSINESS_ID,
    template_key: "welcome_enjoy",
    placement: "welcome",
    text: "Welcome to EmeraldBar.",
    spoken_text: null,
    language: "en",
    status: "draft",
    source: null,
    audio_path: null,
    audio_duration_seconds: null,
    audio_size_bytes: null,
    voice_id: null,
    voice_name: null,
    model_id: null,
    generation_hash: null,
    generation_started_at: null,
    generation_attempts: 0,
    last_error: null,
    needs_review: false,
    review_reason: null,
    branding_version: 1,
    approved_at: null,
    approved_by: null,
    created_by: ADMIN_ID,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  };
}

/** Admins, a venue user, one venue, two genres, two tracks and three announcements (with objects). */
export function seedWorld(db: FakeSupabase): void {
  db.seed("profiles", [
    { id: ADMIN_ID, email: "admin@example.com", role: "platform_admin" },
    { id: OTHER_ADMIN_ID, email: "other-admin@example.com", role: "platform_admin" },
    { id: VENUE_USER_ID, email: "venue@example.com", role: "business_user" },
  ]);
  db.seed("business_members", [{ business_id: BUSINESS_ID, user_id: VENUE_USER_ID, created_at: CREATED }]);
  db.seed("businesses", [{ id: BUSINESS_ID, name: "EmeraldBar", station_name: "EmeraldBar Radio", logo_path: OLD_LOGO_PATH, is_active: true }]);
  db.seed("genres", [
    { id: GENRE_JAZZ, name: "Jazz", slug: "jazz", cover_path: OLD_COVER_PATH },
    { id: GENRE_LOUNGE, name: "Lounge", slug: "lounge", cover_path: null },
  ]);
  db.seed("tracks", [
    {
      id: TRACK_ID,
      title: "Blue Moon",
      artist: "The Quartet",
      duration_seconds: 120.5,
      storage_path: TRACK_PATH,
      file_size_bytes: 1_000_000,
      mime_type: "audio/mpeg",
      bitrate_kbps: 128,
      sample_rate_hz: 44100,
      original_filename: "blue-moon.mp3",
      is_active: true,
      removed_at: null,
      created_by: ADMIN_ID,
      created_at: CREATED,
      updated_at: CREATED,
    },
    {
      id: REMOVED_TRACK_ID,
      title: "Old Song",
      artist: "Unknown Artist",
      duration_seconds: 60,
      storage_path: REMOVED_TRACK_PATH,
      file_size_bytes: 500_000,
      mime_type: "audio/mpeg",
      bitrate_kbps: null,
      sample_rate_hz: null,
      original_filename: null,
      is_active: false,
      removed_at: "2026-09-21T10:00:00.000Z",
      created_by: ADMIN_ID,
      created_at: CREATED,
      updated_at: CREATED,
    },
  ]);
  db.seed("track_genres", [
    { track_id: TRACK_ID, genre_id: GENRE_JAZZ, created_at: CREATED },
    { track_id: TRACK_ID, genre_id: GENRE_LOUNGE, created_at: CREATED },
  ]);
  db.seed("announcements", [
    announcementRow(DRAFT_ANNOUNCEMENT_ID, {}),
    announcementRow(ACTIVE_ANNOUNCEMENT_ID, {
      status: "active",
      source: "tts",
      audio_path: ACTIVE_ANNOUNCEMENT_PATH,
      audio_duration_seconds: 4.2,
      audio_size_bytes: 67_000,
      voice_id: "voice123",
      voice_name: "Rachel",
      model_id: "eleven_multilingual_v2",
      generation_hash: "f".repeat(64),
      needs_review: true,
      review_reason: "Branding changed",
      approved_at: "2026-09-21T10:00:00.000Z",
      approved_by: ADMIN_ID,
      last_error: "old failure",
    }),
    announcementRow(GENERATING_ANNOUNCEMENT_ID, {
      status: "generating",
      generation_started_at: new Date(Date.now() - 30_000).toISOString(),
    }),
  ]);
  db.putObject("music", TRACK_PATH, MP3_BYTES, "audio/mpeg");
  db.putObject("music", REMOVED_TRACK_PATH, MP3_BYTES, "audio/mpeg");
  db.putObject("announcements", ACTIVE_ANNOUNCEMENT_PATH, MP3_BYTES, "audio/mpeg");
  db.putObject("logos", OLD_LOGO_PATH, PNG_BYTES, "image/png");
  db.putObject("genre-covers", OLD_COVER_PATH, JPEG_BYTES, "image/jpeg");
}

export function jsonRequest(url: string, body: unknown, init: { contentType?: string } = {}): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": init.contentType ?? "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function errorOf(response: Response): Promise<{ status: number; code: string; message: string; fields?: Record<string, string> }> {
  const body = (await response.json()) as ApiErrorBody;
  return { status: response.status, ...body.error };
}
