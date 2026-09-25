import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsModelOption } from "@/lib/api/contracts";
import { ElevenLabsError, type TtsModel, type Voice } from "@/lib/tts/elevenlabs";
import {
  buildTtsOptions,
  chooseDefaultModelId,
  clearTtsOptionsCache,
  createTtsOptionsService,
  getTtsOptions,
  TTS_NOT_CONFIGURED_REASON,
  TTS_OPTIONS_TTL_MS,
  type TtsOptionsServiceDeps,
} from "@/lib/tts/options";

function model(modelId: string, name: string, languages: [string, string][], extra: Partial<TtsModel> = {}): TtsModel {
  return {
    modelId,
    name,
    description: null,
    languages: languages.map(([id, languageName]) => ({ id, name: languageName })),
    maxTextLength: null,
    costMultiplier: 1,
    canUseStyle: true,
    canUseSpeakerBoost: true,
    ...extra,
  };
}

function voice(voiceId: string, name: string): Voice {
  return { voiceId, name, category: "premade", description: null, labels: {}, previewUrl: null, verifiedLanguages: [] };
}

const MODELS: TtsModel[] = [
  model("eleven_flash_v2_5", "Eleven Flash v2.5", [["en", "English"], ["hu", "Hungarian"], ["bg", "Bulgarian"]], { maxTextLength: 40000 }),
  model("eleven_custom_beta", "Custom beta", []),
  model("eleven_turbo_v2_5", "Eleven Turbo v2.5", [["en", "English"]]),
  model("eleven_v3", "Eleven v3", [["eng", "English"], ["bul", "Bulgarian"], ["srp", "Serbian"], ["en-US", "English (US)"]], {
    maxTextLength: 1_000_000,
  }),
  model("eleven_multilingual_v2", "Eleven Multilingual v2", [["en", "English"], ["bg", "Bulgarian"], ["hr", "Croatian"]], {
    description: "Most stable",
    maxTextLength: 10000,
  }),
];

const VOICES: Voice[] = [voice("v2", "zoe"), voice("v1", "Adam"), voice("v3", "Bella"), voice("v1", "Adam (duplicate)")];

describe("buildTtsOptions", () => {
  const options = buildTtsOptions(MODELS, VOICES, null);

  it("hides deprecated models and orders the rest sensibly", () => {
    expect(options.models.map((m) => m.id)).toEqual(["eleven_multilingual_v2", "eleven_v3", "eleven_flash_v2_5", "eleven_custom_beta"]);
  });

  it("never marks eleven_multilingual_v2 as supporting language_code", () => {
    const byId = Object.fromEntries(options.models.map((m) => [m.id, m]));
    expect(byId.eleven_multilingual_v2.supportsLanguageCode).toBe(false);
    expect(byId.eleven_v3.supportsLanguageCode).toBe(true);
    expect(byId.eleven_flash_v2_5.supportsLanguageCode).toBe(true);
    expect(byId.eleven_custom_beta.supportsLanguageCode).toBe(false); // lists no languages
  });

  it("normalises, de-duplicates and sorts languages", () => {
    const v3 = options.models.find((m) => m.id === "eleven_v3");
    expect(v3?.languages).toEqual([
      { code: "bg", name: "Bulgarian" },
      { code: "en", name: "English" },
      { code: "sr", name: "Serbian" },
    ]);
  });

  it("caps maxCharacters at the documented limit", () => {
    const byId = Object.fromEntries(options.models.map((m) => [m.id, m]));
    expect(byId.eleven_v3.maxCharacters).toBe(5000); // provider reported a 1,000,000 placeholder
    expect(byId.eleven_multilingual_v2.maxCharacters).toBe(10000);
    expect(byId.eleven_flash_v2_5.maxCharacters).toBe(40000);
    expect(byId.eleven_custom_beta.maxCharacters).toBeNull();
  });

  it("maps, de-duplicates and sorts voices by name", () => {
    expect(options.voices.map((v) => [v.id, v.name])).toEqual([
      ["v1", "Adam (duplicate)"],
      ["v3", "Bella"],
      ["v2", "zoe"],
    ]);
    expect(options.voices[0]).toEqual({ id: "v1", name: "Adam (duplicate)", category: "premade", description: null, previewUrl: null, labels: {} });
  });

  it("chooses the default model", () => {
    expect(options.defaultModelId).toBe("eleven_multilingual_v2");
    expect(buildTtsOptions(MODELS, [], "eleven_flash_v2_5").defaultModelId).toBe("eleven_flash_v2_5");
    // A configured default the account does not offer (or that is hidden) falls back.
    expect(buildTtsOptions(MODELS, [], "eleven_turbo_v2_5").defaultModelId).toBe("eleven_multilingual_v2");
    const withoutV2 = MODELS.filter((m) => m.modelId !== "eleven_multilingual_v2");
    expect(buildTtsOptions(withoutV2, [], null).defaultModelId).toBe("eleven_v3");
    expect(chooseDefaultModelId([], "eleven_v3")).toBeNull();
  });
});

describe("createTtsOptionsService", () => {
  let clock: number;
  let listModels: ReturnType<typeof vi.fn<() => Promise<TtsModel[]>>>;
  let listVoices: ReturnType<typeof vi.fn<() => Promise<Voice[]>>>;
  let apiKey: string | null;
  let createClient: ReturnType<typeof vi.fn<TtsOptionsServiceDeps["createClient"]>>;

  beforeEach(() => {
    clock = 1_000_000;
    apiKey = "key-1";
    listModels = vi.fn(async () => MODELS);
    listVoices = vi.fn(async () => VOICES);
    createClient = vi.fn(() => ({ listModels, listVoices }));
  });

  const service = () =>
    createTtsOptionsService({ getApiKey: () => apiKey, getDefaultModelId: () => null, createClient, now: () => clock });

  it("reports not configured without calling the provider when no key is set", async () => {
    apiKey = null;
    expect(await service().getTtsOptions()).toEqual({ configured: false, reason: TTS_NOT_CONFIGURED_REASON });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("caches for 10 minutes", async () => {
    const s = service();
    const first = await s.getTtsOptions();
    expect(first.configured).toBe(true);
    clock += TTS_OPTIONS_TTL_MS - 1;
    expect(await s.getTtsOptions()).toBe(first);
    expect(listModels).toHaveBeenCalledTimes(1);
    clock += 1;
    await s.getTtsOptions();
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(listVoices).toHaveBeenCalledTimes(2);
  });

  it("reloads on forceRefresh, after clear() and when the key changes", async () => {
    const s = service();
    await s.getTtsOptions();
    await s.getTtsOptions({ forceRefresh: true });
    s.clear();
    await s.getTtsOptions();
    apiKey = "key-2";
    await s.getTtsOptions();
    expect(listModels).toHaveBeenCalledTimes(4);
    expect(createClient).toHaveBeenLastCalledWith("key-2");
  });

  it("shares one provider round-trip between concurrent callers", async () => {
    const s = service();
    const [a, b] = await Promise.all([s.getTtsOptions(), s.getTtsOptions()]);
    expect(a).toBe(b);
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("turns a rejected key into configured:false and does not cache it", async () => {
    listVoices.mockRejectedValueOnce(new ElevenLabsError("auth", "ElevenLabs 401: Invalid API key", { status: 401, requestId: "r1" }));
    const s = service();
    const result = await s.getTtsOptions();
    expect(result.configured).toBe(false);
    if (!result.configured) expect(result.reason).toMatch(/rejected the configured API key.*request id: r1/);
    expect((await s.getTtsOptions()).configured).toBe(true);
  });

  it("propagates transient provider errors and retries on the next call", async () => {
    listModels.mockRejectedValueOnce(new ElevenLabsError("timeout", "slow"));
    const s = service();
    await expect(s.getTtsOptions()).rejects.toMatchObject({ kind: "timeout" });
    expect((await s.getTtsOptions()).configured).toBe(true);
    expect(listModels).toHaveBeenCalledTimes(2);
  });
});

describe("getTtsOptions (env + fetch)", () => {
  beforeEach(() => {
    clearTtsOptionsCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearTtsOptionsCache();
  });

  it("returns not configured when ELEVENLABS_API_KEY is missing", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getTtsOptions()).toEqual({ configured: false, reason: TTS_NOT_CONFIGURED_REASON });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads models and voices from ElevenLabs with the configured default model", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "sk_live_example");
    vi.stubEnv("ELEVENLABS_DEFAULT_MODEL_ID", "eleven_flash_v2_5");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const body =
        url.pathname === "/v1/models"
          ? [
              {
                model_id: "eleven_multilingual_v2",
                name: "Eleven Multilingual v2",
                can_do_text_to_speech: true,
                languages: [{ language_id: "en", name: "English" }],
              },
              {
                model_id: "eleven_flash_v2_5",
                name: "Eleven Flash v2.5",
                can_do_text_to_speech: true,
                languages: [{ language_id: "hu", name: "Hungarian" }],
              },
            ]
          : { voices: [{ voice_id: "voice-1", name: "Rachel", labels: { accent: "american" } }], has_more: false, next_page_token: null };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTtsOptions();
    expect(result).toEqual({
      configured: true,
      defaultModelId: "eleven_flash_v2_5",
      models: [
        {
          id: "eleven_multilingual_v2",
          name: "Eleven Multilingual v2",
          description: null,
          languages: [{ code: "en", name: "English" }],
          maxCharacters: 10000,
          supportsLanguageCode: false,
        },
        {
          id: "eleven_flash_v2_5",
          name: "Eleven Flash v2.5",
          description: null,
          languages: [{ code: "hu", name: "Hungarian" }],
          maxCharacters: 40000,
          supportsLanguageCode: true,
        },
      ],
      voices: [{ id: "voice-1", name: "Rachel", category: null, description: null, previewUrl: null, labels: { accent: "american" } }],
    });
    for (const [, init] of fetchMock.mock.calls) expect(init?.headers).toMatchObject({ "xi-api-key": "sk_live_example" });

    await getTtsOptions();
    expect(fetchMock).toHaveBeenCalledTimes(2); // cached: no further provider calls
  });
});

describe("model option contract", () => {
  it("satisfies TtsModelOption", () => {
    const option: TtsModelOption = buildTtsOptions(MODELS, [], null).models[0];
    expect(Object.keys(option).sort()).toEqual(["description", "id", "languages", "maxCharacters", "name", "supportsLanguageCode"]);
  });
});
