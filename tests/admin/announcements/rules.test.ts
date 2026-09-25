import { describe, expect, it } from "vitest";
import {
  asSentence,
  availableActions,
  checkGenerateInPlace,
  describeAnnouncement,
  generationFailureStatus,
  isOnAir,
  modelLabel,
  needsReview,
  ON_AIR_GENERATE_REASON,
  primaryAction,
  sourceLabel,
  spokenWording,
  summarizeAnnouncements,
  volumeToPercent,
  withEffectiveReview,
  type AnnouncementBusiness,
  type AnnouncementItem,
} from "@/components/admin/announcements/rules";

const NOW = Date.parse("2026-09-25T12:00:00.000Z");
const FRESH_LOCK = new Date(NOW - 30_000).toISOString();
const STALE_LOCK = new Date(NOW - 4 * 60_000).toISOString();

const business: AnnouncementBusiness = {
  id: "1b000000-0000-4000-8000-000000000001",
  name: "EmeraldBar",
  stationName: "EmeraldBar Radio",
  namePronunciation: "Emerald Bar",
  stationNamePronunciation: null,
  language: "en",
  isActive: true,
  everyNTracks: 4,
  volume: 0.8,
  brandingVersion: 3,
};

function item(overrides: Partial<AnnouncementItem> = {}): AnnouncementItem {
  return {
    id: "4e000000-0000-4000-8000-000000000001",
    businessId: business.id,
    templateKey: "welcome_enjoy",
    placement: "welcome",
    text: "Welcome to EmeraldBar.",
    spokenText: "Welcome to Emerald Bar.",
    language: "en",
    status: "draft",
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
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    brandingVersion: 3,
    generationAttempts: 0,
    audioSizeBytes: null,
    approvedByEmail: null,
    ...overrides,
  };
}

const withAudio = (overrides: Partial<AnnouncementItem> = {}) =>
  item({ hasAudio: true, source: "tts", audioDurationSeconds: 3, voiceId: "v1", modelId: "eleven_multilingual_v2", ...overrides });
const onAir = (overrides: Partial<AnnouncementItem> = {}) =>
  withAudio({ status: "active", approvedAt: "2026-09-21T10:00:00.000Z", ...overrides });

/** Names of the actions that are allowed. */
function allowed(a: AnnouncementItem): string[] {
  return Object.entries(availableActions(a, business, NOW))
    .filter(([, check]) => check.ok)
    .map(([name]) => name)
    .sort();
}

describe("review and on-air state", () => {
  it("treats the needs_review flag and approval under an older branding version as needing review", () => {
    expect(needsReview(item({ needsReview: true }), business)).toBe(true);
    expect(needsReview(onAir({ brandingVersion: 2 }), business)).toBe(true);
    // Unapproved drafts carry the version they were created with; that alone is no review.
    expect(needsReview(item({ brandingVersion: 1 }), business)).toBe(false);
    expect(needsReview(onAir(), business)).toBe(false);
  });

  it("fills a review reason when only the branding version gives it away", () => {
    const effective = withEffectiveReview(onAir({ brandingVersion: 2 }), business);
    expect(effective).toMatchObject({ needsReview: true, reviewReason: expect.stringContaining("branding changed") });
    const unchanged = onAir();
    expect(withEffectiveReview(unchanged, business)).toBe(unchanged);
  });

  it("is on air only when active and not flagged", () => {
    expect(isOnAir(onAir(), business)).toBe(true);
    expect(isOnAir(onAir({ needsReview: true }), business)).toBe(false);
    expect(isOnAir(onAir({ brandingVersion: 1 }), business)).toBe(false);
    expect(isOnAir(withAudio({ status: "ready", approvedAt: "2026-09-21T10:00:00.000Z" }), business)).toBe(false);
  });
});

describe("checkGenerateInPlace", () => {
  it("refuses a fresh lock and on-air audio, allows everything else", () => {
    expect(checkGenerateInPlace(item({ status: "generating", generationStartedAt: FRESH_LOCK }), business, NOW).ok).toBe(false);
    expect(checkGenerateInPlace(onAir(), business, NOW)).toEqual({ ok: false, reason: ON_AIR_GENERATE_REASON });
    expect(checkGenerateInPlace(onAir({ needsReview: true }), business, NOW).ok).toBe(true);
    expect(checkGenerateInPlace(item({ status: "generating", generationStartedAt: STALE_LOCK }), business, NOW).ok).toBe(true);
    for (const status of ["draft", "failed"] as const) expect(checkGenerateInPlace(item({ status }), business, NOW).ok).toBe(true);
    expect(checkGenerateInPlace(withAudio({ status: "ready" }), business, NOW).ok).toBe(true);
  });
});

describe("generationFailureStatus", () => {
  it("fails announcements without audio and keeps the status of ones with audio", () => {
    expect(generationFailureStatus("draft", false)).toBe("failed");
    expect(generationFailureStatus("failed", false)).toBe("failed");
    expect(generationFailureStatus("generating", false)).toBe("failed");
    expect(generationFailureStatus("ready", true)).toBe("ready");
    expect(generationFailureStatus("active", true)).toBe("active");
    // Unknown previous state (stale lock) or an odd failed-with-audio row ⇒ needs approval again.
    expect(generationFailureStatus("generating", true)).toBe("ready");
    expect(generationFailureStatus("failed", true)).toBe("ready");
  });
});

describe("availableActions per state", () => {
  it("draft: generate, upload, edit, duplicate, delete", () => {
    expect(allowed(item())).toEqual(["duplicate", "editWording", "generate", "remove", "uploadAudio"]);
  });

  it("failed: same as a draft", () => {
    expect(allowed(item({ status: "failed", lastError: "quota" }))).toEqual(["duplicate", "editWording", "generate", "remove", "uploadAudio"]);
  });

  it("ready (awaiting approval): approve, preview, regenerate, upload, edit, duplicate, delete", () => {
    expect(allowed(withAudio({ status: "ready" }))).toEqual([
      "approve",
      "duplicate",
      "editWording",
      "generate",
      "preview",
      "remove",
      "uploadAudio",
    ]);
  });

  it("ready after deactivation: activate instead of approve", () => {
    const a = withAudio({ status: "ready", approvedAt: "2026-09-21T10:00:00.000Z" });
    expect(allowed(a)).toContain("activate");
    expect(allowed(a)).not.toContain("approve");
  });

  it("ready after deactivation but branding changed since approval: approve again, not activate", () => {
    const a = withAudio({ status: "ready", approvedAt: "2026-09-21T10:00:00.000Z", brandingVersion: 2 });
    expect(allowed(a)).toContain("approve");
    expect(allowed(a)).not.toContain("activate");
  });

  it("active (on air): deactivate, preview, upload, edit, duplicate, delete — never regenerate in place", () => {
    expect(allowed(onAir())).toEqual(["deactivate", "duplicate", "editWording", "preview", "remove", "uploadAudio"]);
  });

  it("active but flagged: approve again, and regenerating is allowed (it is off air)", () => {
    expect(allowed(onAir({ needsReview: true, reviewReason: "Branding changed" }))).toEqual([
      "approve",
      "deactivate",
      "duplicate",
      "editWording",
      "generate",
      "preview",
      "remove",
      "uploadAudio",
    ]);
  });

  it("generating (fresh lock): only duplicate (and preview of existing audio)", () => {
    expect(allowed(item({ status: "generating", generationStartedAt: FRESH_LOCK }))).toEqual(["duplicate"]);
    expect(allowed(withAudio({ status: "generating", generationStartedAt: FRESH_LOCK }))).toEqual(["duplicate", "preview"]);
  });

  it("generating with a stale lock: retry, mark as failed, upload, edit, delete", () => {
    expect(allowed(item({ status: "generating", generationStartedAt: STALE_LOCK }))).toEqual([
      "duplicate",
      "editWording",
      "generate",
      "markFailed",
      "remove",
      "uploadAudio",
    ]);
  });
});

describe("primaryAction", () => {
  const primary = (a: AnnouncementItem) => primaryAction(availableActions(a, business, NOW), a);

  it("picks the next useful step", () => {
    expect(primary(item())).toBe("generate");
    expect(primary(withAudio({ status: "ready" }))).toBe("approve");
    expect(primary(withAudio({ status: "ready", approvedAt: "2026-09-21T10:00:00.000Z" }))).toBe("activate");
    expect(primary(onAir({ needsReview: true }))).toBe("approve");
    expect(primary(item({ status: "generating", generationStartedAt: STALE_LOCK }))).toBe("generate");
    expect(primary(onAir())).toBeNull();
    expect(primary(item({ status: "generating", generationStartedAt: FRESH_LOCK }))).toBeNull();
  });
});

describe("describeAnnouncement", () => {
  it("labels a deactivated, approved announcement as inactive", () => {
    expect(describeAnnouncement(withAudio({ status: "ready", approvedAt: "2026-09-21T10:00:00.000Z" }), business, NOW)).toMatchObject({
      label: "Inactive",
      tone: "neutral",
    });
  });

  it("explains that nothing plays while the venue is inactive", () => {
    const status = describeAnnouncement(onAir(), { ...business, isActive: false }, NOW);
    expect(status).toMatchObject({ label: "Active", tone: "success" });
    expect(status.description).toContain("venue is inactive");
  });

  it("shows needs review with a punctuated reason", () => {
    const status = describeAnnouncement(onAir({ needsReview: true, reviewReason: 'Branding changed: "A" → "B"' }), business, NOW);
    expect(status.label).toBe("Needs review");
    expect(status.description).toContain('"B". It is off air');
  });

  it("distinguishes fresh and stalled generations", () => {
    expect(describeAnnouncement(item({ status: "generating", generationStartedAt: FRESH_LOCK }), business, NOW).label).toBe("Generating…");
    expect(describeAnnouncement(withAudio({ status: "generating", generationStartedAt: FRESH_LOCK }), business, NOW).description).toContain(
      "current audio is kept",
    );
    expect(describeAnnouncement(item({ status: "generating", generationStartedAt: STALE_LOCK }), business, NOW).label).toBe("Generation stalled");
  });

  it("uses the last error as the description of a failed announcement", () => {
    expect(describeAnnouncement(item({ status: "failed", lastError: "Out of credits." }), business, NOW)).toMatchObject({
      label: "Failed",
      description: "Out of credits.",
    });
  });
});

describe("summarizeAnnouncements", () => {
  it("counts on-air announcements by placement and the ones needing attention", () => {
    const summary = summarizeAnnouncements(
      [
        onAir({ id: "a", placement: "welcome" }),
        onAir({ id: "b", placement: "both" }),
        onAir({ id: "c", placement: "rotation", needsReview: true }),
        withAudio({ id: "d", status: "ready" }),
        item({ id: "e", status: "failed" }),
        item({ id: "f", status: "generating", generationStartedAt: FRESH_LOCK }),
        item({ id: "g", status: "generating", generationStartedAt: STALE_LOCK }),
        item({ id: "h", needsReview: true }),
      ],
      business,
      NOW,
    );
    expect(summary).toEqual({
      total: 8,
      onAir: 2,
      onAirWelcome: 2,
      onAirRotation: 1,
      awaitingApproval: 1,
      switchedOff: 0,
      needsReview: 2,
      failed: 2,
      generating: 1,
      drafts: 0,
      withoutAudio: 4,
    });
  });

  it("keeps switched-off approvals apart from audio awaiting approval, and flags any status", () => {
    const summary = summarizeAnnouncements(
      [
        withAudio({ id: "a", status: "ready", approvedAt: "2026-09-21T10:00:00.000Z" }),
        withAudio({ id: "b", status: "ready", approvedAt: "2026-09-21T10:00:00.000Z" }),
        withAudio({ id: "c", status: "ready", needsReview: true }),
        withAudio({ id: "d", status: "ready", approvedAt: "2026-09-21T10:00:00.000Z", brandingVersion: 2 }),
        item({ id: "e" }),
      ],
      business,
      NOW,
    );
    expect(summary).toMatchObject({ awaitingApproval: 0, switchedOff: 2, needsReview: 2, onAir: 0, drafts: 1 });
  });
});

describe("small helpers", () => {
  it("formats labels and wording", () => {
    expect(sourceLabel("tts")).toBe("AI voice (ElevenLabs)");
    expect(sourceLabel("upload")).toBe("Uploaded MP3");
    expect(sourceLabel(null)).toBe("No audio yet");
    expect(modelLabel("eleven_multilingual_v2")).toBe("Multilingual v2");
    expect(modelLabel("custom_model")).toBe("custom_model");
    expect(modelLabel(null)).toBeNull();
    expect(spokenWording(item())).toBe("Welcome to Emerald Bar.");
    expect(spokenWording(item({ spokenText: null }))).toBe("Welcome to EmeraldBar.");
    expect(asSentence("Branding changed")).toBe("Branding changed.");
    expect(asSentence("Done!")).toBe("Done!");
  });

  it("converts the stored gain to a clamped whole percent", () => {
    expect(volumeToPercent(1)).toBe(100);
    expect(volumeToPercent(0.83)).toBe(83);
    expect(volumeToPercent(0.05)).toBe(10);
    expect(volumeToPercent(Number.NaN)).toBe(100);
  });
});
