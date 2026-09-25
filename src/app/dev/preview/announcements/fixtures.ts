/**
 * Fixture data for /dev/preview/announcements (development only): the EmeraldBar example venue
 * from the design pack, its recordings in a few states, and provider options. Clearly fake — the
 * voices are labelled as fixtures and nothing here reaches Supabase or ElevenLabs.
 */
import type { AnnouncementBusiness, AnnouncementItem } from "@/components/admin/announcements/rules";
import type { VenueOption } from "@/components/admin/announcements/VenueSelect";
import type { TtsLanguageOption, TtsOptionsResponse } from "@/lib/api/contracts";
import { languageDisplayName } from "@/lib/tts/models";

export type PreviewTts = "on" | "off" | "rejected";
export type PreviewScenario = "default" | "review" | "empty";

/** Fixed clock so the fixtures render the same on the server and in the browser. */
export const FIXTURE_NOW = Date.parse("2026-09-25T12:00:00.000Z");

const minutesAgo = (minutes: number) => new Date(FIXTURE_NOW - minutes * 60_000).toISOString();

export const FIXTURE_BUSINESS: AnnouncementBusiness = {
  id: "0b1e0000-0000-4000-8000-00000000e001",
  name: "EmeraldBar",
  stationName: "EmeraldBar Radio",
  namePronunciation: "Emerald Bar",
  stationNamePronunciation: null,
  language: "en",
  isActive: true,
  everyNTracks: 4,
  volume: 0.7,
  brandingVersion: 3,
};

export const FIXTURE_VENUES: VenueOption[] = [
  { id: FIXTURE_BUSINESS.id, name: "EmeraldBar", isActive: true },
  { id: "0b1e0000-0000-4000-8000-00000000e002", name: "Hotel Aurora", isActive: true },
  { id: "0b1e0000-0000-4000-8000-00000000e003", name: "Café Central", isActive: true },
  { id: "0b1e0000-0000-4000-8000-00000000e004", name: "Restaurant Olive", isActive: false },
];

export const STATION_ID = "0a2e0000-0000-4000-8000-000000000001";
export const WELCOME_ID = "0a2e0000-0000-4000-8000-000000000002";
export const READY_ID = "0a2e0000-0000-4000-8000-000000000003";
const FAILED_ID = "0a2e0000-0000-4000-8000-000000000004";
const DRAFT_ID = "0a2e0000-0000-4000-8000-000000000005";

function recording(overrides: Partial<AnnouncementItem> & Pick<AnnouncementItem, "id" | "text" | "placement" | "status">): AnnouncementItem {
  return {
    businessId: FIXTURE_BUSINESS.id,
    templateKey: null,
    spokenText: null,
    language: "en",
    source: null,
    hasAudio: false,
    audioDurationSeconds: null,
    voiceId: null,
    voiceName: null,
    modelId: null,
    lastError: null,
    needsReview: false,
    reviewReason: null,
    approvedAt: null,
    generationStartedAt: null,
    createdAt: minutesAgo(60 * 24 * 7),
    updatedAt: minutesAgo(60 * 24 * 7),
    brandingVersion: FIXTURE_BUSINESS.brandingVersion,
    generationAttempts: 0,
    audioSizeBytes: null,
    approvedByEmail: null,
    ...overrides,
  };
}

const stationIdentity = recording({
  id: STATION_ID,
  templateKey: "good_music",
  placement: "rotation",
  text: "Good music. Good company. This is EmeraldBar Radio.",
  spokenText: "Good music. Good company. This is Emerald Bar Radio.",
  status: "active",
  source: "tts",
  hasAudio: true,
  audioDurationSeconds: 4.8,
  voiceId: "fixture-voice-warm",
  voiceName: "Warm voice (fixture)",
  modelId: "eleven_multilingual_v2",
  approvedAt: minutesAgo(60 * 24 * 6),
  approvedByEmail: "admin@frekvencija.online",
  generationAttempts: 1,
  audioSizeBytes: 78_000,
});

const welcomeMessage = recording({
  id: WELCOME_ID,
  templateKey: "welcome_enjoy",
  placement: "welcome",
  text: "Welcome to EmeraldBar. Enjoy the music.",
  spokenText: "Welcome to Emerald Bar. Enjoy the music.",
  status: "active",
  source: "upload",
  hasAudio: true,
  audioDurationSeconds: 3.6,
  approvedAt: minutesAgo(60 * 24 * 5),
  approvedByEmail: "admin@frekvencija.online",
  audioSizeBytes: 61_440,
  createdAt: minutesAgo(60 * 24 * 6),
  updatedAt: minutesAgo(60 * 24 * 5),
});

const readyForReview = recording({
  id: READY_ID,
  templateKey: "station_listening",
  placement: "rotation",
  text: "You’re listening to EmeraldBar Radio.",
  spokenText: "You’re listening to Emerald Bar Radio.",
  status: "ready",
  source: "tts",
  hasAudio: true,
  audioDurationSeconds: 6,
  voiceId: "fixture-voice-warm",
  voiceName: "Warm voice (fixture)",
  modelId: "eleven_multilingual_v2",
  generationAttempts: 1,
  audioSizeBytes: 96_000,
  createdAt: minutesAgo(12),
  updatedAt: minutesAgo(3),
});

const failedGeneration = recording({
  id: FAILED_ID,
  placement: "rotation",
  text: "Happy hour at EmeraldBar starts at five.",
  spokenText: "Happy hour at Emerald Bar starts at five.",
  status: "failed",
  lastError: "ElevenLabs is temporarily unavailable (HTTP 503). Try again in a minute.",
  generationAttempts: 1,
  createdAt: minutesAgo(40),
  updatedAt: minutesAgo(38),
});

const draft = recording({
  id: DRAFT_ID,
  templateKey: "thank_you_visit",
  placement: "both",
  text: "Thank you for spending time with us at EmeraldBar. We hope to see you again soon.",
  spokenText: "Thank you for spending time with us at Emerald Bar. We hope to see you again soon.",
  status: "draft",
  createdAt: minutesAgo(90),
  updatedAt: minutesAgo(90),
});

export function fixtureRecordings(scenario: PreviewScenario): AnnouncementItem[] {
  switch (scenario) {
    case "empty":
      return [];
    case "review":
      return [
        {
          ...stationIdentity,
          needsReview: true,
          reviewReason: 'Branding changed: "Emerald Radio" → "EmeraldBar Radio"',
          brandingVersion: FIXTURE_BUSINESS.brandingVersion - 1,
        },
        welcomeMessage,
        failedGeneration,
        draft,
      ];
    case "default":
      return [stationIdentity, welcomeMessage, readyForReview];
  }
}

function languages(...codes: string[]): TtsLanguageOption[] {
  return codes.map((code) => ({ code, name: languageDisplayName(code) }));
}

/** Demo speech served by /api/dev/audio when `npm run demo:audio` has been run. */
export const DEMO_AUDIO = {
  station: "/api/dev/audio/emeraldbar-station-listening",
  welcome: "/api/dev/audio/emeraldbar-welcome-enjoy",
  other: "/api/dev/audio/emeraldbar-good-music",
} as const;

export function fixtureTtsOptions(tts: PreviewTts): TtsOptionsResponse {
  if (tts === "rejected") {
    return {
      configured: false,
      reason: "The voice provider rejected the configured key. (Fixture: nothing was sent to a provider.)",
    };
  }
  return {
    configured: true,
    defaultModelId: "eleven_multilingual_v2",
    models: [
      {
        id: "eleven_multilingual_v2",
        name: "Eleven Multilingual v2",
        description: "Most natural speech in 29 languages.",
        languages: languages("en", "bg", "hr", "de", "el", "es", "fr", "it", "ro", "tr"),
        maxCharacters: 10_000,
        supportsLanguageCode: false,
      },
      {
        id: "eleven_flash_v2_5",
        name: "Eleven Flash v2.5",
        description: "Fast, lower cost.",
        languages: languages("en", "bg", "hr", "de", "hu", "it"),
        maxCharacters: 40_000,
        supportsLanguageCode: true,
      },
    ],
    voices: [
      {
        id: "fixture-voice-warm",
        name: "Warm voice (fixture)",
        category: "premade",
        description: "Calm and warm; suits lounges and hotel bars.",
        previewUrl: DEMO_AUDIO.welcome,
        labels: { accent: "british", gender: "female", age: "middle_aged" },
      },
      {
        id: "fixture-voice-bright",
        name: "Bright voice (fixture)",
        category: "premade",
        description: "Upbeat and clear.",
        previewUrl: DEMO_AUDIO.other,
        labels: { accent: "american", gender: "male", age: "young" },
      },
    ],
  };
}
