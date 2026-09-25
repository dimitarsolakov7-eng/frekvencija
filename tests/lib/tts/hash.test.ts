import { describe, expect, it } from "vitest";
import { generationHash, type GenerationHashInput } from "@/lib/tts/hash";

const BASE: GenerationHashInput = {
  spokenText: "Welcome to Emerald Bar. Enjoy the music.",
  voiceId: "voice-1",
  modelId: "eleven_flash_v2_5",
  languageCode: "en",
  outputFormat: "mp3_44100_128",
  voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 },
};

describe("generationHash", () => {
  it("is a stable sha256 hex digest", () => {
    const hash = generationHash(BASE);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generationHash({ ...BASE })).toBe(hash);
  });

  it("ignores voice-setting key order, undefined settings and surrounding whitespace", () => {
    const reordered = generationHash({
      ...BASE,
      spokenText: `  ${BASE.spokenText}\n`,
      voiceSettings: { speed: 1, use_speaker_boost: true, style: 0, similarity_boost: 0.75, stability: 0.5 },
    });
    expect(reordered).toBe(generationHash(BASE));
    expect(generationHash({ ...BASE, voiceSettings: { stability: 0.5, speed: undefined } })).toBe(
      generationHash({ ...BASE, voiceSettings: { stability: 0.5 } }),
    );
    expect(generationHash({ ...BASE, voiceSettings: {} })).toBe(generationHash({ ...BASE, voiceSettings: null }));
  });

  it("defaults the output format to mp3_44100_128", () => {
    expect(generationHash({ ...BASE, outputFormat: undefined })).toBe(generationHash(BASE));
  });

  it.each([
    ["spoken text", { spokenText: "Welcome to EmeraldBar. Enjoy the music." }],
    ["voice", { voiceId: "voice-2" }],
    ["model", { modelId: "eleven_v3" }],
    ["language", { languageCode: "bg" }],
    ["output format", { outputFormat: "mp3_44100_192" }],
    ["voice settings", { voiceSettings: { ...BASE.voiceSettings, stability: 0.6 } }],
  ] as const)("changes when the %s changes", (_label, change) => {
    expect(generationHash({ ...BASE, ...change })).not.toBe(generationHash(BASE));
  });

  it("ignores the language for eleven_multilingual_v2 (it is never sent)", () => {
    const v2 = { ...BASE, modelId: "eleven_multilingual_v2" };
    expect(generationHash({ ...v2, languageCode: "bg" })).toBe(generationHash({ ...v2, languageCode: null }));
    expect(generationHash({ ...v2, languageCode: "bg" })).toBe(generationHash({ ...v2, languageCode: undefined }));
  });
});
