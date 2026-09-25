/**
 * Spoken wording for the announcement editor (screen 07).
 *
 * The admin writes the announcement text with the venue's real names ("You’re listening to
 * EmeraldBar Radio.") and may give a pronunciation spelling for the venue name ("Emerald Bar"). The
 * text sent to the AI voice is the same wording with the venue and station names respelled
 * (docs/research/elevenlabs.md §9: plain respelling works on every model).
 *
 * The pronunciation typed in the editor is used for THIS announcement only: nothing here changes the
 * venue's stored name or pronunciation. Pure and client-safe.
 */
import { renderAnnouncement, validateTemplateText, type BrandingNames } from "./templates";

/** Database limit of `announcements.text` (display wording). */
export const ANNOUNCEMENT_TEXT_MAX_LENGTH = 500;
/** Database limit of `announcements.spoken_text` (wording sent to the voice). */
export const SPOKEN_TEXT_MAX_LENGTH = 1000;
/** Same limit as `businesses.name_pronunciation`. */
export const PRONUNCIATION_MAX_LENGTH = 200;

// ---------------------------------------------------------------------------
// Character counter
// ---------------------------------------------------------------------------

export interface TextCounter {
  /** Characters that will be stored (placeholders filled in, surrounding whitespace removed). */
  count: number;
  max: number;
  over: boolean;
  /** "36/500" */
  label: string;
}

/**
 * Live counter for the announcement text field. Counts what is stored, i.e. the rendered display
 * wording when the text uses {business_name}/{station_name} placeholders, measured like the server's
 * validation (UTF-16 length after trimming).
 */
export function announcementTextCounter(text: string, business?: BrandingNames | null): TextCounter {
  let count = text.trim().length;
  if (business && validateTemplateText(text).ok) {
    count = renderAnnouncement({ template: text, business, mode: "display" }).length;
  }
  const max = ANNOUNCEMENT_TEXT_MAX_LENGTH;
  return { count, max, over: count > max, label: `${count}/${max}` };
}

// ---------------------------------------------------------------------------
// Spoken wording
// ---------------------------------------------------------------------------

/**
 * Names to speak when the editor's pronunciation spelling replaces the venue's saved one. The saved
 * station pronunciation belongs to the saved name pronunciation, so it is only used while the editor
 * still shows that spelling; otherwise the station is spoken as its written name with the venue name
 * respelled ("EmeraldBar Radio" → "Emerald Bar Radio").
 */
export function brandingWithPronunciation(business: BrandingNames, pronunciation: string | null | undefined): BrandingNames {
  const typed = pronunciation?.trim() ?? "";
  const saved = business.namePronunciation?.trim() ?? "";
  return {
    name: business.name,
    stationName: business.stationName,
    namePronunciation: typed || null,
    stationNamePronunciation: typed === saved ? (business.stationNamePronunciation ?? null) : null,
  };
}

export type SpokenWording =
  | {
      ok: true;
      /** Display wording to store (placeholders filled in with the written names). */
      text: string;
      /** What the voice says. */
      spoken: string;
      /** Value for `spoken_text`: null when it equals `text` (the database then speaks `text`). */
      spokenText: string | null;
    }
  | {
      ok: false;
      /** Why the wording cannot be used yet; null for an empty field (nothing to report). */
      reason: string | null;
    };

export interface SpokenWordingInput {
  /** Announcement text as typed (real names; placeholders are allowed). */
  text: string;
  business: BrandingNames;
  /** Pronunciation spelling of the venue name from the editor ("" or null ⇒ written name). */
  pronunciation: string | null | undefined;
}

/**
 * Builds the display and spoken wording: placeholders are filled in, and the venue and station names
 * written in the text are respelled (whole words, case-insensitive) for the voice.
 */
export function buildSpokenWording({ text, business, pronunciation }: SpokenWordingInput): SpokenWording {
  if (!text.trim()) return { ok: false, reason: null };
  const check = validateTemplateText(text);
  if (!check.ok) return { ok: false, reason: check.reason };

  const names = brandingWithPronunciation(business, pronunciation);
  const display = renderAnnouncement({ template: text, business: names, mode: "display" });
  const spoken = renderAnnouncement({ template: text, business: names, mode: "spoken" });
  return { ok: true, text: display, spoken, spokenText: spoken === display ? null : spoken };
}

export interface WordingProblems {
  /** Problem with the announcement text (empty, invalid placeholder, too long). */
  text?: string;
  /** Problem with the spoken wording built from the pronunciation (too long). */
  pronunciation?: string;
}

/** Checks the wording against the database limits before anything is saved. */
export function wordingProblems(wording: SpokenWording, pronunciation?: string | null): WordingProblems {
  const problems: WordingProblems = {};
  if (!wording.ok) {
    problems.text = wording.reason ?? "Enter the announcement text.";
    return problems;
  }
  if (wording.text.length > ANNOUNCEMENT_TEXT_MAX_LENGTH) {
    problems.text = `The announcement text must be at most ${ANNOUNCEMENT_TEXT_MAX_LENGTH} characters.`;
  }
  if ((pronunciation?.trim().length ?? 0) > PRONUNCIATION_MAX_LENGTH) {
    problems.pronunciation = `The pronunciation spelling must be at most ${PRONUNCIATION_MAX_LENGTH} characters.`;
  } else if (wording.spoken.length > SPOKEN_TEXT_MAX_LENGTH) {
    problems.pronunciation = `The spoken wording would be ${wording.spoken.length} characters; at most ${SPOKEN_TEXT_MAX_LENGTH} are allowed. Shorten the text or the pronunciation spelling.`;
  }
  return problems;
}
