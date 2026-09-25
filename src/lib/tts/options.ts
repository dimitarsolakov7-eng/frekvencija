/**
 * TTS options for the admin generate form (GET /api/admin/tts/options): models and voices from
 * ElevenLabs, mapped to the shared contract and cached in memory for 10 minutes per server instance.
 */
import "server-only";
import type { TtsModelOption, TtsOptionsResponse, TtsVoiceOption } from "@/lib/api/contracts";
import { getServerEnv } from "@/lib/env";
import {
  createElevenLabsClient,
  ElevenLabsError,
  type ElevenLabsClient,
  type TtsModel,
  type Voice,
} from "./elevenlabs";
import {
  compareModels,
  DEFAULT_TTS_MODEL_ID,
  effectiveMaxCharacters,
  isOfferedModelId,
  modelAcceptsLanguageCode,
  normalizeLanguageOptions,
} from "./models";

export {
  describeModelLanguageSupport,
  resolveLanguageForModel,
  type LanguageSupportStatus,
  type ModelLanguageSupport,
} from "./models";

export const TTS_OPTIONS_TTL_MS = 10 * 60 * 1000;

export type ConfiguredTtsOptions = Extract<TtsOptionsResponse, { configured: true }>;

export const TTS_NOT_CONFIGURED_REASON =
  "Text-to-speech is not configured. Add ELEVENLABS_API_KEY to the server environment to generate " +
  "announcements. Uploading MP3 announcements still works.";

// ---------------------------------------------------------------------------
// Mapping (pure)
// ---------------------------------------------------------------------------

export function toTtsModelOption(model: TtsModel): TtsModelOption {
  const languages = normalizeLanguageOptions(model.languages.map((language) => ({ code: language.id, name: language.name })));
  return {
    id: model.modelId,
    name: model.name,
    description: model.description,
    languages,
    maxCharacters: effectiveMaxCharacters(model.modelId, model.maxTextLength),
    // Only models that list their languages can be told which one to use.
    supportsLanguageCode: modelAcceptsLanguageCode(model.modelId) && languages.length > 0,
  };
}

export function toTtsVoiceOption(voice: Voice): TtsVoiceOption {
  return {
    id: voice.voiceId,
    name: voice.name,
    category: voice.category,
    description: voice.description,
    previewUrl: voice.previewUrl,
    labels: voice.labels,
  };
}

/** Env default when the account offers it, else eleven_multilingual_v2 when offered, else the first model. */
export function chooseDefaultModelId(models: readonly TtsModelOption[], preferred: string | null | undefined): string | null {
  const offered = (id: string | null | undefined) => (id ? models.some((model) => model.id === id) : false);
  if (offered(preferred)) return preferred ?? null;
  if (offered(DEFAULT_TTS_MODEL_ID)) return DEFAULT_TTS_MODEL_ID;
  return models[0]?.id ?? null;
}

export function buildTtsOptions(
  models: readonly TtsModel[],
  voices: readonly Voice[],
  preferredDefaultModelId: string | null | undefined,
): ConfiguredTtsOptions {
  const modelOptions = models
    .filter((model) => isOfferedModelId(model.modelId))
    .map(toTtsModelOption)
    .sort(compareModels);

  const uniqueVoices = new Map(voices.map((voice) => [voice.voiceId, voice]));
  const voiceOptions = [...uniqueVoices.values()]
    .map(toTtsVoiceOption)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));

  return {
    configured: true,
    models: modelOptions,
    voices: voiceOptions,
    defaultModelId: chooseDefaultModelId(modelOptions, preferredDefaultModelId),
  };
}

// ---------------------------------------------------------------------------
// Cached service
// ---------------------------------------------------------------------------

export interface TtsOptionsServiceDeps {
  getApiKey: () => string | null;
  getDefaultModelId: () => string | null;
  createClient: (apiKey: string) => Pick<ElevenLabsClient, "listModels" | "listVoices">;
  now?: () => number;
  ttlMs?: number;
}

export interface TtsOptionsService {
  /**
   * Resolves `{ configured: false, reason }` when no key is set or ElevenLabs rejects the key.
   * Rejects with `ElevenLabsError` for transient problems (rate limit, outage, timeout); those are
   * never cached, so the next call retries.
   */
  getTtsOptions(options?: { forceRefresh?: boolean }): Promise<TtsOptionsResponse>;
  clear(): void;
}

interface CacheEntry {
  apiKey: string;
  expiresAt: number;
  value: ConfiguredTtsOptions;
}

export function createTtsOptionsService(deps: TtsOptionsServiceDeps): TtsOptionsService {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? TTS_OPTIONS_TTL_MS;
  let cache: CacheEntry | null = null;
  // Concurrent requests for the same key share one pair of provider calls.
  let inFlight: { apiKey: string; promise: Promise<TtsOptionsResponse> } | null = null;

  async function load(apiKey: string): Promise<TtsOptionsResponse> {
    const client = deps.createClient(apiKey);
    try {
      const [models, voices] = await Promise.all([client.listModels(), client.listVoices()]);
      const value = buildTtsOptions(models, voices, deps.getDefaultModelId());
      cache = { apiKey, expiresAt: now() + ttlMs, value };
      return value;
    } catch (error) {
      if (error instanceof ElevenLabsError && error.kind === "auth") {
        return {
          configured: false,
          reason:
            "ElevenLabs rejected the configured API key. Check ELEVENLABS_API_KEY; the key needs text-to-speech, " +
            "voices (read) and models (read) access." +
            (error.requestId ? ` (ElevenLabs request id: ${error.requestId})` : ""),
        };
      }
      throw error;
    }
  }

  return {
    async getTtsOptions(options = {}) {
      const apiKey = deps.getApiKey();
      if (!apiKey) return { configured: false, reason: TTS_NOT_CONFIGURED_REASON };

      if (!options.forceRefresh && cache && cache.apiKey === apiKey && cache.expiresAt > now()) return cache.value;
      if (inFlight && inFlight.apiKey === apiKey) return inFlight.promise;

      const promise = load(apiKey).finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
      });
      inFlight = { apiKey, promise };
      return promise;
    },
    clear() {
      cache = null;
      inFlight = null;
    },
  };
}

const defaultService = createTtsOptionsService({
  getApiKey: () => getServerEnv().elevenLabsApiKey,
  getDefaultModelId: () => getServerEnv().elevenLabsDefaultModelId,
  createClient: (apiKey) => createElevenLabsClient({ apiKey }),
});

/** Models and voices for the admin UI, cached for 10 minutes. See TtsOptionsService.getTtsOptions. */
export function getTtsOptions(options?: { forceRefresh?: boolean }): Promise<TtsOptionsResponse> {
  return defaultService.getTtsOptions(options);
}

/** Drops the cached options (e.g. after the admin changes ElevenLabs voices). */
export function clearTtsOptionsCache(): void {
  defaultService.clear();
}
