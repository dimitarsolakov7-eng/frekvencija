/**
 * Announcement wording templates and rendering (docs/ARCHITECTURE.md §5.2 `announcements`).
 *
 * `text` (display wording) uses the real names; `spoken_text` uses the pronunciation spellings so the
 * TTS voice says the brand correctly (plain respelling works on every ElevenLabs model — see
 * docs/research/elevenlabs.md §9). Pure and client-safe.
 */
import type { AnnouncementPlacement } from "@/lib/api/contracts";

/** Placeholders a template may use, with admin-facing help text. */
export const TEMPLATE_PLACEHOLDERS = {
  business_name: "The venue's name, e.g. EmeraldBar",
  station_name: "The station name, e.g. EmeraldBar Radio",
} as const;
export type TemplatePlaceholder = keyof typeof TEMPLATE_PLACEHOLDERS;

export interface AnnouncementTemplate {
  key: string;
  label: string;
  text: string;
  defaultPlacement: AnnouncementPlacement;
}

export const ANNOUNCEMENT_TEMPLATES = [
  {
    key: "welcome_enjoy",
    label: "Welcome",
    text: "Welcome to {business_name}. Enjoy the music.",
    defaultPlacement: "welcome",
  },
  {
    key: "welcome_station",
    label: "Welcome and station name",
    text: "Welcome to {business_name}. You’re listening to {station_name}.",
    defaultPlacement: "welcome",
  },
  {
    key: "station_listening",
    label: "You’re listening to…",
    text: "You’re listening to {station_name}.",
    defaultPlacement: "rotation",
  },
  {
    key: "good_music",
    label: "Good music, good company",
    text: "Good music. Good company. This is {station_name}.",
    defaultPlacement: "rotation",
  },
  {
    key: "thank_you_visit",
    label: "Thank you for visiting",
    text: "Thank you for spending time with us at {business_name}. We hope to see you again soon.",
    defaultPlacement: "rotation",
  },
] as const satisfies readonly AnnouncementTemplate[];

export type AnnouncementTemplateKey = (typeof ANNOUNCEMENT_TEMPLATES)[number]["key"];

export function isAnnouncementTemplateKey(key: unknown): key is AnnouncementTemplateKey {
  return typeof key === "string" && ANNOUNCEMENT_TEMPLATES.some((template) => template.key === key);
}

export function getAnnouncementTemplate(key: string | null | undefined): AnnouncementTemplate | null {
  return ANNOUNCEMENT_TEMPLATES.find((template) => template.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------

type Segment = { kind: "text"; value: string } | { kind: "placeholder"; name: TemplatePlaceholder };

type ParsedTemplate =
  | { ok: true; segments: Segment[]; placeholders: TemplatePlaceholder[] }
  | { ok: false; reason: string; unknownPlaceholders: string[] };

const KNOWN_PLACEHOLDERS = Object.keys(TEMPLATE_PLACEHOLDERS) as TemplatePlaceholder[];
const PLACEHOLDER_HINT = KNOWN_PLACEHOLDERS.map((name) => `{${name}}`).join(" or ");

function isPlaceholderName(name: string): name is TemplatePlaceholder {
  return (KNOWN_PLACEHOLDERS as string[]).includes(name);
}

/** Placeholder names are matched case-insensitively and may have spaces inside the braces: `{ Station_Name }`. */
function parseTemplate(text: string): ParsedTemplate {
  if (!text.trim()) return { ok: false, reason: "Enter the announcement wording.", unknownPlaceholders: [] };

  const segments: Segment[] = [];
  const placeholders = new Set<TemplatePlaceholder>();
  const unknown: string[] = [];
  let strayBrace = false;
  let cursor = 0;

  const pushText = (value: string) => {
    if (!value) return;
    if (/[{}]/.test(value)) strayBrace = true;
    segments.push({ kind: "text", value });
  };

  for (const match of text.matchAll(/\{([^{}]*)\}/g)) {
    const index = match.index ?? 0;
    pushText(text.slice(cursor, index));
    cursor = index + match[0].length;
    const name = match[1].trim().toLowerCase();
    if (isPlaceholderName(name)) {
      placeholders.add(name);
      segments.push({ kind: "placeholder", name });
    } else if (!unknown.includes(match[0])) {
      unknown.push(match[0]);
    }
  }
  pushText(text.slice(cursor));

  if (unknown.length > 0) {
    const noun = unknown.length === 1 ? "placeholder" : "placeholders";
    return { ok: false, reason: `Unknown ${noun} ${unknown.join(", ")}. Use ${PLACEHOLDER_HINT}.`, unknownPlaceholders: unknown };
  }
  if (strayBrace) {
    return {
      ok: false,
      reason: `Remove the stray “{” or “}”, or use a placeholder such as ${PLACEHOLDER_HINT}.`,
      unknownPlaceholders: [],
    };
  }
  return { ok: true, segments, placeholders: [...placeholders] };
}

export type TemplateValidation =
  | { ok: true; placeholders: TemplatePlaceholder[] }
  | { ok: false; reason: string; unknownPlaceholders: string[] };

/** Checks announcement wording: not blank, only known placeholders, no stray braces. */
export function validateTemplateText(text: string): TemplateValidation {
  const parsed = parseTemplate(text);
  return parsed.ok ? { ok: true, placeholders: parsed.placeholders } : parsed;
}

/** Thrown by renderAnnouncement() for wording that validateTemplateText() rejects. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface BrandingNames {
  name: string;
  stationName: string;
  /** Spoken spelling of `name`, e.g. "Emerald Bar". */
  namePronunciation?: string | null;
  /** Spoken spelling of `stationName`. */
  stationNamePronunciation?: string | null;
}

export type RenderMode = "display" | "spoken";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces whole-word, case-insensitive occurrences of each `from` with its `to` in one pass, longest
 * name first, so replaced text is never matched again. "Whole word" is Unicode-aware (Cyrillic too).
 */
function replaceNames(text: string, pairs: readonly (readonly [from: string, to: string])[]): string {
  const active = pairs.filter(([from, to]) => from.trim() !== "" && from !== to).sort((a, b) => b[0].length - a[0].length);
  if (active.length === 0) return text;
  const source = (name: string) => escapeRegExp(name.trim()).replace(/\s+/g, "\\s+");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${active.map(([from]) => source(from)).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return text.replace(pattern, (found) => active.find(([from]) => new RegExp(`^${source(from)}$`, "iu").test(found))?.[1] ?? found);
}

/**
 * Names as they should be spoken. The station falls back to its written form with the venue name
 * replaced by its pronunciation ("EmeraldBar Radio" → "Emerald Bar Radio").
 */
export function spokenBrandingNames(business: BrandingNames): { businessName: string; stationName: string } {
  const name = business.name.trim();
  const businessName = business.namePronunciation?.trim() || name;
  const stationName = business.stationNamePronunciation?.trim() || replaceNames(business.stationName.trim(), [[name, businessName]]);
  return { businessName, stationName };
}

export interface RenderAnnouncementInput {
  /** Template or custom wording, e.g. "You’re listening to {station_name}." */
  template: string;
  business: BrandingNames;
  mode: RenderMode;
}

/**
 * Fills the placeholders. In `spoken` mode the pronunciation spellings are used, and names written
 * literally in custom wording ("Welcome to EmeraldBar") are respelled as well.
 * Throws TemplateError for wording that validateTemplateText() rejects.
 */
export function renderAnnouncement({ template, business, mode }: RenderAnnouncementInput): string {
  const parsed = parseTemplate(template);
  if (!parsed.ok) throw new TemplateError(parsed.reason);

  const written = { business_name: business.name.trim(), station_name: business.stationName.trim() };
  if (mode === "display") {
    return parsed.segments.map((segment) => (segment.kind === "text" ? segment.value : written[segment.name])).join("").trim();
  }

  const spoken = spokenBrandingNames(business);
  const values: Record<TemplatePlaceholder, string> = { business_name: spoken.businessName, station_name: spoken.stationName };
  const literalPairs = [
    [written.station_name, spoken.stationName],
    [written.business_name, spoken.businessName],
  ] as const;
  return parsed.segments
    .map((segment) => (segment.kind === "text" ? replaceNames(segment.value, literalPairs) : values[segment.name]))
    .join("")
    .trim();
}

/**
 * Both stored wordings for an announcement: `spokenText` is null when it equals `text`
 * (the database treats a null spoken_text as "speak `text`").
 */
export function renderAnnouncementWording(template: string, business: BrandingNames): { text: string; spokenText: string | null } {
  const text = renderAnnouncement({ template, business, mode: "display" });
  const spoken = renderAnnouncement({ template, business, mode: "spoken" });
  return { text, spokenText: spoken === text ? null : spoken };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const PLACEMENT_LABELS: Readonly<Record<AnnouncementPlacement, string>> = {
  welcome: "Welcome",
  rotation: "Between songs",
  both: "Welcome and between songs",
};

export function placementLabel(placement: AnnouncementPlacement): string {
  return PLACEMENT_LABELS[placement];
}

/** One-sentence explanation of when an announcement with this placement plays. */
export function placementDescription(placement: AnnouncementPlacement, everyNTracks?: number): string {
  const between =
    everyNTracks === undefined
      ? "between songs"
      : everyNTracks === 1
        ? "between songs, after every track"
        : `between songs, after every ${everyNTracks} tracks`;
  switch (placement) {
    case "welcome":
      return "Plays once when the radio is started.";
    case "rotation":
      return `Plays ${between}.`;
    case "both":
      return `Plays when the radio is started and ${between}.`;
  }
}

export const ANNOUNCEMENT_PLACEMENT_OPTIONS: readonly { value: AnnouncementPlacement; label: string }[] = (
  ["welcome", "rotation", "both"] as const
).map((value) => ({ value, label: PLACEMENT_LABELS[value] }));
