/**
 * Admin announcement rules on top of the foundation state machine (src/lib/announcements/state.ts):
 * which actions an admin may take on an announcement, how its status is described, and the
 * "on-air audio is never put at risk" rule for AI generation.
 *
 * Pure and client-safe: used by the admin UI, the Server Actions and the generate route handler.
 * `now` is always explicit (React Compiler forbids reading the clock during render).
 *
 * REGENERATING ON-AIR ANNOUNCEMENTS (the rule this module enforces)
 * An announcement that is on air (status `active` and not flagged for review) is never regenerated
 * in place: switching it to `generating` would take approved audio off air for the duration of the
 * call, and a failed call must not leave the venue without it. The admin either duplicates it
 * (the copy is generated and approved while the original keeps playing, then the original is
 * deactivated) or deactivates it first. Everything that is not on air follows the normal flow:
 * `generating` → `ready` on success. On failure the row goes to `failed` when it had no audio;
 * when it already had audio (e.g. a flagged or deactivated announcement) that audio and its status
 * are kept and only `last_error` records the failure, so nothing that worked is lost.
 */
import type { AdminAnnouncement, AnnouncementStatus } from "@/lib/api/contracts";
import {
  checkActivate,
  checkApprove,
  checkDeactivate,
  checkEditWording,
  checkGenerate,
  checkUploadAudio,
  describeStatus,
  isGenerationInProgress,
  isGenerationStale,
  type RuleCheck,
  type StatusDescription,
} from "@/lib/announcements/state";

type Instant = Date | number;

// ---------------------------------------------------------------------------
// View models (shared by the page loader and the client components)
// ---------------------------------------------------------------------------

/** An announcement as the admin page shows it: the contract shape plus a few admin-only columns. */
export interface AnnouncementItem extends AdminAnnouncement {
  /** Business branding version this announcement was created or approved with. */
  brandingVersion: number;
  generationAttempts: number;
  audioSizeBytes: number | null;
  /** Email of the admin who approved the current audio, when known. */
  approvedByEmail: string | null;
}

/** The venue fields the announcements page needs. */
export interface AnnouncementBusiness {
  id: string;
  name: string;
  stationName: string;
  namePronunciation: string | null;
  stationNamePronunciation: string | null;
  /** Default announcement language (BCP-47-ish, e.g. "en", "sr-Latn"). */
  language: string;
  isActive: boolean;
  everyNTracks: number;
  /** 0.10–1.00 gain applied to announcements. */
  volume: number;
  brandingVersion: number;
}

type ReviewFields = Pick<AnnouncementItem, "needsReview" | "approvedAt" | "brandingVersion">;
type BrandingFields = Pick<AnnouncementBusiness, "brandingVersion">;

const allow: RuleCheck = { ok: true };
const deny = (reason: string): RuleCheck => ({ ok: false, reason });

export const BRANDING_CHANGED_REASON = "The venue's branding changed after this was approved.";

export const ON_AIR_GENERATE_REASON =
  "This announcement is on air, so its audio is not replaced in place. Duplicate it, generate and approve the copy, " +
  "then deactivate this one — or deactivate it first.";

// ---------------------------------------------------------------------------
// Review and on-air state
// ---------------------------------------------------------------------------

/**
 * Whether the announcement must be (re-)approved because of a branding change. Besides the
 * `needs_review` flag set by the database trigger, approved audio recorded under an older branding
 * version counts too (covers an approval that raced with a branding change).
 */
export function needsReview(a: ReviewFields, business: BrandingFields): boolean {
  return a.needsReview || (a.approvedAt !== null && a.brandingVersion !== business.brandingVersion);
}

/** The announcement with `needsReview` resolved as above, ready for the foundation rules. */
export function withEffectiveReview<T extends ReviewFields & { reviewReason: string | null }>(a: T, business: BrandingFields): T {
  if (!needsReview(a, business) || a.needsReview) return a;
  return { ...a, needsReview: true, reviewReason: a.reviewReason ?? BRANDING_CHANGED_REASON };
}

/** Approved and not flagged: this is what the venue's radio plays (while the venue is active). */
export function isOnAir(a: ReviewFields & Pick<AnnouncementItem, "status">, business: BrandingFields): boolean {
  return a.status === "active" && !needsReview(a, business);
}

type GenerateFields = ReviewFields & Pick<AnnouncementItem, "status" | "generationStartedAt">;

/** Generate (or regenerate) audio in place: not during another generation, and never while on air. */
export function checkGenerateInPlace(a: GenerateFields, business: BrandingFields, now: Instant): RuleCheck {
  const lock = checkGenerate(a, now);
  if (!lock.ok) return lock;
  if (isOnAir(a, business)) return deny(ON_AIR_GENERATE_REASON);
  return allow;
}

/**
 * Status to store when a generation attempt fails. Without audio the announcement is `failed`;
 * with audio (never on air — see checkGenerateInPlace) the previous status is kept so the existing
 * audio can still be approved or re-activated. A stale lock or a `failed` row that somehow has
 * audio falls back to `ready`, which always needs (re-)approval before it plays.
 */
export function generationFailureStatus(previous: AnnouncementStatus, hadAudio: boolean): AnnouncementStatus {
  if (!hadAudio) return "failed";
  return previous === "generating" || previous === "failed" ? "ready" : previous;
}

// ---------------------------------------------------------------------------
// Available actions
// ---------------------------------------------------------------------------

export interface AnnouncementActions {
  preview: RuleCheck;
  /** Approve & activate (new audio, or re-approval after a branding change). */
  approve: RuleCheck;
  /** Put previously approved, deactivated audio back on air. */
  activate: RuleCheck;
  deactivate: RuleCheck;
  editWording: RuleCheck;
  uploadAudio: RuleCheck;
  generate: RuleCheck;
  duplicate: RuleCheck;
  remove: RuleCheck;
  /** Release a stalled (> 3 min) generation lock. */
  markFailed: RuleCheck;
}

const GENERATION_BUSY = "Wait for the audio generation to finish.";

export function availableActions(a: AnnouncementItem, business: BrandingFields, now: Instant): AnnouncementActions {
  const effective = withEffectiveReview(a, business);
  const busy = isGenerationInProgress(a, now);
  const activate = checkActivate(effective);
  return {
    preview: a.hasAudio ? allow : deny("There is no audio yet."),
    // Deactivated audio that is still approved goes back on air with Activate, not a new approval.
    approve: activate.ok ? deny("This audio is already approved. Activate it instead.") : checkApprove(effective),
    activate,
    deactivate: checkDeactivate(effective),
    editWording: checkEditWording(a, now),
    uploadAudio: checkUploadAudio(a, now),
    generate: checkGenerateInPlace(a, business, now),
    duplicate: allow,
    remove: busy ? deny(GENERATION_BUSY) : allow,
    markFailed: isGenerationStale(a, now) ? allow : deny("Only a stalled generation can be marked as failed."),
  };
}

export type PrimaryAction = "approve" | "activate" | "generate" | null;

/** The single most useful next step, shown as the card's primary button. */
export function primaryAction(actions: AnnouncementActions, a: Pick<AnnouncementItem, "hasAudio">): PrimaryAction {
  if (actions.approve.ok) return "approve";
  if (actions.activate.ok) return "activate";
  // A stalled generation or an announcement without audio: generating is the way forward.
  if (actions.generate.ok && (actions.markFailed.ok || !a.hasAudio)) return "generate";
  return null;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Ends a message with sentence punctuation (review reasons from the database have none). */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Badge + explanation, refining describeStatus() with the admin page's extra context. */
export function describeAnnouncement(a: AnnouncementItem, business: Pick<AnnouncementBusiness, "brandingVersion" | "isActive">, now: Instant): StatusDescription {
  const reviewed = withEffectiveReview(a, business);
  const effective = reviewed.reviewReason ? { ...reviewed, reviewReason: asSentence(reviewed.reviewReason) } : reviewed;
  if (effective.status === "ready" && effective.approvedAt && !effective.needsReview) {
    return { label: "Inactive", tone: "neutral", description: "Approved, but switched off. Activate it to put it back on air." };
  }
  if (effective.status === "active" && !effective.needsReview && !business.isActive) {
    return {
      label: "Active",
      tone: "success",
      description: "Approved. The venue is inactive, so it plays once the venue is activated.",
    };
  }
  if (effective.status === "generating" && effective.hasAudio && isGenerationInProgress(effective, now)) {
    return {
      label: "Generating…",
      tone: "info",
      description: "New audio is being generated. The current audio is kept until it succeeds.",
    };
  }
  return describeStatus(effective, now);
}

export function sourceLabel(source: AnnouncementItem["source"]): string {
  switch (source) {
    case "upload":
      return "Uploaded MP3";
    case "tts":
      return "AI voice (ElevenLabs)";
    default:
      return "No audio yet";
  }
}

const MODEL_LABELS: Readonly<Record<string, string>> = {
  eleven_multilingual_v2: "Multilingual v2",
  eleven_v3: "Eleven v3",
  eleven_flash_v2_5: "Flash v2.5",
  eleven_flash_v2: "Flash v2",
};

/** Friendly name for a stored ElevenLabs model id (the id itself when unknown). */
export function modelLabel(modelId: string | null): string | null {
  if (!modelId) return null;
  return MODEL_LABELS[modelId] ?? modelId;
}

/** What the AI voice says: the spoken wording, or the display text when there is none. */
export function spokenWording(a: Pick<AnnouncementItem, "text" | "spokenText">): string {
  return (a.spokenText ?? a.text).trim();
}

export interface AnnouncementSummary {
  total: number;
  /** Active and not flagged: what the venue's radio plays. */
  onAir: number;
  /** On-air clips that play as the welcome message (placement welcome or both). */
  onAirWelcome: number;
  /** On-air clips that play between songs (placement rotation or both). */
  onAirRotation: number;
  /** Audio ready, never approved, not flagged ("Ready for review"). */
  awaitingApproval: number;
  /** Approved audio that was switched off (status ready), not flagged: Activate puts it back on air. */
  switchedOff: number;
  /** Flagged after a branding change, whatever the status (drafts too: their wording may use the old names). */
  needsReview: number;
  /** Generation failed, or its lock stalled. */
  failed: number;
  /** A generation is running. */
  generating: number;
  /** No audio yet and not flagged. */
  drafts: number;
  withoutAudio: number;
}

/** The fields the summary reads. AnnouncementItem has them; the business page loads just these. */
export type AnnouncementSummaryInput = Pick<
  AnnouncementItem,
  "status" | "placement" | "needsReview" | "approvedAt" | "brandingVersion" | "generationStartedAt" | "hasAudio"
>;

/**
 * Counts for the studio's header and needs-review banner, and for the Announcements tab of the
 * business page: both screens use this one classification, so they always agree.
 */
export function summarizeAnnouncements(
  items: readonly AnnouncementSummaryInput[],
  business: BrandingFields,
  now: Instant,
): AnnouncementSummary {
  const summary: AnnouncementSummary = {
    total: items.length,
    onAir: 0,
    onAirWelcome: 0,
    onAirRotation: 0,
    awaitingApproval: 0,
    switchedOff: 0,
    needsReview: 0,
    failed: 0,
    generating: 0,
    drafts: 0,
    withoutAudio: 0,
  };
  for (const item of items) {
    const flagged = needsReview(item, business);
    if (isOnAir(item, business)) {
      summary.onAir += 1;
      if (item.placement !== "rotation") summary.onAirWelcome += 1;
      if (item.placement !== "welcome") summary.onAirRotation += 1;
    }
    // Drafts are flagged too: their stored wording may still use the old names.
    if (flagged) summary.needsReview += 1;
    if (item.status === "ready" && !flagged) {
      if (item.approvedAt) summary.switchedOff += 1;
      else summary.awaitingApproval += 1;
    }
    if (item.status === "failed" || isGenerationStale(item, now)) summary.failed += 1;
    if (isGenerationInProgress(item, now)) summary.generating += 1;
    if (item.status === "draft" && !flagged) summary.drafts += 1;
    if (!item.hasAudio) summary.withoutAudio += 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Playback settings
// ---------------------------------------------------------------------------

export const MIN_VOLUME_PERCENT = 10;
export const MAX_VOLUME_PERCENT = 100;

/** Stored gain (0.10–1.00) → whole percent for the slider. */
export function volumeToPercent(volume: number): number {
  const percent = Math.round(Number(volume) * 100);
  return Math.min(MAX_VOLUME_PERCENT, Math.max(MIN_VOLUME_PERCENT, Number.isFinite(percent) ? percent : MAX_VOLUME_PERCENT));
}
