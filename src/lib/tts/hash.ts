/**
 * Fingerprint of a TTS request, stored as `announcements.generation_hash`. When the fingerprint of a
 * new request equals the stored one, the existing audio already matches and no paid call is made.
 *
 * The hash covers exactly what is sent to ElevenLabs: the text as trimmed by the client, and the
 * language code only for models that receive one (eleven_multilingual_v2 never does).
 */
import { createHash } from "node:crypto";
import type { VoiceSettings } from "./elevenlabs";
import { DEFAULT_OUTPUT_FORMAT, modelAcceptsLanguageCode } from "./models";

export interface GenerationHashInput {
  /** The final spoken wording (pronunciation respelling already applied). */
  spokenText: string;
  voiceId: string;
  modelId: string;
  languageCode?: string | null;
  /** Defaults to mp3_44100_128. */
  outputFormat?: string;
  voiceSettings?: VoiceSettings | null;
}

/** Bump when the canonical form changes so old hashes no longer match. */
const HASH_VERSION = 1;

type Canonical = string | number | boolean | null | Canonical[] | { [key: string]: Canonical };

/** JSON with object keys sorted and undefined members dropped, so equal requests hash equally. */
function canonicalJson(value: Canonical): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalVoiceSettings(settings: VoiceSettings | null | undefined): Canonical {
  if (!settings) return null;
  const out: Record<string, Canonical> = {};
  for (const [key, value] of Object.entries(settings) as [string, number | boolean | undefined][]) {
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** sha256 (hex) of the canonical TTS request. */
export function generationHash(input: GenerationHashInput): string {
  const languageCode = modelAcceptsLanguageCode(input.modelId) ? input.languageCode?.trim() || null : null;
  const payload: Canonical = {
    v: HASH_VERSION,
    text: input.spokenText.trim(),
    voiceId: input.voiceId,
    modelId: input.modelId,
    languageCode,
    outputFormat: input.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
    voiceSettings: canonicalVoiceSettings(input.voiceSettings),
  };
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}
