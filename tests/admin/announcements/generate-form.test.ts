import { describe, expect, it } from "vitest";
import type { TtsModelOption, TtsVoiceOption } from "@/lib/api/contracts";
import {
  buildGenerateRequest,
  checkSpokenLength,
  defaultLanguageCode,
  defaultModelId,
  defaultVoiceId,
  groupVoices,
  voiceCategoryLabel,
  voiceOptionLabel,
} from "@/components/admin/announcements/generate-form";

const v2: TtsModelOption = {
  id: "eleven_multilingual_v2",
  name: "Multilingual v2",
  description: null,
  languages: [
    { code: "bg", name: "Bulgarian" },
    { code: "en", name: "English" },
  ],
  maxCharacters: 10_000,
  supportsLanguageCode: false,
};
const v3: TtsModelOption = { ...v2, id: "eleven_v3", name: "v3", languages: [{ code: "sr", name: "Serbian" }], maxCharacters: 5_000, supportsLanguageCode: true };
const unknownLanguages: TtsModelOption = { ...v2, id: "custom", name: "Custom", languages: [], maxCharacters: null };

const voice = (id: string, name: string, category: string | null, labels: Record<string, string> = {}): TtsVoiceOption => ({
  id,
  name,
  category,
  description: null,
  previewUrl: null,
  labels,
});

describe("defaults", () => {
  const voices = [voice("a", "Adam", "premade"), voice("r", "Rachel", "premade")];

  it("preselects the announcement's voice, then the venue's last voice, else nothing", () => {
    expect(defaultVoiceId(voices, ["r", "a"])).toBe("r");
    expect(defaultVoiceId(voices, ["gone", "a"])).toBe("a");
    expect(defaultVoiceId(voices, [null, undefined])).toBe("");
  });

  it("preselects the previous model, then the server default, then the first model", () => {
    expect(defaultModelId([v2, v3], "eleven_v3", "eleven_multilingual_v2")).toBe("eleven_v3");
    expect(defaultModelId([v2, v3], "retired", "eleven_multilingual_v2")).toBe("eleven_multilingual_v2");
    expect(defaultModelId([v3], null, "eleven_multilingual_v2")).toBe("eleven_v3");
    expect(defaultModelId([], null, null)).toBe("");
  });

  it("preselects the first supported language (announcement, then venue) as the model's code", () => {
    expect(defaultLanguageCode(v2, ["bg", "en"])).toBe("bg");
    expect(defaultLanguageCode(v2, ["sr-Latn", "en"])).toBe("en");
    expect(defaultLanguageCode(v3, ["sr-Latn", "en"])).toBe("sr");
    expect(defaultLanguageCode(v2, ["sr", "hu"])).toBe("");
    expect(defaultLanguageCode(unknownLanguages, ["en"])).toBe("");
    expect(defaultLanguageCode(null, ["en"])).toBe("");
  });
});

describe("voice labels and groups", () => {
  it("builds a readable label from the provider labels", () => {
    expect(voiceOptionLabel(voice("r", "Rachel", "premade", { accent: "american", gender: "Female", age: "young" }))).toBe(
      "Rachel (American, female, young)",
    );
    expect(voiceOptionLabel(voice("x", "Xi", null))).toBe("Xi");
  });

  it("groups voices by category, known categories first, names sorted", () => {
    const groups = groupVoices([
      voice("1", "Zed", "cloned"),
      voice("2", "bob", "premade"),
      voice("3", "Amy", "premade"),
      voice("4", "Odd", null),
      voice("5", "New", "brand_new"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Default voices", "Cloned voices", "Brand new voices", "Other voices"]);
    expect(groups[0].voices.map((item) => item.name)).toEqual(["Amy", "bob"]);
    expect(voiceCategoryLabel(null)).toBe("Other voices");
  });
});

describe("request building", () => {
  it("checks the spoken length against the model limit", () => {
    expect(checkSpokenLength("  Hello  ", v2)).toEqual({ ok: true, count: 5, max: 10_000 });
    expect(checkSpokenLength("x".repeat(5001), v3)).toEqual({ ok: false, count: 5001, max: 5000 });
    expect(checkSpokenLength("   ", v2).ok).toBe(false);
    expect(checkSpokenLength("Hi", unknownLanguages)).toEqual({ ok: true, count: 2, max: null });
  });

  it("sends the language only for models that list languages, and force only when set", () => {
    const rachel = { id: "r", name: "Rachel" };
    expect(buildGenerateRequest({ voice: rachel, model: v2, languageCode: "bg", force: false })).toEqual({
      voiceId: "r",
      voiceName: "Rachel",
      modelId: "eleven_multilingual_v2",
      languageCode: "bg",
    });
    expect(buildGenerateRequest({ voice: rachel, model: unknownLanguages, languageCode: "en", force: true })).toEqual({
      voiceId: "r",
      voiceName: "Rachel",
      modelId: "custom",
      force: true,
    });
  });
});
