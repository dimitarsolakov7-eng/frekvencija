import { describe, expect, it } from "vitest";
import type { TtsModelOption } from "@/lib/api/contracts";
import {
  describeModelLanguageSupport,
  effectiveMaxCharacters,
  isOfferedModelId,
  languageDisplayName,
  modelAcceptsLanguageCode,
  normalizeLanguageCode,
  resolveLanguageForModel,
} from "@/lib/tts/models";

const languages = (...codes: string[]) => codes.map((code) => ({ code, name: languageDisplayName(code) }));

const MULTILINGUAL_V2: TtsModelOption = {
  id: "eleven_multilingual_v2",
  name: "Eleven Multilingual v2",
  description: null,
  languages: languages("en", "bg", "hr", "el", "ro", "tr"),
  maxCharacters: 10000,
  supportsLanguageCode: false,
};
const V3: TtsModelOption = {
  id: "eleven_v3",
  name: "Eleven v3",
  description: null,
  languages: languages("en", "bg", "sr", "mk", "bs", "sl"),
  maxCharacters: 5000,
  supportsLanguageCode: true,
};
const FLASH: TtsModelOption = { ...V3, id: "eleven_flash_v2_5", name: "Eleven Flash v2.5", languages: languages("en", "bg", "hu") };
const SILENT: TtsModelOption = { ...V3, id: "eleven_custom", name: "Custom", languages: [], supportsLanguageCode: false };

describe("normalizeLanguageCode", () => {
  it.each([
    ["en", "en"],
    ["sr-Latn", "sr"],
    ["pt_BR", "pt"],
    ["BG", "bg"],
    ["bul", "bg"],
    ["srp", "sr"],
    ["fil", "fil"],
    [" hr ", "hr"],
    ["", null],
    [null, null],
    ["english", null],
    ["e1", null],
  ])("%s → %s", (input, expected) => {
    expect(normalizeLanguageCode(input)).toBe(expected);
  });
});

describe("resolveLanguageForModel", () => {
  it("never returns a code for eleven_multilingual_v2", () => {
    expect(resolveLanguageForModel(MULTILINGUAL_V2, "bg")).toBeUndefined();
    // Even if a caller wrongly flags it as supporting language_code.
    expect(resolveLanguageForModel({ ...MULTILINGUAL_V2, supportsLanguageCode: true }, "bg")).toBeUndefined();
  });

  it("returns the primary subtag when the model lists the language", () => {
    expect(resolveLanguageForModel(V3, "sr-Latn")).toBe("sr");
    expect(resolveLanguageForModel(V3, "BG")).toBe("bg");
    expect(resolveLanguageForModel(FLASH, "hu")).toBe("hu");
  });

  it("returns undefined for unlisted or invalid languages", () => {
    expect(resolveLanguageForModel(FLASH, "sr")).toBeUndefined();
    expect(resolveLanguageForModel(V3, null)).toBeUndefined();
    expect(resolveLanguageForModel(SILENT, "en")).toBeUndefined();
  });
});

describe("describeModelLanguageSupport", () => {
  it("multilingual v2 supports a listed language without sending a code", () => {
    expect(describeModelLanguageSupport(MULTILINGUAL_V2, "bg")).toEqual({
      status: "supported",
      languageCode: undefined,
      message: "Eleven Multilingual v2 supports Bulgarian; it detects the language from the text.",
    });
  });

  it("explicit-language models get the code to send", () => {
    expect(describeModelLanguageSupport(V3, "sr-Latn")).toEqual({
      status: "supported",
      languageCode: "sr",
      message: "Eleven v3 supports Serbian; the language is set explicitly.",
    });
  });

  it("flags unsupported and unknown cases", () => {
    expect(describeModelLanguageSupport(MULTILINGUAL_V2, "sr")).toMatchObject({ status: "unsupported", languageCode: undefined });
    expect(describeModelLanguageSupport(MULTILINGUAL_V2, "sr").message).toContain("does not support Serbian");
    expect(describeModelLanguageSupport(SILENT, "en")).toMatchObject({ status: "unknown" });
    expect(describeModelLanguageSupport(V3, "??")).toMatchObject({ status: "unknown" });
  });
});

describe("model rules", () => {
  it("modelAcceptsLanguageCode", () => {
    expect(modelAcceptsLanguageCode("eleven_multilingual_v2")).toBe(false);
    expect(modelAcceptsLanguageCode("eleven_v3")).toBe(true);
  });

  it("isOfferedModelId hides deprecated and non-announcement models", () => {
    expect(isOfferedModelId("eleven_multilingual_v2")).toBe(true);
    expect(isOfferedModelId("eleven_v3")).toBe(true);
    expect(isOfferedModelId("eleven_flash_v2_5")).toBe(true);
    expect(isOfferedModelId("eleven_turbo_v2_5")).toBe(false);
    expect(isOfferedModelId("eleven_monolingual_v1")).toBe(false);
    expect(isOfferedModelId("eleven_v3_conversational")).toBe(false);
  });

  it("effectiveMaxCharacters takes the smaller of documented and reported limits", () => {
    expect(effectiveMaxCharacters("eleven_v3", 1_000_000)).toBe(5000);
    expect(effectiveMaxCharacters("eleven_v3", 3000)).toBe(3000);
    expect(effectiveMaxCharacters("eleven_unknown", 2500)).toBe(2500);
    expect(effectiveMaxCharacters("eleven_unknown", null)).toBeNull();
    expect(effectiveMaxCharacters("eleven_multilingual_v2", 0)).toBe(10000);
  });
});
