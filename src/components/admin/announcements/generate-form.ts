/**
 * Pure helpers for the "Generate with AI" dialog: default choices, voice grouping and labels, the
 * character-limit check and the request body. Client-safe (no secrets, no Node APIs).
 */
import type { GenerateAnnouncementRequest, TtsModelOption, TtsVoiceOption } from "@/lib/api/contracts";
import { normalizeLanguageCode } from "@/lib/tts/models";

/** First preferred voice the account still offers, or "" (the admin must choose). */
export function defaultVoiceId(voices: readonly TtsVoiceOption[], preferred: readonly (string | null | undefined)[]): string {
  for (const id of preferred) {
    if (id && voices.some((voice) => voice.id === id)) return id;
  }
  return "";
}

/** The announcement's previous model when still offered, else the server default, else the first model. */
export function defaultModelId(
  models: readonly TtsModelOption[],
  previous: string | null | undefined,
  serverDefault: string | null | undefined,
): string {
  for (const id of [previous, serverDefault]) {
    if (id && models.some((model) => model.id === id)) return id;
  }
  return models[0]?.id ?? "";
}

/**
 * The first candidate language (announcement language, then venue language) that the model lists,
 * as the model's own code; "" when none is listed (the admin must choose, and is warned).
 */
export function defaultLanguageCode(model: Pick<TtsModelOption, "languages"> | null | undefined, candidates: readonly (string | null | undefined)[]): string {
  if (!model) return "";
  for (const candidate of candidates) {
    const code = normalizeLanguageCode(candidate);
    if (code && model.languages.some((language) => language.code === code)) return code;
  }
  return "";
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  premade: "Default voices",
  professional: "Professional voices",
  high_quality: "High-quality voices",
  cloned: "Cloned voices",
  generated: "Designed voices",
  famous: "Iconic voices",
};
const CATEGORY_ORDER = ["premade", "professional", "high_quality", "cloned", "generated", "famous"];

export function voiceCategoryLabel(category: string | null): string {
  if (!category) return "Other voices";
  return CATEGORY_LABELS[category] ?? `${category.charAt(0).toUpperCase()}${category.slice(1).replace(/_/g, " ")} voices`;
}

export interface VoiceGroup {
  key: string;
  label: string;
  voices: TtsVoiceOption[];
}

/** Voices grouped by category (for <optgroup>), known categories first, names sorted within a group. */
export function groupVoices(voices: readonly TtsVoiceOption[]): VoiceGroup[] {
  const groups = new Map<string, TtsVoiceOption[]>();
  for (const voice of voices) {
    const key = voice.category ?? "other";
    groups.set(key, [...(groups.get(key) ?? []), voice]);
  }
  const rank = (key: string) => {
    const index = CATEGORY_ORDER.indexOf(key);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, list]) => ({
      key,
      label: voiceCategoryLabel(key === "other" ? null : key),
      voices: [...list].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
    }));
}

const LABEL_KEYS = ["accent", "gender", "age"] as const;

/** "Rachel (American, female, young)" from the provider labels, or just the name. */
export function voiceOptionLabel(voice: Pick<TtsVoiceOption, "name" | "labels">): string {
  const traits = LABEL_KEYS.map((key) => voice.labels[key]?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value, index) => (index === 0 ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value.toLowerCase()).replace(/_/g, " "));
  return traits.length > 0 ? `${voice.name} (${traits.join(", ")})` : voice.name;
}

export interface SpokenLengthCheck {
  ok: boolean;
  count: number;
  max: number | null;
}

/** Characters sent to the model versus its per-request limit (null ⇒ not reported). */
export function checkSpokenLength(spoken: string, model: Pick<TtsModelOption, "maxCharacters"> | null | undefined): SpokenLengthCheck {
  const count = spoken.trim().length;
  const max = model?.maxCharacters ?? null;
  return { ok: count > 0 && (max === null || count <= max), count, max };
}

export interface GenerateSelection {
  voice: Pick<TtsVoiceOption, "id" | "name">;
  model: Pick<TtsModelOption, "id" | "languages">;
  /** Chosen code from the model's list; ignored when the model lists no languages. */
  languageCode: string;
  force: boolean;
}

/** Request body for POST /api/admin/announcements/[id]/generate. */
export function buildGenerateRequest({ voice, model, languageCode, force }: GenerateSelection): GenerateAnnouncementRequest {
  const request: GenerateAnnouncementRequest = { voiceId: voice.id, voiceName: voice.name, modelId: model.id };
  if (model.languages.length > 0 && languageCode) request.languageCode = languageCode;
  if (force) request.force = true;
  return request;
}
