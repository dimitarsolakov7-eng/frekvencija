/**
 * View model of the announcements studio (/admin/announcements, screen 07): how each recording is
 * labelled and grouped, which actions its row offers, and the editor's state helpers (defaults,
 * loading a recording, the wording sent to the server, validation before generating).
 *
 * Pure and client-safe. Built on the existing rules (./rules.ts, @/lib/announcements/state): the
 * state machine itself is not changed here. `now` is always explicit.
 */
import type { ActionState } from "@/lib/actions/state";
import type { AnnouncementPlacement, TtsModelOption, TtsVoiceOption } from "@/lib/api/contracts";
import { isGenerationInProgress, isGenerationStale } from "@/lib/announcements/state";
import { brandingWithPronunciation, buildSpokenWording, wordingProblems, type SpokenWording } from "@/lib/announcements/spoken";
import { ANNOUNCEMENT_TEMPLATES, getAnnouncementTemplate, renderAnnouncement, type BrandingNames } from "@/lib/announcements/templates";
import { defaultGenreArtwork, VENUE_HERO_IMAGE } from "@/lib/brand/genre-artwork";
import { normalizeLanguageCode } from "@/lib/tts/models";
import { checkSpokenLength } from "./generate-form";
import {
  asSentence,
  availableActions,
  BRANDING_CHANGED_REASON,
  isOnAir,
  needsReview,
  spokenWording,
  type AnnouncementBusiness,
  type AnnouncementItem,
} from "./rules";

type Instant = Date | number;

/** Result of a studio Server Action; create and duplicate also return the new row's id. */
export interface StudioActionState extends ActionState {
  announcementId?: string | null;
}

export function brandingOf(business: AnnouncementBusiness): BrandingNames {
  return {
    name: business.name,
    stationName: business.stationName,
    namePronunciation: business.namePronunciation,
    stationNamePronunciation: business.stationNamePronunciation,
  };
}

// ---------------------------------------------------------------------------
// Recording state and labels
// ---------------------------------------------------------------------------

export type RecordingState = "on-air" | "needs-review" | "ready" | "inactive" | "generating" | "stalled" | "failed" | "draft";

/** One word for where a recording stands, in the order the admin needs to act on it. */
export function recordingState(a: AnnouncementItem, business: Pick<AnnouncementBusiness, "brandingVersion">, now: Instant): RecordingState {
  if (isGenerationInProgress(a, now)) return "generating";
  if (isGenerationStale(a, now)) return "stalled";
  if (a.status === "failed") return "failed";
  if (needsReview(a, business)) return "needs-review";
  if (a.status === "active") return "on-air";
  if (a.status === "ready") return a.approvedAt ? "inactive" : "ready";
  return "draft";
}

export type RecordingTone = "success" | "warning" | "neutral" | "danger" | "info";

export const RECORDING_STATE_PILLS: Readonly<Record<RecordingState, { label: string; tone: RecordingTone }>> = {
  "on-air": { label: "Active", tone: "success" },
  "needs-review": { label: "Needs review", tone: "warning" },
  ready: { label: "Ready for review", tone: "info" },
  inactive: { label: "Inactive", tone: "neutral" },
  generating: { label: "Generating…", tone: "info" },
  stalled: { label: "Generation stalled", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  draft: { label: "Draft", tone: "neutral" },
};

/** Supporting line under a recording's name: the review reason, the last error, what to do next. */
export function recordingDetail(a: AnnouncementItem, business: Pick<AnnouncementBusiness, "brandingVersion" | "isActive">, now: Instant): string | null {
  const state = recordingState(a, business, now);
  switch (state) {
    case "needs-review":
      return a.hasAudio
        ? `${asSentence(a.reviewReason ?? BRANDING_CHANGED_REASON)} Listen to it and approve it again.`
        : `${asSentence(a.reviewReason ?? BRANDING_CHANGED_REASON)} Check the wording before giving it audio.`;
    case "failed":
      return a.lastError ?? "Generating the audio failed.";
    case "stalled":
      return "Generating the audio did not finish. Mark it as failed, then try again.";
    case "generating":
      return a.hasAudio ? "New audio is being generated; the current audio is kept until it succeeds." : "The audio is being generated.";
    case "draft":
      return "No audio yet.";
    case "ready":
      return a.lastError ? `The last attempt failed: ${asSentence(a.lastError)} The previous audio was kept.` : "Listen to it, then approve it.";
    case "inactive":
      return "Approved, but switched off.";
    case "on-air":
      return business.isActive ? null : "Plays once the venue is activated.";
  }
}

/** Thumbnail artwork for a recording (warm venue photography, deterministic per placement). */
export function recordingArtwork(placement: AnnouncementPlacement): string {
  switch (placement) {
    case "rotation":
      return defaultGenreArtwork("house");
    case "welcome":
      return defaultGenreArtwork("jazz");
    case "both":
      return VENUE_HERO_IMAGE.src;
  }
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

export type RecordingActionKey =
  | "approve"
  | "reapprove"
  | "activate"
  | "deactivate"
  | "editWording"
  | "continue"
  | "duplicate"
  | "retry"
  | "markFailed"
  | "delete";

export const RECORDING_ACTION_LABELS: Readonly<Record<RecordingActionKey, string>> = {
  approve: "Approve & activate",
  reapprove: "Re-approve",
  activate: "Activate",
  deactivate: "Deactivate",
  editWording: "Edit wording",
  continue: "Continue",
  duplicate: "Duplicate for a new version",
  retry: "Retry",
  markFailed: "Mark as failed",
  delete: "Delete",
};

/** The button shown on the row itself (on-air rows only have play and the "…" menu). */
export function recordingPrimaryAction(
  a: AnnouncementItem,
  business: Pick<AnnouncementBusiness, "brandingVersion">,
  now: Instant,
): RecordingActionKey | null {
  const actions = availableActions(a, business, now);
  switch (recordingState(a, business, now)) {
    case "ready":
      return actions.approve.ok ? "approve" : null;
    case "needs-review":
      if (actions.approve.ok) return "reapprove";
      return actions.editWording.ok ? "editWording" : null;
    case "inactive":
      return actions.activate.ok ? "activate" : null;
    case "failed":
      return actions.generate.ok ? "retry" : null;
    case "stalled":
      return actions.markFailed.ok ? "markFailed" : null;
    case "draft":
      return actions.editWording.ok ? "continue" : null;
    case "generating":
    case "on-air":
      return null;
  }
}

/** Items of the row's "…" menu, in display order (the primary action is not repeated). */
export function recordingMenuActions(
  a: AnnouncementItem,
  business: Pick<AnnouncementBusiness, "brandingVersion">,
  now: Instant,
): RecordingActionKey[] {
  const actions = availableActions(a, business, now);
  const primary = recordingPrimaryAction(a, business, now);
  const menu: RecordingActionKey[] = [];
  if (actions.activate.ok && primary !== "activate") menu.push("activate");
  if (actions.deactivate.ok) menu.push("deactivate");
  if (actions.editWording.ok && primary !== "editWording" && primary !== "continue") menu.push("editWording");
  if (actions.duplicate.ok) menu.push("duplicate");
  if (actions.markFailed.ok && primary !== "markFailed") menu.push("markFailed");
  if (actions.remove.ok) menu.push("delete");
  return menu;
}

const OTHER_ORDER: Readonly<Record<RecordingState, number>> = {
  "needs-review": 0,
  failed: 1,
  stalled: 2,
  generating: 3,
  ready: 4,
  draft: 5,
  inactive: 6,
  "on-air": 7,
};

/**
 * On-air recordings (what the venue plays) and everything else (needs review, failed, generating,
 * awaiting approval, drafts, switched off), the latter ordered by what needs attention first.
 */
export function splitRecordings(
  items: readonly AnnouncementItem[],
  business: Pick<AnnouncementBusiness, "brandingVersion">,
  now: Instant,
): { onAir: AnnouncementItem[]; other: AnnouncementItem[] } {
  const onAir: AnnouncementItem[] = [];
  const other: AnnouncementItem[] = [];
  for (const item of items) (isOnAir(item, business) ? onAir : other).push(item);
  other.sort((a, b) => {
    const rank = OTHER_ORDER[recordingState(a, business, now)] - OTHER_ORDER[recordingState(b, business, now)];
    return rank !== 0 ? rank : b.updatedAt.localeCompare(a.updatedAt);
  });
  return { onAir, other };
}

// ---------------------------------------------------------------------------
// Announcement settings
// ---------------------------------------------------------------------------

/** "Play after" presets offered in the select; other values (up to 50) use the custom input. */
export const PLAY_AFTER_PRESETS: readonly number[] = Array.from({ length: 12 }, (_, index) => index + 1);
export const MIN_PLAY_AFTER = 1;
export const MAX_PLAY_AFTER = 50;

export function playAfterLabel(songs: number): string {
  return songs === 1 ? "1 completed song" : `${songs} completed songs`;
}

export function isPlayAfterPreset(songs: number): boolean {
  return PLAY_AFTER_PRESETS.includes(songs);
}

// ---------------------------------------------------------------------------
// Editor state
// ---------------------------------------------------------------------------

export interface EditorBaseline {
  text: string;
  placement: AnnouncementPlacement;
  pronunciation: string;
}

export interface EditorState {
  /** Announcement text as typed (real names). */
  text: string;
  placement: AnnouncementPlacement;
  /** Pronunciation spelling of the venue name, for this announcement only. */
  pronunciation: string;
  /**
   * Spoken wording saved on a loaded recording that differs from what the text + pronunciation would
   * give (e.g. numbers written as words). Kept until the text or pronunciation is edited.
   */
  spokenOverride: string | null;
  /** Explicit choices; null ⇒ the default derived from the provider options. */
  voiceId: string | null;
  modelId: string | null;
  /** Language chosen per model, so switching models never keeps an unsupported code. */
  languageByModel: Readonly<Record<string, string>>;
  /** Language to preselect (the recording's, else the venue's). */
  preferredLanguage: string;
  /** Row the editor saves to; null ⇒ the next save creates a new draft. */
  draftId: string | null;
  /** On-air recording this new version is meant to replace (it keeps playing meanwhile). */
  replacesId: string | null;
  /** Values last loaded or saved, for the unsaved-changes warning. */
  baseline: EditorBaseline;
}

/** Template the editor starts with: whatever the venue is missing on air, else the station identity. */
export function defaultTemplateKey(items: readonly AnnouncementItem[], business: Pick<AnnouncementBusiness, "brandingVersion">): string {
  const onAir = items.filter((item) => isOnAir(item, business));
  if (!onAir.some((item) => item.placement !== "welcome")) return "station_listening";
  if (!onAir.some((item) => item.placement !== "rotation")) return "welcome_enjoy";
  return "station_listening";
}

/** Display wording of a template with the venue's names ("You’re listening to EmeraldBar Radio."). */
export function templateText(templateKey: string, business: AnnouncementBusiness): string | null {
  const template = getAnnouncementTemplate(templateKey);
  return template ? renderAnnouncement({ template: template.text, business: brandingOf(business), mode: "display" }) : null;
}

/** The template whose wording (with the venue's names) is exactly this text, if any. */
export function matchingTemplateKey(text: string, business: AnnouncementBusiness): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return ANNOUNCEMENT_TEMPLATES.find((template) => templateText(template.key, business) === trimmed)?.key ?? null;
}

function freshBaseline(state: Pick<EditorState, "text" | "placement" | "pronunciation">): EditorBaseline {
  return { text: state.text, placement: state.placement, pronunciation: state.pronunciation };
}

/** A new, unsaved announcement prefilled from a template with the venue's names and pronunciation. */
export function newEditorState(business: AnnouncementBusiness, templateKey: string): EditorState {
  const template = getAnnouncementTemplate(templateKey) ?? ANNOUNCEMENT_TEMPLATES[0];
  const text = templateText(template.key, business) ?? "";
  const fields = { text, placement: template.defaultPlacement, pronunciation: business.namePronunciation ?? "" };
  return {
    ...fields,
    spokenOverride: null,
    voiceId: null,
    modelId: null,
    languageByModel: {},
    preferredLanguage: business.language,
    draftId: null,
    replacesId: null,
    baseline: freshBaseline(fields),
  };
}

/**
 * Loads a recording into the editor. `edit` saves to that row; `copy` prepares a new version of an
 * on-air recording (nothing is written until the admin generates or uploads, and the original keeps
 * playing).
 */
export function editorStateFromRecording(item: AnnouncementItem, business: AnnouncementBusiness, mode: "edit" | "copy"): EditorState {
  const pronunciation = business.namePronunciation ?? "";
  const built = buildSpokenWording({ text: item.text, business: brandingOf(business), pronunciation });
  const saved = spokenWording(item);
  const fields = { text: item.text, placement: item.placement, pronunciation };
  return {
    ...fields,
    spokenOverride: built.ok && built.spoken !== saved ? saved : null,
    voiceId: item.voiceId,
    modelId: item.modelId,
    languageByModel: {},
    preferredLanguage: item.language,
    draftId: mode === "edit" ? item.id : null,
    replacesId: mode === "copy" ? item.id : null,
    baseline: freshBaseline(fields),
  };
}

/** Initial editor: a requested recording (deep link) when it can be edited, else a new announcement. */
export function initialEditorState(
  business: AnnouncementBusiness,
  items: readonly AnnouncementItem[],
  initialDraftId: string | null | undefined,
): EditorState {
  const requested = initialDraftId ? items.find((item) => item.id === initialDraftId) : undefined;
  if (requested) return editorStateFromRecording(requested, business, isOnAir(requested, business) ? "copy" : "edit");
  return newEditorState(business, defaultTemplateKey(items, business));
}

/** Unsaved text, placement or pronunciation (voice/model choices are not "content"). */
export function isEditorDirty(state: EditorState): boolean {
  return (
    state.text.trim() !== state.baseline.text.trim() ||
    state.placement !== state.baseline.placement ||
    state.pronunciation.trim() !== state.baseline.pronunciation.trim()
  );
}

/** The wording the editor would save: the saved spoken override while it applies, else built. */
export function editorWording(state: Pick<EditorState, "text" | "pronunciation" | "spokenOverride">, business: AnnouncementBusiness): SpokenWording {
  const built = buildSpokenWording({ text: state.text, business: brandingOf(business), pronunciation: state.pronunciation });
  if (!built.ok || state.spokenOverride === null) return built;
  const spoken = state.spokenOverride.trim();
  return { ok: true, text: built.text, spoken, spokenText: spoken === built.text ? null : spoken };
}

/**
 * Language stored on the announcement: the recording's/venue's own code while the chosen provider
 * language is the same language ("sr-Latn" stays "sr-Latn" for "sr"), else the chosen code.
 */
export function storedLanguageFor(chosenCode: string | null | undefined, preferred: string): string {
  if (!chosenCode) return preferred;
  return normalizeLanguageCode(chosenCode) === normalizeLanguageCode(preferred) ? preferred : chosenCode;
}

export interface WordingValues {
  text: string;
  spokenText: string | null;
  placement: AnnouncementPlacement;
  language: string;
}

/** Whether saving these values would change the row (so an update is needed before generating). */
export function wordingDiffers(item: Pick<AnnouncementItem, "text" | "spokenText" | "placement" | "language">, next: WordingValues, compareSpoken = true): boolean {
  return (
    item.text !== next.text ||
    (compareSpoken && (item.spokenText ?? null) !== next.spokenText) ||
    item.placement !== next.placement ||
    item.language !== next.language
  );
}

/** Whether the admin edited what the voice says (the text or the pronunciation) since the last load or save. */
export function spokenWordingEdited(state: Pick<EditorState, "text" | "pronunciation" | "baseline">): boolean {
  return state.text.trim() !== state.baseline.text.trim() || state.pronunciation.trim() !== state.baseline.pronunciation.trim();
}

/**
 * The fields of the wording update for `item`, or null when the row already has this wording.
 * Without `includeSpoken` the spoken wording is left out, and the server keeps the stored one (a
 * respelling for the voice, for example) instead of clearing it.
 */
export function wordingSaveFields(
  item: Pick<AnnouncementItem, "text" | "spokenText" | "placement" | "language">,
  next: WordingValues,
  includeSpoken: boolean,
): Record<string, string> | null {
  if (!wordingDiffers(item, next, includeSpoken)) return null;
  const fields: Record<string, string> = { text: next.text, placement: next.placement, language: next.language };
  if (includeSpoken) fields.spokenText = next.spokenText ?? "";
  return fields;
}

/** Field errors keyed by the editor's field names. */
export type EditorErrors = Partial<Record<"text" | "pronunciation" | "voiceId" | "modelId" | "languageCode" | "file", string>>;

export interface GenerateCheckInput {
  wording: SpokenWording;
  pronunciation: string;
  voice: Pick<TtsVoiceOption, "id"> | null;
  model: Pick<TtsModelOption, "id" | "languages" | "maxCharacters" | "name"> | null;
  languageCode: string;
}

/** Everything that must be right before a paid generation starts (the server checks it again). */
export function generateProblems({ wording, pronunciation, voice, model, languageCode }: GenerateCheckInput): EditorErrors {
  const errors: EditorErrors = { ...wordingProblems(wording, pronunciation) };
  if (!voice) errors.voiceId = "Choose the voice that speaks this announcement.";
  if (!model) {
    errors.modelId = "Choose a model.";
  } else {
    if (model.languages.length > 0 && !model.languages.some((language) => language.code === languageCode)) {
      errors.languageCode = `Choose one of the languages ${model.name} supports.`;
    }
    if (wording.ok && !errors.pronunciation) {
      const length = checkSpokenLength(wording.spoken, model);
      if (!length.ok && length.max !== null) {
        errors.pronunciation = `The spoken wording has ${length.count} characters, but ${model.name} accepts at most ${length.max}. Shorten it or choose another model.`;
      }
    }
  }
  return errors;
}

export function hasErrors(errors: EditorErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/** Maps a create/update action's field errors onto the editor's fields. */
export function editorErrorsFromAction(fieldErrors: Readonly<Record<string, string | undefined>>): EditorErrors {
  const errors: EditorErrors = {};
  const text = fieldErrors.customText ?? fieldErrors.text ?? fieldErrors.templateKey;
  if (text) errors.text = text;
  if (fieldErrors.spokenText) errors.pronunciation = fieldErrors.spokenText;
  if (fieldErrors.language) errors.languageCode = fieldErrors.language;
  return errors;
}

/** Names as the voice would say them with the editor's pronunciation (for the field's hint). */
export function spokenNamesPreview(business: AnnouncementBusiness, pronunciation: string): BrandingNames {
  return brandingWithPronunciation(brandingOf(business), pronunciation);
}
