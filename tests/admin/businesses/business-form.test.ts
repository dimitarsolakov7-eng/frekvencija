import { describe, expect, it } from "vitest";
import {
  BRANDING_FIELDS,
  brandingDiffers,
  BUSINESS_FIELD_MAX_LENGTH,
  BUSINESS_TYPE_OPTIONS,
  businessTypeLabel,
  isBusinessType,
  COMMON_ANNOUNCEMENT_LANGUAGES,
  isCommonLanguage,
  languageLabel,
  readBusinessFormValues,
  stationNameOrSuggestion,
  suggestStationName,
} from "@/components/admin/businesses/business-form";
import { businessCreateSchema, newBusinessSchema } from "@/lib/validation/businesses";
import { LANGUAGE_CODE_PATTERN } from "@/lib/validation/fields";
import { formDataToObject } from "@/lib/validation/forms";

function formData(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("station name suggestion", () => {
  it('suggests "<name> Radio"', () => {
    expect(suggestStationName("EmeraldBar")).toBe("EmeraldBar Radio");
    expect(suggestStationName("  Hotel   Aurora ")).toBe("Hotel Aurora Radio");
    expect(suggestStationName("")).toBe("");
    expect(suggestStationName("   ")).toBe("");
  });

  it("does not double the suffix", () => {
    expect(suggestStationName("Jazz Radio")).toBe("Jazz Radio");
    expect(suggestStationName("jazz radio")).toBe("jazz radio");
    expect(suggestStationName("Radiohead Bar")).toBe("Radiohead Bar Radio");
  });

  it("gives no suggestion when it would exceed the station name limit", () => {
    expect(suggestStationName("x".repeat(114))).toBe(`${"x".repeat(114)} Radio`);
    expect(suggestStationName("x".repeat(115))).toBe("");
    expect(BUSINESS_FIELD_MAX_LENGTH.stationName).toBe(120);
  });

  it("uses the suggestion only for a blank station name", () => {
    expect(stationNameOrSuggestion("", "EmeraldBar")).toBe("EmeraldBar Radio");
    expect(stationNameOrSuggestion("  ", "EmeraldBar")).toBe("EmeraldBar Radio");
    expect(stationNameOrSuggestion("Green Room FM", "EmeraldBar")).toBe("Green Room FM");
  });
});

describe("form values", () => {
  it("reads every field as a string and keeps the last isActive value", () => {
    const values = readBusinessFormValues(
      formData([
        ["name", "EmeraldBar"],
        ["stationName", ""],
        ["announcementLanguage", "bg"],
        ["businessType", "bar"],
        ["isActive", "false"],
        ["isActive", "true"],
      ]),
    );
    expect(values).toEqual({
      name: "EmeraldBar",
      stationName: "",
      namePronunciation: "",
      stationNamePronunciation: "",
      contactEmail: "",
      announcementLanguage: "bg",
      businessType: "bar",
      isActive: "true",
    });
  });

  it("parses a submitted create form (hidden false + switch) with the create schema", () => {
    const off = businessCreateSchema.parse(formDataToObject(formData([["name", "A"], ["stationName", "A Radio"], ["isActive", "false"]])));
    expect(off.isActive).toBe(false);
    const on = businessCreateSchema.parse(
      formDataToObject(formData([["name", "A"], ["stationName", "A Radio"], ["isActive", "false"], ["isActive", "true"]])),
    );
    expect(on.isActive).toBe(true);
    expect(on.announcementLanguage).toBe("en");
  });

  it("detects branding changes the way the database trigger does", () => {
    const current = { name: "EmeraldBar", stationName: "EmeraldBar Radio", namePronunciation: null, stationNamePronunciation: "Emerald Bar Radio" };
    expect(brandingDiffers(current, { name: " EmeraldBar ", stationName: "EmeraldBar Radio", namePronunciation: "", stationNamePronunciation: "Emerald Bar Radio" })).toBe(false);
    expect(brandingDiffers(current, { namePronunciation: "Emerald Bar" })).toBe(true);
    expect(brandingDiffers(current, { stationNamePronunciation: "" })).toBe(true);
    expect(brandingDiffers(current, { stationName: "Emerald  Bar Radio" })).toBe(true);
    expect(brandingDiffers(current, {})).toBe(false);
    expect(BRANDING_FIELDS).toEqual(["name", "stationName", "namePronunciation", "stationNamePronunciation"]);
  });
});

describe("business types", () => {
  it("offers every enum value with the public form's labels", () => {
    expect(BUSINESS_TYPE_OPTIONS.map((option) => option.value)).toEqual(["cafe", "restaurant", "hotel", "bar", "other"]);
    expect(businessTypeLabel("cafe")).toBe("Café");
    expect(businessTypeLabel("bar")).toBe("Bar");
    expect(businessTypeLabel("unknown")).toBe("Other");
    expect(isBusinessType("hotel")).toBe(true);
    expect(isBusinessType("pub")).toBe(false);
  });

  it("requires a type on the add form, and rejects unknown ones everywhere", () => {
    expect(businessCreateSchema.parse({ name: "A", stationName: "A Radio" }).businessType).toBeUndefined();
    expect(businessCreateSchema.safeParse({ name: "A", stationName: "A Radio", businessType: "pub" }).success).toBe(false);
    const added = newBusinessSchema.safeParse({ name: "A", stationName: "A Radio" });
    expect(added.success).toBe(false);
    expect(added.error?.issues[0].path).toEqual(["businessType"]);
  });
});

describe("announcement languages", () => {
  it("offers the required languages with valid codes", () => {
    const codes = COMMON_ANNOUNCEMENT_LANGUAGES.map((option) => option.code);
    for (const required of ["en", "bg", "sr", "hr", "el", "ro", "tr", "de", "fr", "it", "es"]) {
      expect(codes).toContain(required);
    }
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(LANGUAGE_CODE_PATTERN);
    expect(codes[0]).toBe("en");
  });

  it("labels common codes and passes other codes through", () => {
    expect(isCommonLanguage("bg")).toBe(true);
    expect(isCommonLanguage("pt-BR")).toBe(false);
    expect(languageLabel("bg")).toBe("Bulgarian (bg)");
    expect(languageLabel("pt-BR")).toBe("pt-BR");
  });
});
