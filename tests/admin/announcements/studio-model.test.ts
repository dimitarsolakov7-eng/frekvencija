import { describe, expect, it } from "vitest";
import type { AnnouncementBusiness, AnnouncementItem } from "@/components/admin/announcements/rules";
import {
  defaultTemplateKey,
  editorErrorsFromAction,
  editorStateFromRecording,
  editorWording,
  generateProblems,
  hasErrors,
  initialEditorState,
  isEditorDirty,
  isPlayAfterPreset,
  matchingTemplateKey,
  newEditorState,
  PLAY_AFTER_PRESETS,
  playAfterLabel,
  RECORDING_ACTION_LABELS,
  RECORDING_STATE_PILLS,
  recordingArtwork,
  recordingDetail,
  recordingMenuActions,
  recordingPrimaryAction,
  recordingState,
  splitRecordings,
  storedLanguageFor,
  templateText,
  wordingDiffers,
} from "@/components/admin/announcements/studio-model";
import { buildSpokenWording } from "@/lib/announcements/spoken";

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
  volume: 0.7,
  brandingVersion: 3,
};

let sequence = 0;
function item(overrides: Partial<AnnouncementItem> = {}): AnnouncementItem {
  sequence += 1;
  return {
    id: `4e000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    businessId: business.id,
    templateKey: "station_listening",
    placement: "rotation",
    text: "You’re listening to EmeraldBar Radio.",
    spokenText: "You’re listening to Emerald Bar Radio.",
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
  item({ hasAudio: true, source: "tts", audioDurationSeconds: 6, voiceId: "voiceA", modelId: "eleven_multilingual_v2", ...overrides });
const ready = (overrides: Partial<AnnouncementItem> = {}) => withAudio({ status: "ready", ...overrides });
const onAir = (overrides: Partial<AnnouncementItem> = {}) => withAudio({ status: "active", approvedAt: "2026-09-21T10:00:00.000Z", ...overrides });
const inactive = (overrides: Partial<AnnouncementItem> = {}) => ready({ approvedAt: "2026-09-21T10:00:00.000Z", ...overrides });
const flagged = (overrides: Partial<AnnouncementItem> = {}) =>
  onAir({ needsReview: true, reviewReason: 'Branding changed: "Emerald Radio" → "EmeraldBar Radio"', ...overrides });
const failed = (overrides: Partial<AnnouncementItem> = {}) => item({ status: "failed", lastError: "ElevenLabs is temporarily unavailable.", ...overrides });
const generating = (overrides: Partial<AnnouncementItem> = {}) => item({ status: "generating", generationStartedAt: FRESH_LOCK, ...overrides });
const stalled = (overrides: Partial<AnnouncementItem> = {}) => item({ status: "generating", generationStartedAt: STALE_LOCK, ...overrides });

describe("recordingState and its pill", () => {
  it("names every state the admin can meet", () => {
    expect(recordingState(onAir(), business, NOW)).toBe("on-air");
    expect(recordingState(ready(), business, NOW)).toBe("ready");
    expect(recordingState(inactive(), business, NOW)).toBe("inactive");
    expect(recordingState(flagged(), business, NOW)).toBe("needs-review");
    expect(recordingState(failed(), business, NOW)).toBe("failed");
    expect(recordingState(generating(), business, NOW)).toBe("generating");
    expect(recordingState(stalled(), business, NOW)).toBe("stalled");
    expect(recordingState(item(), business, NOW)).toBe("draft");
  });

  it("treats audio approved under an older branding version as needing review", () => {
    expect(recordingState(onAir({ brandingVersion: 2 }), business, NOW)).toBe("needs-review");
  });

  it("uses the design's labels", () => {
    expect(RECORDING_STATE_PILLS["on-air"]).toEqual({ label: "Active", tone: "success" });
    expect(RECORDING_STATE_PILLS.ready).toEqual({ label: "Ready for review", tone: "info" });
    expect(RECORDING_STATE_PILLS["needs-review"].label).toBe("Needs review");
    expect(RECORDING_STATE_PILLS.failed.tone).toBe("danger");
  });

  it("explains the review reason, the last error and on-air audio of an inactive venue", () => {
    expect(recordingDetail(flagged(), business, NOW)).toBe(
      'Branding changed: "Emerald Radio" → "EmeraldBar Radio". Listen to it and approve it again.',
    );
    expect(recordingDetail(failed(), business, NOW)).toBe("ElevenLabs is temporarily unavailable.");
    expect(recordingDetail(ready({ lastError: "Timed out" }), business, NOW)).toContain("The previous audio was kept.");
    expect(recordingDetail(onAir(), business, NOW)).toBeNull();
    expect(recordingDetail(onAir(), { ...business, isActive: false }, NOW)).toBe("Plays once the venue is activated.");
  });

  it("picks deterministic artwork per placement", () => {
    expect(recordingArtwork("rotation")).toBe("/brand/genres/default-01.jpg");
    expect(recordingArtwork("welcome")).toBe("/brand/genres/default-02.jpg");
    expect(recordingArtwork("both")).toBe("/brand/venue-hero.jpg");
  });
});

describe("available row actions", () => {
  const actionsOf = (a: AnnouncementItem) => ({
    primary: recordingPrimaryAction(a, business, NOW),
    menu: recordingMenuActions(a, business, NOW),
  });

  it("on air: play plus Deactivate, Edit wording, Duplicate for a new version and Delete", () => {
    expect(actionsOf(onAir())).toEqual({ primary: null, menu: ["deactivate", "editWording", "duplicate", "delete"] });
    expect(RECORDING_ACTION_LABELS.duplicate).toBe("Duplicate for a new version");
  });

  it("ready for review: Approve & activate", () => {
    expect(actionsOf(ready())).toEqual({ primary: "approve", menu: ["editWording", "duplicate", "delete"] });
    expect(RECORDING_ACTION_LABELS.approve).toBe("Approve & activate");
  });

  it("needs review: Re-approve (with audio), else fix the wording", () => {
    expect(actionsOf(flagged())).toEqual({ primary: "reapprove", menu: ["deactivate", "editWording", "duplicate", "delete"] });
    expect(actionsOf(item({ needsReview: true, reviewReason: "Branding changed" }))).toEqual({
      primary: "editWording",
      menu: ["duplicate", "delete"],
    });
  });

  it("switched off: Activate without a new approval", () => {
    expect(actionsOf(inactive())).toEqual({ primary: "activate", menu: ["editWording", "duplicate", "delete"] });
  });

  it("failed: Retry; stalled: Mark as failed; drafts: Continue", () => {
    expect(actionsOf(failed())).toEqual({ primary: "retry", menu: ["editWording", "duplicate", "delete"] });
    expect(actionsOf(stalled())).toEqual({ primary: "markFailed", menu: ["editWording", "duplicate", "delete"] });
    expect(actionsOf(item())).toEqual({ primary: "continue", menu: ["duplicate", "delete"] });
  });

  it("while generating nothing can change the recording except making a copy", () => {
    expect(actionsOf(generating())).toEqual({ primary: null, menu: ["duplicate"] });
  });
});

describe("splitRecordings", () => {
  it("separates on-air recordings from the rest, most urgent first", () => {
    const station = onAir({ placement: "rotation" });
    const welcome = onAir({ placement: "welcome" });
    const draft = item({ updatedAt: "2026-09-24T10:00:00.000Z" });
    const awaiting = ready({ updatedAt: "2026-09-23T10:00:00.000Z" });
    const review = flagged();
    const broken = failed();
    const off = inactive();
    const { onAir: live, other } = splitRecordings([station, draft, awaiting, welcome, off, broken, review], business, NOW);
    expect(live.map((entry) => entry.id)).toEqual([station.id, welcome.id]);
    expect(other.map((entry) => entry.id)).toEqual([review.id, broken.id, awaiting.id, draft.id, off.id]);
  });
});

describe("play-after settings", () => {
  it("offers 1–12 completed songs and labels them", () => {
    expect(PLAY_AFTER_PRESETS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(playAfterLabel(1)).toBe("1 completed song");
    expect(playAfterLabel(4)).toBe("4 completed songs");
    expect(isPlayAfterPreset(12)).toBe(true);
    expect(isPlayAfterPreset(20)).toBe(false);
  });
});

describe("editor state", () => {
  it("starts from what the venue is missing on air", () => {
    expect(defaultTemplateKey([], business)).toBe("station_listening");
    expect(defaultTemplateKey([onAir({ placement: "rotation" })], business)).toBe("welcome_enjoy");
    expect(defaultTemplateKey([onAir({ placement: "both" })], business)).toBe("station_listening");
    expect(defaultTemplateKey([flagged({ placement: "rotation" })], business)).toBe("station_listening");
  });

  it("prefills a template with the venue's names and pronunciation", () => {
    const state = newEditorState(business, "station_listening");
    expect(state).toMatchObject({
      text: "You’re listening to EmeraldBar Radio.",
      placement: "rotation",
      pronunciation: "Emerald Bar",
      draftId: null,
      replacesId: null,
      preferredLanguage: "en",
    });
    expect(isEditorDirty(state)).toBe(false);
    expect(isEditorDirty({ ...state, text: "Something else." })).toBe(true);
    expect(isEditorDirty({ ...state, placement: "welcome" })).toBe(true);
    expect(isEditorDirty({ ...state, pronunciation: "Emmerald" })).toBe(true);
    expect(isEditorDirty({ ...state, voiceId: "other" })).toBe(false);
  });

  it("matches text back to its template", () => {
    expect(templateText("welcome_enjoy", business)).toBe("Welcome to EmeraldBar. Enjoy the music.");
    expect(matchingTemplateKey(" Welcome to EmeraldBar. Enjoy the music. ", business)).toBe("welcome_enjoy");
    expect(matchingTemplateKey("Welcome to EmeraldBar!", business)).toBeNull();
  });

  it("edits a recording that is not on air in place", () => {
    const draft = ready({ language: "sr-Latn", voiceId: "voiceB", modelId: "eleven_v3" });
    expect(editorStateFromRecording(draft, business, "edit")).toMatchObject({
      text: draft.text,
      draftId: draft.id,
      replacesId: null,
      voiceId: "voiceB",
      modelId: "eleven_v3",
      preferredLanguage: "sr-Latn",
      spokenOverride: null,
    });
  });

  it("prepares a new version of an on-air recording without touching it", () => {
    const live = onAir();
    expect(initialEditorState(business, [live], live.id)).toMatchObject({ draftId: null, replacesId: live.id, text: live.text });
    expect(initialEditorState(business, [live], "unknown")).toMatchObject({ draftId: null, replacesId: null });
  });

  it("keeps a saved spoken wording that differs from the rebuilt one until the text changes", () => {
    const custom = ready({ text: "Happy hour at EmeraldBar from 5.", spokenText: "Happy hour at Emerald Bar from five." });
    const state = editorStateFromRecording(custom, business, "edit");
    expect(state.spokenOverride).toBe("Happy hour at Emerald Bar from five.");
    expect(editorWording(state, business)).toMatchObject({ ok: true, spoken: "Happy hour at Emerald Bar from five." });
    expect(editorWording({ ...state, spokenOverride: null }, business)).toMatchObject({ ok: true, spoken: "Happy hour at Emerald Bar from 5." });
  });

  it("stores the recording's own language code while the chosen language is the same", () => {
    expect(storedLanguageFor("sr", "sr-Latn")).toBe("sr-Latn");
    expect(storedLanguageFor("hr", "sr-Latn")).toBe("hr");
    expect(storedLanguageFor("", "en")).toBe("en");
    expect(storedLanguageFor(undefined, "bg")).toBe("bg");
  });

  it("detects when the saved row must be updated before generating", () => {
    const row = ready();
    const same = { text: row.text, spokenText: row.spokenText, placement: row.placement, language: row.language };
    expect(wordingDiffers(row, same)).toBe(false);
    expect(wordingDiffers(row, { ...same, spokenText: null })).toBe(true);
    expect(wordingDiffers(row, { ...same, spokenText: null }, false)).toBe(false);
    expect(wordingDiffers(row, { ...same, placement: "both" })).toBe(true);
    expect(wordingDiffers(row, { ...same, language: "de" })).toBe(true);
  });
});

describe("generateProblems", () => {
  const model = { id: "eleven_multilingual_v2", name: "Multilingual v2", languages: [{ code: "en", name: "English" }], maxCharacters: 40 };
  const wording = buildSpokenWording({ text: "Welcome to EmeraldBar.", business, pronunciation: "Emerald Bar" });

  it("passes a complete request", () => {
    expect(generateProblems({ wording, pronunciation: "Emerald Bar", voice: { id: "v" }, model, languageCode: "en" })).toEqual({});
  });

  it("requires text, a voice, a model and one of the model's languages", () => {
    const problems = generateProblems({ wording: { ok: false, reason: null }, pronunciation: "", voice: null, model: null, languageCode: "" });
    expect(Object.keys(problems).sort()).toEqual(["modelId", "text", "voiceId"]);
    expect(hasErrors(problems)).toBe(true);
    expect(generateProblems({ wording, pronunciation: "", voice: { id: "v" }, model, languageCode: "bg" }).languageCode).toContain("Multilingual v2");
  });

  it("checks the spoken length against the model's limit", () => {
    const long = buildSpokenWording({ text: "Welcome to EmeraldBar, the best bar in town.", business, pronunciation: "Emerald Bar" });
    expect(generateProblems({ wording: long, pronunciation: "", voice: { id: "v" }, model, languageCode: "en" }).pronunciation).toContain(
      "at most 40",
    );
  });

  it("maps create/update field errors onto the editor fields", () => {
    expect(editorErrorsFromAction({ customText: "Too long", spokenText: "Spoken too long", language: "Bad code" })).toEqual({
      text: "Too long",
      pronunciation: "Spoken too long",
      languageCode: "Bad code",
    });
    expect(editorErrorsFromAction({ templateKey: "Choose a template." })).toEqual({ text: "Choose a template." });
    expect(hasErrors({})).toBe(false);
  });
});
