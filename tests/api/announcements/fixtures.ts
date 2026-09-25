import type { ApiErrorBody, TtsModelOption, TtsOptionsResponse, TtsVoiceOption } from "@/lib/api/contracts";
import type { FakeSupabase, Row } from "./fake-supabase";

export const ADMIN_ID = "0a1b2c3d-0000-4000-8000-00000000a001";
export const VENUE_USER_ID = "0a1b2c3d-0000-4000-8000-00000000b001";
export const BUSINESS_ID = "1b000000-0000-4000-8000-000000000001";
export const UNKNOWN_ID = "9f000000-0000-4000-8000-000000000099";

export const DRAFT_ID = "4e000000-0000-4000-8000-000000000001";
export const READY_TTS_ID = "4e000000-0000-4000-8000-000000000002";
export const ACTIVE_ID = "4e000000-0000-4000-8000-000000000003";
export const FLAGGED_ACTIVE_ID = "4e000000-0000-4000-8000-000000000004";
export const GENERATING_ID = "4e000000-0000-4000-8000-000000000005";
export const STALE_GENERATING_ID = "4e000000-0000-4000-8000-000000000006";
export const UPLOADED_READY_ID = "4e000000-0000-4000-8000-000000000007";

export const objectPath = (announcementId: string, fill: string) => `${BUSINESS_ID}/${announcementId}/${fill.repeat(32)}.mp3`;
export const READY_TTS_PATH = objectPath(READY_TTS_ID, "a");
export const ACTIVE_PATH = objectPath(ACTIVE_ID, "b");
export const FLAGGED_ACTIVE_PATH = objectPath(FLAGGED_ACTIVE_ID, "c");
export const UPLOADED_READY_PATH = objectPath(UPLOADED_READY_ID, "d");

export const VOICE_ID = "voiceRachel01";
export const OTHER_VOICE_ID = "voiceAdam0002";

export const CREATED = "2026-09-20T10:00:00.000Z";
export const APPROVED_AT = "2026-09-21T10:00:00.000Z";

export function announcementRow(id: string, overrides: Row = {}): Row {
  return {
    id,
    business_id: BUSINESS_ID,
    template_key: "welcome_enjoy",
    placement: "welcome",
    text: "Welcome to EmeraldBar. Enjoy the music.",
    spoken_text: "Welcome to Emerald Bar. Enjoy the music.",
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
    branding_version: 2,
    approved_at: null,
    approved_by: null,
    created_by: ADMIN_ID,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  };
}

export const BUSINESS_ROW: Row = {
  id: BUSINESS_ID,
  name: "EmeraldBar",
  station_name: "EmeraldBar Radio",
  name_pronunciation: "Emerald Bar",
  station_name_pronunciation: null,
  contact_email: null,
  announcement_language: "en",
  logo_path: null,
  is_active: true,
  announcement_every_n_tracks: 4,
  announcement_volume: 1,
  branding_version: 2,
  created_at: CREATED,
  updated_at: CREATED,
};

/** An admin, a venue user, one venue and announcements in every interesting state (with objects). */
export function seedWorld(db: FakeSupabase, now = Date.now()): void {
  db.seed("profiles", [
    { id: ADMIN_ID, email: "admin@example.com", role: "platform_admin" },
    { id: VENUE_USER_ID, email: "venue@example.com", role: "business_user" },
  ]);
  db.seed("business_members", [{ business_id: BUSINESS_ID, user_id: VENUE_USER_ID, created_at: CREATED }]);
  db.seed("businesses", [BUSINESS_ROW]);
  const tts = {
    source: "tts",
    audio_duration_seconds: 3.1,
    audio_size_bytes: 50_000,
    voice_id: VOICE_ID,
    voice_name: "Rachel",
    model_id: "eleven_multilingual_v2",
    generation_hash: "0".repeat(64),
  };
  db.seed("announcements", [
    announcementRow(DRAFT_ID),
    announcementRow(READY_TTS_ID, { status: "ready", audio_path: READY_TTS_PATH, ...tts, generation_attempts: 1 }),
    announcementRow(ACTIVE_ID, { status: "active", audio_path: ACTIVE_PATH, ...tts, approved_at: APPROVED_AT, approved_by: ADMIN_ID }),
    announcementRow(FLAGGED_ACTIVE_ID, {
      status: "active",
      audio_path: FLAGGED_ACTIVE_PATH,
      ...tts,
      approved_at: APPROVED_AT,
      approved_by: ADMIN_ID,
      branding_version: 1,
      needs_review: true,
      review_reason: 'Branding changed: "Emerald Radio" → "EmeraldBar Radio"',
    }),
    announcementRow(GENERATING_ID, { status: "generating", generation_started_at: new Date(now - 30_000).toISOString(), generation_attempts: 1 }),
    announcementRow(STALE_GENERATING_ID, {
      status: "generating",
      generation_started_at: new Date(now - 10 * 60_000).toISOString(),
      generation_attempts: 2,
    }),
    announcementRow(UPLOADED_READY_ID, {
      status: "ready",
      source: "upload",
      audio_path: UPLOADED_READY_PATH,
      audio_duration_seconds: 5,
      audio_size_bytes: 80_000,
    }),
  ]);
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  for (const path of [READY_TTS_PATH, ACTIVE_PATH, FLAGGED_ACTIVE_PATH, UPLOADED_READY_PATH]) db.putObject("announcements", path, bytes, "audio/mpeg");
}

export const MULTILINGUAL_V2: TtsModelOption = {
  id: "eleven_multilingual_v2",
  name: "Eleven Multilingual v2",
  description: "Most stable",
  languages: [
    { code: "bg", name: "Bulgarian" },
    { code: "en", name: "English" },
    { code: "hr", name: "Croatian" },
  ],
  maxCharacters: 10_000,
  supportsLanguageCode: false,
};

export const ELEVEN_V3: TtsModelOption = {
  id: "eleven_v3",
  name: "Eleven v3",
  description: "Expressive",
  languages: [
    { code: "en", name: "English" },
    { code: "sr", name: "Serbian" },
  ],
  maxCharacters: 20,
  supportsLanguageCode: true,
};

export const FLASH: TtsModelOption = {
  id: "eleven_flash_v2_5",
  name: "Eleven Flash v2.5",
  description: null,
  languages: [
    { code: "en", name: "English" },
    { code: "hu", name: "Hungarian" },
  ],
  maxCharacters: 40_000,
  supportsLanguageCode: true,
};

export const VOICES: TtsVoiceOption[] = [
  { id: VOICE_ID, name: "Rachel", category: "premade", description: null, previewUrl: "https://cdn.test/rachel.mp3", labels: { accent: "american" } },
  { id: OTHER_VOICE_ID, name: "Adam", category: "premade", description: null, previewUrl: null, labels: {} },
];

export function configuredOptions(): TtsOptionsResponse {
  return { configured: true, models: [MULTILINGUAL_V2, ELEVEN_V3, FLASH], voices: VOICES, defaultModelId: MULTILINGUAL_V2.id };
}

export function jsonRequest(url: string, body: unknown, init: { contentType?: string; method?: string } = {}): Request {
  return new Request(`http://localhost${url}`, {
    method: init.method ?? "POST",
    headers: { "content-type": init.contentType ?? "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function errorOf(response: Response): Promise<{ status: number; code: string; message: string; fields?: Record<string, string> }> {
  const body = (await response.json()) as ApiErrorBody;
  return { status: response.status, ...body.error };
}
