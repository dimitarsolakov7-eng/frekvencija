/**
 * Announcement state rules shared by server actions, route handlers and the admin UI
 * (docs/ARCHITECTURE.md §5.2 state machine). Pure: callers pass `now` explicitly.
 *
 *   draft ──generate──▶ generating ──ok──▶ ready ──approve──▶ active ──deactivate──▶ ready
 *                           └──fail──▶ failed
 *   upload MP3 (any state but a fresh `generating`) ──▶ ready (approval required again)
 *   edit spoken wording / voice / model / language of TTS audio ──▶ draft (audio discarded)
 *   branding change ──▶ needs_review (approve again)
 *
 * Every rule has a `check*` form returning a user-facing reason and a boolean `can*` shorthand.
 * The DB checks (`ready`/`active` need audio, `active` needs `approved_at`) are the backstop.
 */
import type { AnnouncementStatus } from "@/lib/api/contracts";
import type { Tables, TablesUpdate } from "@/types/database";

/** A `generating` lock older than this is stale and may be retried. */
export const GENERATION_LOCK_MS = 3 * 60 * 1000;

/** The state fields every rule reads. `AdminAnnouncement` satisfies this shape. */
export interface AnnouncementStateFields {
  status: AnnouncementStatus;
  source: "upload" | "tts" | null;
  hasAudio: boolean;
  needsReview: boolean;
  /** ISO timestamp of the generating lock. */
  generationStartedAt: string | null;
  approvedAt: string | null;
}

/** Wording and TTS parameters. `AdminAnnouncement` satisfies this shape. */
export interface AnnouncementWording {
  text: string;
  /** null ⇒ `text` is spoken. */
  spokenText: string | null;
  voiceId: string | null;
  modelId: string | null;
  language: string;
}

export type AnnouncementState = AnnouncementStateFields &
  AnnouncementWording & {
    brandingVersion: number;
    lastError: string | null;
    reviewReason: string | null;
  };

type AnnouncementRowFields = Pick<
  Tables<"announcements">,
  | "status"
  | "source"
  | "audio_path"
  | "needs_review"
  | "generation_started_at"
  | "approved_at"
  | "text"
  | "spoken_text"
  | "voice_id"
  | "model_id"
  | "language"
  | "branding_version"
  | "last_error"
  | "review_reason"
>;

/** Maps a database row onto the shape the rules use. */
export function toAnnouncementState(row: AnnouncementRowFields): AnnouncementState {
  return {
    status: row.status,
    source: row.source,
    hasAudio: row.audio_path !== null,
    needsReview: row.needs_review,
    generationStartedAt: row.generation_started_at,
    approvedAt: row.approved_at,
    text: row.text,
    spokenText: row.spoken_text,
    voiceId: row.voice_id,
    modelId: row.model_id,
    language: row.language,
    brandingVersion: row.branding_version,
    lastError: row.last_error,
    reviewReason: row.review_reason,
  };
}

/**
 * Columns to write when an announcement's audio is discarded (the caller also removes the Storage
 * object). Approval belongs to the audio, so it is cleared too; voice and model are kept as the
 * suggestion for the next generation.
 */
export const CLEARED_AUDIO_FIELDS = {
  audio_path: null,
  audio_duration_seconds: null,
  audio_size_bytes: null,
  source: null,
  generation_hash: null,
  approved_at: null,
  approved_by: null,
} as const satisfies TablesUpdate<"announcements">;

export type RuleCheck = { ok: true } | { ok: false; reason: string };

const allow: RuleCheck = { ok: true };
const deny = (reason: string): RuleCheck => ({ ok: false, reason });

type Instant = Date | number;
const toMillis = (now: Instant) => (typeof now === "number" ? now : now.getTime());

// ---------------------------------------------------------------------------
// Generation lock
// ---------------------------------------------------------------------------

type LockFields = Pick<AnnouncementStateFields, "status" | "generationStartedAt">;

/** True for a `generating` lock older than 3 minutes, or one without a readable timestamp. */
export function isGenerationStale(a: LockFields, now: Instant): boolean {
  if (a.status !== "generating") return false;
  const started = a.generationStartedAt ? Date.parse(a.generationStartedAt) : Number.NaN;
  if (Number.isNaN(started)) return true;
  return toMillis(now) - started >= GENERATION_LOCK_MS;
}

/** True while another request is generating audio for this announcement. */
export function isGenerationInProgress(a: LockFields, now: Instant): boolean {
  return a.status === "generating" && !isGenerationStale(a, now);
}

const GENERATION_BUSY = "Audio is being generated for this announcement. Wait for it to finish (at most 3 minutes).";

export function checkGenerate(a: LockFields, now: Instant): RuleCheck {
  return isGenerationInProgress(a, now) ? deny(GENERATION_BUSY) : allow;
}

export function canGenerate(a: LockFields, now: Instant): boolean {
  return checkGenerate(a, now).ok;
}

/** Uploading replacement audio is allowed in every state except during a fresh generation. */
export function checkUploadAudio(a: LockFields, now: Instant): RuleCheck {
  return isGenerationInProgress(a, now) ? deny(GENERATION_BUSY) : allow;
}

/** Wording must not change under a running generation (its audio would not match). */
export function checkEditWording(a: LockFields, now: Instant): RuleCheck {
  return isGenerationInProgress(a, now) ? deny(GENERATION_BUSY) : allow;
}

// ---------------------------------------------------------------------------
// Approval and activation
// ---------------------------------------------------------------------------

/** Approve: `ready` audio, or an `active` announcement flagged for review after a branding change. */
export function checkApprove(a: Pick<AnnouncementStateFields, "status" | "hasAudio" | "needsReview">): RuleCheck {
  if (a.status === "active" && !a.needsReview) return deny("This announcement is already approved and active.");
  if (a.status === "generating") return deny("Wait for the audio to finish generating before approving it.");
  if (a.status !== "ready" && a.status !== "active") return deny("There is no audio to approve yet. Generate it or upload an MP3.");
  if (!a.hasAudio) return deny("There is no audio to approve yet. Generate it or upload an MP3.");
  return allow;
}

export function canApprove(a: Pick<AnnouncementStateFields, "status" | "hasAudio" | "needsReview">): boolean {
  return checkApprove(a).ok;
}

/**
 * Activate: put a previously approved, deactivated announcement back on air. Anything new, changed
 * or flagged for review goes through approval instead.
 */
export function checkActivate(a: Pick<AnnouncementStateFields, "status" | "hasAudio" | "needsReview" | "approvedAt">): RuleCheck {
  if (a.status === "active") return deny("This announcement is already active.");
  if (a.status !== "ready" || !a.hasAudio) return deny("Only announcements with ready audio can be activated.");
  if (a.needsReview) return deny("The venue's branding changed since this was approved. Review and approve it again.");
  if (!a.approvedAt) return deny("Approve this announcement first.");
  return allow;
}

export function canActivate(a: Pick<AnnouncementStateFields, "status" | "hasAudio" | "needsReview" | "approvedAt">): boolean {
  return checkActivate(a).ok;
}

export function checkDeactivate(a: Pick<AnnouncementStateFields, "status">): RuleCheck {
  return a.status === "active" ? allow : deny("Only active announcements can be deactivated.");
}

export function canDeactivate(a: Pick<AnnouncementStateFields, "status">): boolean {
  return checkDeactivate(a).ok;
}

// ---------------------------------------------------------------------------
// Wording edits
// ---------------------------------------------------------------------------

/** New values from an edit; omitted fields are unchanged. */
export interface WordingChanges {
  text?: string;
  /** null ⇒ speak `text`. */
  spokenText?: string | null;
  voiceId?: string | null;
  modelId?: string | null;
  language?: string;
}

export interface WordingEditOutcome {
  /** Status to store after the edit. */
  status: AnnouncementStatus;
  /**
   * The generated audio no longer matches: write CLEARED_AUDIO_FIELDS and delete the Storage object.
   */
  audioInvalidated: boolean;
  /** Something that is sent to TTS (spoken wording, voice, model, language) changed. */
  ttsInputChanged: boolean;
  /** `last_error` described the previous wording and should be cleared. */
  clearLastError: boolean;
  /** Admin-facing note about what happened to the audio, or null when nothing did. */
  message: string | null;
}

const spokenWording = (text: string, spokenText: string | null) => (spokenText ?? text).trim();

/**
 * Status after editing the wording or TTS parameters. Generated audio is discarded (⇒ draft) when
 * what would be spoken changes; uploaded audio is kept as it is. Call checkEditWording() first: an
 * edit must not land under a running generation.
 */
export function statusAfterWordingEdit(
  a: Pick<AnnouncementStateFields, "status" | "source" | "hasAudio"> & AnnouncementWording,
  changes: WordingChanges,
): WordingEditOutcome {
  const nextText = changes.text ?? a.text;
  const nextSpoken = changes.spokenText === undefined ? a.spokenText : changes.spokenText;
  const changed = <K extends "voiceId" | "modelId" | "language">(key: K) => changes[key] !== undefined && changes[key] !== a[key];
  const ttsInputChanged =
    spokenWording(a.text, a.spokenText) !== spokenWording(nextText, nextSpoken) ||
    changed("voiceId") ||
    changed("modelId") ||
    changed("language");

  const unchanged: WordingEditOutcome = {
    status: a.status,
    audioInvalidated: false,
    ttsInputChanged,
    clearLastError: false,
    message: null,
  };
  if (!ttsInputChanged) return unchanged;

  if (a.hasAudio && a.source === "upload") {
    return { ...unchanged, message: "The uploaded audio was kept. Check that it still matches the new wording." };
  }
  if (a.hasAudio && a.source === "tts") {
    return {
      status: "draft",
      audioInvalidated: true,
      ttsInputChanged,
      clearLastError: true,
      message: "The spoken wording or voice changed, so the generated audio was removed. Generate it again.",
    };
  }
  // No audio: a failure (or a stale lock) referred to the old wording, so start over as a draft.
  if (!a.hasAudio && (a.status === "failed" || a.status === "generating")) {
    return { status: "draft", audioInvalidated: false, ttsInputChanged, clearLastError: true, message: null };
  }
  return unchanged;
}

// ---------------------------------------------------------------------------
// Playback and display
// ---------------------------------------------------------------------------

/** Same rule as the RLS policy: active, not flagged, has audio, current branding, venue active. */
export function isPlayable(
  a: Pick<AnnouncementStateFields, "status" | "needsReview" | "hasAudio"> & { brandingVersion: number },
  business: { isActive: boolean; brandingVersion: number },
): boolean {
  return a.status === "active" && !a.needsReview && a.hasAudio && a.brandingVersion === business.brandingVersion && business.isActive;
}

/** Same union as the UI Badge `tone` prop. */
export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export interface StatusDescription {
  label: string;
  tone: StatusTone;
  description: string;
}

/** Badge label, tone and explanation for the admin list. `now` decides whether a generation stalled. */
export function describeStatus(
  a: Pick<AnnouncementStateFields, "status" | "needsReview" | "generationStartedAt"> & {
    lastError?: string | null;
    reviewReason?: string | null;
  },
  now: Instant,
): StatusDescription {
  switch (a.status) {
    case "active":
      return a.needsReview
        ? {
            label: "Needs review",
            tone: "warning",
            description: `${a.reviewReason ?? "The venue's branding changed."} It is off air until you approve it again.`,
          }
        : { label: "Active", tone: "success", description: "Plays on the venue's radio." };
    case "ready":
      return {
        label: "Awaiting approval",
        tone: "info",
        description: a.needsReview
          ? `${a.reviewReason ?? "The venue's branding changed."} Listen to it and approve it to put it on air.`
          : "Listen to the audio and approve it to put it on air.",
      };
    case "generating":
      return isGenerationStale(a, now)
        ? { label: "Generation stalled", tone: "warning", description: "Generating the audio did not finish. Try again." }
        : { label: "Generating…", tone: "info", description: "The audio is being generated." };
    case "failed":
      return { label: "Failed", tone: "danger", description: a.lastError ?? "Generating the audio failed. Try again." };
    case "draft":
      return { label: "Draft", tone: "neutral", description: "No audio yet. Generate it or upload an MP3." };
  }
}
