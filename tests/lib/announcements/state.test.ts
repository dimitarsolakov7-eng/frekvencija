import { describe, expect, it } from "vitest";
import type { AdminAnnouncement } from "@/lib/api/contracts";
import {
  canActivate,
  canApprove,
  canDeactivate,
  canGenerate,
  checkActivate,
  checkApprove,
  checkEditWording,
  checkGenerate,
  checkUploadAudio,
  CLEARED_AUDIO_FIELDS,
  describeStatus,
  GENERATION_LOCK_MS,
  isGenerationInProgress,
  isGenerationStale,
  isPlayable,
  statusAfterWordingEdit,
  toAnnouncementState,
} from "@/lib/announcements/state";
import type { Tables } from "@/types/database";

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

function announcement(overrides: Partial<AdminAnnouncement> = {}): AdminAnnouncement {
  return {
    id: "a1",
    businessId: "b1",
    templateKey: "welcome_enjoy",
    placement: "welcome",
    text: "Welcome to EmeraldBar. Enjoy the music.",
    spokenText: "Welcome to Emerald Bar. Enjoy the music.",
    language: "en",
    status: "ready",
    source: "tts",
    hasAudio: true,
    audioDurationSeconds: 3.2,
    voiceId: "voice-1",
    voiceName: "Rachel",
    modelId: "eleven_multilingual_v2",
    lastError: null,
    needsReview: false,
    reviewReason: null,
    approvedAt: null,
    generationStartedAt: null,
    createdAt: iso(NOW - 86_400_000),
    updatedAt: iso(NOW - 86_400_000),
    ...overrides,
  };
}

describe("generation lock", () => {
  const generating = (startedMsAgo: number | null) =>
    announcement({ status: "generating", hasAudio: false, generationStartedAt: startedMsAgo === null ? null : iso(NOW - startedMsAgo) });

  it("blocks generating again while a fresh lock exists", () => {
    const fresh = generating(GENERATION_LOCK_MS - 1);
    expect(isGenerationInProgress(fresh, NOW)).toBe(true);
    expect(isGenerationStale(fresh, NOW)).toBe(false);
    expect(canGenerate(fresh, NOW)).toBe(false);
    expect(checkGenerate(fresh, new Date(NOW))).toMatchObject({ ok: false, reason: expect.stringContaining("being generated") });
    expect(checkUploadAudio(fresh, NOW).ok).toBe(false);
    expect(checkEditWording(fresh, NOW).ok).toBe(false);
  });

  it("allows a retry once the lock is 3 minutes old", () => {
    const stale = generating(GENERATION_LOCK_MS);
    expect(isGenerationStale(stale, NOW)).toBe(true);
    expect(canGenerate(stale, NOW)).toBe(true);
    expect(checkUploadAudio(stale, NOW).ok).toBe(true);
  });

  it("treats a generating row without a readable timestamp as stale", () => {
    expect(isGenerationStale(generating(null), NOW)).toBe(true);
    expect(isGenerationStale({ status: "generating", generationStartedAt: "not a date" }, NOW)).toBe(true);
  });

  it("allows generating from every other state", () => {
    for (const status of ["draft", "failed", "ready", "active"] as const) {
      expect(canGenerate(announcement({ status }), NOW)).toBe(true);
      expect(isGenerationStale(announcement({ status }), NOW)).toBe(false);
    }
  });
});

describe("approval, activation, deactivation", () => {
  it("approves ready audio", () => {
    expect(canApprove(announcement({ status: "ready" }))).toBe(true);
  });

  it("approves an active announcement flagged for review", () => {
    expect(canApprove(announcement({ status: "active", needsReview: true, approvedAt: iso(NOW) }))).toBe(true);
  });

  it("refuses approval without audio or in other states", () => {
    expect(checkApprove(announcement({ status: "ready", hasAudio: false }))).toMatchObject({ ok: false });
    expect(checkApprove(announcement({ status: "active", approvedAt: iso(NOW) }))).toEqual({
      ok: false,
      reason: "This announcement is already approved and active.",
    });
    for (const status of ["draft", "failed", "generating"] as const) {
      expect(canApprove(announcement({ status, hasAudio: false }))).toBe(false);
    }
  });

  it("activates only a previously approved, unflagged ready announcement", () => {
    expect(canActivate(announcement({ status: "ready", approvedAt: iso(NOW) }))).toBe(true);
    expect(checkActivate(announcement({ status: "ready", approvedAt: null }))).toEqual({ ok: false, reason: "Approve this announcement first." });
    expect(canActivate(announcement({ status: "ready", approvedAt: iso(NOW), needsReview: true }))).toBe(false);
    expect(canActivate(announcement({ status: "active", approvedAt: iso(NOW) }))).toBe(false);
    expect(canActivate(announcement({ status: "draft", hasAudio: false, approvedAt: iso(NOW) }))).toBe(false);
  });

  it("deactivates only active announcements", () => {
    expect(canDeactivate(announcement({ status: "active", approvedAt: iso(NOW) }))).toBe(true);
    for (const status of ["draft", "generating", "ready", "failed"] as const) expect(canDeactivate(announcement({ status }))).toBe(false);
  });
});

describe("statusAfterWordingEdit", () => {
  it("discards generated audio when the spoken wording changes", () => {
    const outcome = statusAfterWordingEdit(announcement({ status: "active", approvedAt: iso(NOW) }), {
      spokenText: "Welcome to Emerald Bar and Grill.",
    });
    expect(outcome).toMatchObject({ status: "draft", audioInvalidated: true, ttsInputChanged: true, clearLastError: true });
    expect(outcome.message).toContain("Generate it again");
  });

  it("discards generated audio when the voice, model or language changes", () => {
    const ready = announcement({ status: "ready" });
    expect(statusAfterWordingEdit(ready, { voiceId: "voice-2" }).audioInvalidated).toBe(true);
    expect(statusAfterWordingEdit(ready, { modelId: "eleven_v3" }).audioInvalidated).toBe(true);
    expect(statusAfterWordingEdit(ready, { language: "bg" }).audioInvalidated).toBe(true);
  });

  it("keeps the audio when only the display text changes and a separate spoken text exists", () => {
    const outcome = statusAfterWordingEdit(announcement({ status: "active", approvedAt: iso(NOW) }), {
      text: "Welcome to EmeraldBar! Enjoy the music.",
    });
    expect(outcome).toEqual({ status: "active", audioInvalidated: false, ttsInputChanged: false, clearLastError: false, message: null });
  });

  it("treats a display-text change as a spoken change when spokenText is null", () => {
    const outcome = statusAfterWordingEdit(announcement({ spokenText: null }), { text: "Welcome back." });
    expect(outcome).toMatchObject({ status: "draft", audioInvalidated: true });
  });

  it("detects clearing spokenText back to the display text", () => {
    expect(statusAfterWordingEdit(announcement(), { spokenText: null }).audioInvalidated).toBe(true);
    const same = announcement({ spokenText: "Welcome to EmeraldBar. Enjoy the music." });
    expect(statusAfterWordingEdit(same, { spokenText: null }).audioInvalidated).toBe(false);
  });

  it("ignores whitespace-only differences and unchanged values", () => {
    const a = announcement();
    expect(statusAfterWordingEdit(a, { spokenText: `  ${a.spokenText}  `, voiceId: "voice-1", language: "en" }).ttsInputChanged).toBe(false);
    expect(statusAfterWordingEdit(a, {}).ttsInputChanged).toBe(false);
  });

  it("keeps uploaded audio (and status) when the wording changes", () => {
    const outcome = statusAfterWordingEdit(announcement({ status: "active", source: "upload", approvedAt: iso(NOW) }), {
      spokenText: "Completely new words.",
    });
    expect(outcome).toMatchObject({ status: "active", audioInvalidated: false, ttsInputChanged: true });
    expect(outcome.message).toContain("uploaded audio was kept");
  });

  it("moves a failed announcement without audio back to draft and clears the error", () => {
    const failed = announcement({ status: "failed", hasAudio: false, source: null, lastError: "ElevenLabs timed out" });
    expect(statusAfterWordingEdit(failed, { spokenText: "New words." })).toEqual({
      status: "draft",
      audioInvalidated: false,
      ttsInputChanged: true,
      clearLastError: true,
      message: null,
    });
  });

  it("leaves a draft as a draft", () => {
    const draft = announcement({ status: "draft", hasAudio: false, source: null });
    expect(statusAfterWordingEdit(draft, { text: "Other words." })).toMatchObject({ status: "draft", audioInvalidated: false });
  });
});

describe("isPlayable", () => {
  const business = { isActive: true, brandingVersion: 3 };
  const playable = { status: "active" as const, needsReview: false, hasAudio: true, brandingVersion: 3 };

  it("requires active, reviewed, audio, current branding and an active venue", () => {
    expect(isPlayable(playable, business)).toBe(true);
    expect(isPlayable({ ...playable, status: "ready" }, business)).toBe(false);
    expect(isPlayable({ ...playable, needsReview: true }, business)).toBe(false);
    expect(isPlayable({ ...playable, hasAudio: false }, business)).toBe(false);
    expect(isPlayable({ ...playable, brandingVersion: 2 }, business)).toBe(false);
    expect(isPlayable(playable, { ...business, isActive: false })).toBe(false);
  });
});

describe("describeStatus", () => {
  it("describes every status for badges", () => {
    expect(describeStatus(announcement({ status: "draft", hasAudio: false }), NOW)).toMatchObject({ label: "Draft", tone: "neutral" });
    expect(describeStatus(announcement({ status: "ready" }), NOW)).toMatchObject({ label: "Awaiting approval", tone: "info" });
    expect(describeStatus(announcement({ status: "active", approvedAt: iso(NOW) }), NOW)).toMatchObject({ label: "Active", tone: "success" });
    expect(describeStatus(announcement({ status: "failed", lastError: "Quota exceeded." }), NOW)).toEqual({
      label: "Failed",
      tone: "danger",
      description: "Quota exceeded.",
    });
    expect(describeStatus(announcement({ status: "generating", generationStartedAt: iso(NOW - 1000) }), NOW)).toMatchObject({
      label: "Generating…",
      tone: "info",
    });
    expect(describeStatus(announcement({ status: "generating", generationStartedAt: iso(NOW - GENERATION_LOCK_MS) }), NOW)).toMatchObject({
      label: "Generation stalled",
      tone: "warning",
    });
  });

  it("flags active announcements that need review with the reason", () => {
    const flagged = announcement({
      status: "active",
      approvedAt: iso(NOW),
      needsReview: true,
      reviewReason: 'Branding changed: "EmeraldBar Radio" → "Emerald FM"',
    });
    expect(describeStatus(flagged, NOW)).toEqual({
      label: "Needs review",
      tone: "warning",
      description: 'Branding changed: "EmeraldBar Radio" → "Emerald FM" It is off air until you approve it again.',
    });
  });
});

describe("toAnnouncementState", () => {
  it("maps a database row", () => {
    const row: Tables<"announcements"> = {
      id: "a1",
      business_id: "b1",
      template_key: null,
      placement: "rotation",
      text: "Hello",
      spoken_text: null,
      language: "bg",
      status: "active",
      source: "upload",
      audio_path: "b1/a1/x.mp3",
      audio_duration_seconds: 2.5,
      audio_size_bytes: 40000,
      voice_id: null,
      voice_name: null,
      model_id: null,
      generation_hash: null,
      generation_started_at: null,
      generation_attempts: 0,
      last_error: null,
      needs_review: true,
      review_reason: "Branding changed",
      branding_version: 2,
      approved_at: iso(NOW),
      approved_by: null,
      created_by: null,
      created_at: iso(NOW),
      updated_at: iso(NOW),
    };
    expect(toAnnouncementState(row)).toEqual({
      status: "active",
      source: "upload",
      hasAudio: true,
      needsReview: true,
      generationStartedAt: null,
      approvedAt: iso(NOW),
      text: "Hello",
      spokenText: null,
      voiceId: null,
      modelId: null,
      language: "bg",
      brandingVersion: 2,
      lastError: null,
      reviewReason: "Branding changed",
    });
    expect(canApprove(toAnnouncementState(row))).toBe(true);
  });

  it("CLEARED_AUDIO_FIELDS clears audio and approval together", () => {
    expect(CLEARED_AUDIO_FIELDS).toMatchObject({ audio_path: null, source: null, generation_hash: null, approved_at: null, approved_by: null });
  });
});
