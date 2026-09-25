/**
 * Shared request/response contracts between route handlers and browser code.
 * Changing a shape here is a breaking change: update every caller and docs/ARCHITECTURE.md.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "no_business"
  | "business_inactive"
  | "not_found"
  | "unavailable"
  | "invalid_request"
  | "rate_limited"
  | "conflict"
  | "payload_too_large"
  | "unsupported_media"
  | "tts_not_configured"
  | "tts_failed"
  | "server_error";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Optional field-level validation messages keyed by field name. */
    fields?: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// Player (business user)
// ---------------------------------------------------------------------------

export type AnnouncementPlacement = "welcome" | "rotation" | "both";

/** Venue category (businesses.business_type). */
export type BusinessType = "cafe" | "restaurant" | "hotel" | "bar" | "other";

/** Owner-configured support/contact details (platform_settings); null when not configured. */
export interface SupportContact {
  email: string | null;
  phone: string | null;
}

export interface PlayerBusiness {
  id: string;
  name: string;
  stationName: string;
  type: BusinessType;
  /** Short-lived signed URL of the venue logo, or null. */
  logoUrl: string | null;
  language: string;
  announcementEveryNTracks: number;
  /** 0.10–1.00 gain applied to announcements. */
  announcementVolume: number;
}

export interface PlayerGenre {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** Number of currently playable tracks in the genre. */
  trackCount: number;
  /**
   * Short-lived signed URL of the owner-uploaded cover image, or null. When null the UI shows the
   * deterministic default artwork from defaultGenreArtwork() in src/lib/brand/genre-artwork.ts.
   */
  coverUrl: string | null;
}

export interface PlaybackPreferences {
  genreId: string | null;
  /** 0–1 */
  volume: number;
  muted: boolean;
}

/** Loaded server-side by the (venue) layout and passed to PlayerProvider. */
export interface PlayerBootstrap {
  userId: string;
  business: PlayerBusiness;
  genres: PlayerGenre[];
  preferences: PlaybackPreferences;
  /** Number of playable announcements by use; informational for the UI. */
  announcementCounts: { welcome: number; rotation: number };
  /**
   * The venue's own playable announcements (for the "Your station voice" card and its Preview).
   * Same eligibility as GET /api/player/announcements. Never contains another venue's clips.
   */
  announcements: AnnouncementSummary[];
  /** How to reach the platform owner (help panel, inactive-venue screen). */
  support: SupportContact;
}

export interface TrackSummary {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
}

/** GET /api/player/genres/[genreId]/tracks */
export interface GenreTracksResponse {
  genreId: string;
  tracks: TrackSummary[];
  /** ISO timestamp */
  fetchedAt: string;
}

export interface AnnouncementSummary {
  id: string;
  placement: AnnouncementPlacement;
  durationSeconds: number | null;
  /** Display wording, e.g. "You’re listening to EmeraldBar Radio." (the venue's own clip only). */
  text: string;
}

/** GET /api/player/announcements */
export interface AnnouncementsResponse {
  announcements: AnnouncementSummary[];
  settings: {
    everyNTracks: number;
    /** 0.10–1.00 */
    volume: number;
  };
  brandingVersion: number;
  fetchedAt: string;
}

/** PUT /api/player/preferences (all fields optional; omitted fields unchanged) */
export interface UpdatePreferencesRequest {
  genreId?: string | null;
  volume?: number;
  muted?: boolean;
}

export interface UpdatePreferencesResponse {
  preferences: PlaybackPreferences;
}

/** POST /api/media/sign */
export type SignMediaRequest =
  | { kind: "track"; id: string; genreId: string }
  | { kind: "announcement"; id: string };

export interface SignedMedia {
  kind: "track" | "announcement";
  id: string;
  url: string;
  /** ISO timestamp when the signed URL stops working. */
  expiresAt: string;
  durationSeconds: number | null;
  /** Present for tracks. */
  title?: string;
  artist?: string;
}

// ---------------------------------------------------------------------------
// Admin uploads
// ---------------------------------------------------------------------------

export type UploadKind = "track" | "track-replace" | "announcement" | "logo" | "genre-cover";

/** POST /api/admin/uploads/sign */
export type SignUploadRequest =
  | { kind: "track"; fileName: string; fileSize: number; contentType: string }
  | { kind: "track-replace"; trackId: string; fileName: string; fileSize: number; contentType: string }
  | { kind: "announcement"; announcementId: string; fileName: string; fileSize: number; contentType: string }
  | { kind: "logo"; businessId: string; fileName: string; fileSize: number; contentType: string }
  | { kind: "genre-cover"; genreId: string; fileName: string; fileSize: number; contentType: string };

export interface SignUploadResponse {
  /** Opaque HMAC token to pass back to /complete. */
  uploadToken: string;
  bucket: "music" | "announcements" | "logos" | "genre-covers";
  path: string;
  /** Absolute signed upload URL (PUT). */
  signedUrl: string;
  /** Upload token issued by Supabase Storage (also embedded in signedUrl). */
  token: string;
  maxBytes: number;
}

/** POST /api/admin/uploads/complete */
export interface CompleteUploadRequest {
  uploadToken: string;
  /**
   * Optional overrides. "track": title, artist, genreIds; "track-replace": title, artist.
   * Ignored for other kinds. The server falls back to ID3 tags / the file name.
   */
  metadata?: {
    title?: string;
    artist?: string;
    genreIds?: string[];
  };
}

export type CompleteUploadResponse =
  | { kind: "track" | "track-replace"; track: AdminTrack }
  | { kind: "announcement"; announcement: AdminAnnouncement }
  | { kind: "logo"; businessId: string; logoPath: string; logoUrl: string }
  | { kind: "genre-cover"; genreId: string; coverPath: string; coverUrl: string };

/** POST /api/admin/media/preview */
export interface AdminPreviewRequest {
  kind: "track" | "announcement";
  id: string;
}

export interface AdminPreviewResponse {
  url: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Admin read models (shared by pages, actions and upload responses)
// ---------------------------------------------------------------------------

export interface AdminTrack {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  fileSizeBytes: number;
  bitrateKbps: number | null;
  originalFilename: string | null;
  isActive: boolean;
  removedAt: string | null;
  genreIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type AnnouncementStatus = "draft" | "generating" | "ready" | "failed" | "active";

export interface AdminAnnouncement {
  id: string;
  businessId: string;
  templateKey: string | null;
  placement: AnnouncementPlacement;
  text: string;
  spokenText: string | null;
  language: string;
  status: AnnouncementStatus;
  source: "upload" | "tts" | null;
  hasAudio: boolean;
  audioDurationSeconds: number | null;
  voiceId: string | null;
  voiceName: string | null;
  modelId: string | null;
  lastError: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  approvedAt: string | null;
  generationStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Admin TTS
// ---------------------------------------------------------------------------

export interface TtsLanguageOption {
  /** ISO 639-1 code as reported by the provider (e.g. "en", "bg"). */
  code: string;
  name: string;
}

export interface TtsModelOption {
  id: string;
  name: string;
  description: string | null;
  languages: TtsLanguageOption[];
  /** Max characters per request for this account tier, if reported. */
  maxCharacters: number | null;
  /** Whether the model honours an explicit language_code parameter. */
  supportsLanguageCode: boolean;
}

export interface TtsVoiceOption {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
}

/** GET /api/admin/tts/options */
export type TtsOptionsResponse =
  | { configured: false; reason: string }
  | {
      configured: true;
      models: TtsModelOption[];
      voices: TtsVoiceOption[];
      defaultModelId: string | null;
    };

/** POST /api/admin/announcements/[id]/generate */
export interface GenerateAnnouncementRequest {
  voiceId: string;
  voiceName?: string;
  modelId: string;
  /** Provider language code; must be supported by the chosen model. */
  languageCode?: string;
  /** Regenerate even if the same request already produced the current audio. */
  force?: boolean;
}

export interface GenerateAnnouncementResponse {
  announcement: AdminAnnouncement;
  /** true when existing audio was reused and no paid request was made. */
  reused: boolean;
}
