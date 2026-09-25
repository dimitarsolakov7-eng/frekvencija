/**
 * Pure ElevenLabs model and language rules (docs/research/elevenlabs.md §5, §6).
 *
 * Client-safe: no secrets, no Node APIs. Admin UI components import from here; server code may use
 * the re-exports in `@/lib/tts/options`.
 */
import type { TtsLanguageOption, TtsModelOption } from "@/lib/api/contracts";

/** Default model: most stable quality, best number normalisation, 10k characters per request. */
export const DEFAULT_TTS_MODEL_ID = "eleven_multilingual_v2";

/** 44.1 kHz / 128 kbps MP3: available on every plan and matches the music catalogue. */
export const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

/** The docs say `language_code` is not supported by these models, so it is never sent to them. */
const MODELS_WITHOUT_LANGUAGE_CODE: ReadonlySet<string> = new Set(["eleven_multilingual_v2", "eleven_multilingual_v1"]);

/** Whether a `language_code` parameter may be sent to this model at all. */
export function modelAcceptsLanguageCode(modelId: string): boolean {
  return !MODELS_WITHOUT_LANGUAGE_CODE.has(modelId);
}

/**
 * Documented per-request character limits. `/v1/models` also reports
 * `maximum_text_length_per_request`, but the OpenAPI example value (1,000,000) shows it can be a
 * placeholder, so the smaller of the two wins.
 */
const DOCUMENTED_MAX_CHARACTERS: Readonly<Record<string, number>> = {
  eleven_v3: 5_000,
  eleven_multilingual_v2: 10_000,
  eleven_flash_v2_5: 40_000,
  eleven_flash_v2: 30_000,
};

export function effectiveMaxCharacters(modelId: string, reported: number | null | undefined): number | null {
  const documented = DOCUMENTED_MAX_CHARACTERS[modelId];
  const provider = typeof reported === "number" && Number.isFinite(reported) && reported > 0 ? Math.floor(reported) : undefined;
  if (documented === undefined && provider === undefined) return null;
  return Math.min(documented ?? Number.POSITIVE_INFINITY, provider ?? Number.POSITIVE_INFINITY);
}

/**
 * Models we never offer for announcements: deprecated Turbo models (Flash is the functional
 * equivalent), retired v1 models, and the realtime conversational model meant for agents.
 */
const HIDDEN_MODEL_PATTERNS: readonly RegExp[] = [/turbo/, /^eleven_(monolingual|multilingual)_v1$/, /conversational/];

export function isOfferedModelId(modelId: string): boolean {
  return !HIDDEN_MODEL_PATTERNS.some((pattern) => pattern.test(modelId));
}

/** Display order: the recommended default first, then the other current TTS models, then the rest by name. */
const MODEL_PREFERENCE = ["eleven_multilingual_v2", "eleven_v3", "eleven_flash_v2_5", "eleven_flash_v2"];

export function compareModels(a: Pick<TtsModelOption, "id" | "name">, b: Pick<TtsModelOption, "id" | "name">): number {
  const rank = (id: string) => {
    const index = MODEL_PREFERENCE.indexOf(id);
    return index === -1 ? MODEL_PREFERENCE.length : index;
  };
  return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/**
 * ISO 639-3/639-2 → ISO 639-1 for the languages ElevenLabs documents. The docs list eleven_v3
 * languages with three-letter codes while the `language_code` parameter takes ISO 639-1, and the real
 * `/v1/models` `language_id` format is unverified, so provider codes are normalised through this table.
 * Codes without a two-letter form (e.g. "fil") are kept as they are.
 */
const ISO_639_1_BY_LONG_CODE: Readonly<Record<string, string>> = {
  afr: "af", amh: "am", ara: "ar", asm: "as", aze: "az", bel: "be", ben: "bn", bos: "bs", bul: "bg",
  cat: "ca", ces: "cs", cze: "cs", cym: "cy", wel: "cy", dan: "da", deu: "de", ger: "de", ell: "el",
  gre: "el", eng: "en", est: "et", eus: "eu", baq: "eu", fas: "fa", per: "fa", fin: "fi", fra: "fr",
  fre: "fr", gle: "ga", glg: "gl", guj: "gu", hau: "ha", heb: "he", hin: "hi", hrv: "hr", hun: "hu",
  hye: "hy", arm: "hy", ind: "id", isl: "is", ice: "is", ita: "it", jav: "jv", jpn: "ja", kat: "ka",
  geo: "ka", kaz: "kk", kan: "kn", kor: "ko", lav: "lv", lit: "lt", ltz: "lb", mal: "ml", mar: "mr",
  mkd: "mk", mac: "mk", msa: "ms", may: "ms", nep: "ne", nld: "nl", dut: "nl", nor: "no", nob: "nb",
  nno: "nn", pan: "pa", pol: "pl", por: "pt", pus: "ps", ron: "ro", rum: "ro", rus: "ru", slk: "sk",
  slo: "sk", slv: "sl", som: "so", spa: "es", sqi: "sq", alb: "sq", srp: "sr", swa: "sw", swe: "sv",
  tam: "ta", tel: "te", tgk: "tg", tha: "th", tur: "tr", ukr: "uk", urd: "ur", uzb: "uz", vie: "vi",
  zho: "zh", chi: "zh", cmn: "zh", yue: "zh", zul: "zu",
};

/**
 * Primary language subtag, lower-cased and in ISO 639-1 form where one exists:
 * "sr-Latn" → "sr", "BUL" → "bg", "fil" → "fil". Returns null for anything that is not a language tag.
 */
export function normalizeLanguageCode(code: string | null | undefined): string | null {
  const primary = code?.trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
  if (!/^[a-z]{2,3}$/.test(primary)) return null;
  return ISO_639_1_BY_LONG_CODE[primary] ?? primary;
}

/** English display name for a language code ("bg" → "Bulgarian"), falling back to the code itself. */
export function languageDisplayName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Normalises, de-duplicates and sorts (by name) a provider language list. */
export function normalizeLanguageOptions(languages: readonly { code: string; name: string }[]): TtsLanguageOption[] {
  const byCode = new Map<string, TtsLanguageOption>();
  for (const language of languages) {
    const code = normalizeLanguageCode(language.code);
    if (!code || byCode.has(code)) continue;
    byCode.set(code, { code, name: language.name.trim() || languageDisplayName(code) });
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

type LanguageAwareModel = Pick<TtsModelOption, "id" | "languages" | "supportsLanguageCode">;

/**
 * The `language_code` to send for a desired language (e.g. the venue's "sr-Latn"), or undefined when
 * none may be sent: never for eleven_multilingual_v2 (it detects the language from the text), and for
 * other models only when the model lists that language.
 */
export function resolveLanguageForModel(model: LanguageAwareModel, desired: string | null | undefined): string | undefined {
  if (!model.supportsLanguageCode || !modelAcceptsLanguageCode(model.id)) return undefined;
  const code = normalizeLanguageCode(desired);
  if (!code) return undefined;
  return model.languages.some((language) => language.code === code) ? code : undefined;
}

export type LanguageSupportStatus = "supported" | "unsupported" | "unknown";

export interface ModelLanguageSupport {
  status: LanguageSupportStatus;
  /** Value to send as `language_code`, or undefined when the request must not carry one. */
  languageCode: string | undefined;
  /** Admin-facing explanation for the generate form. */
  message: string;
}

/** Tells the admin UI whether a model can speak the venue's announcement language. */
export function describeModelLanguageSupport(
  model: LanguageAwareModel & Pick<TtsModelOption, "name">,
  businessLanguage: string | null | undefined,
): ModelLanguageSupport {
  const code = normalizeLanguageCode(businessLanguage);
  if (!code) {
    return { status: "unknown", languageCode: undefined, message: "The venue has no valid announcement language set." };
  }
  const languageName = languageDisplayName(code);
  if (model.languages.length === 0) {
    return {
      status: "unknown",
      languageCode: undefined,
      message: `${model.name} does not report which languages it supports. Listen to the result to check the ${languageName} pronunciation.`,
    };
  }
  if (!model.languages.some((language) => language.code === code)) {
    return {
      status: "unsupported",
      languageCode: undefined,
      message: `${model.name} does not support ${languageName}. Choose another model, or the announcement may be spoken in the wrong language or accent.`,
    };
  }
  const languageCode = resolveLanguageForModel(model, code);
  return {
    status: "supported",
    languageCode,
    message: languageCode
      ? `${model.name} supports ${languageName}; the language is set explicitly.`
      : `${model.name} supports ${languageName}; it detects the language from the text.`,
  };
}
