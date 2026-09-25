import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_PLACEMENT_OPTIONS,
  ANNOUNCEMENT_TEMPLATES,
  getAnnouncementTemplate,
  isAnnouncementTemplateKey,
  placementDescription,
  placementLabel,
  renderAnnouncement,
  renderAnnouncementWording,
  spokenBrandingNames,
  TemplateError,
  validateTemplateText,
  type BrandingNames,
} from "@/lib/announcements/templates";
import { TEMPLATE_KEY_PATTERN } from "@/lib/validation/announcements";

const EMERALD: BrandingNames = {
  name: "EmeraldBar",
  stationName: "EmeraldBar Radio",
  namePronunciation: "Emerald Bar",
  stationNamePronunciation: null,
};

const AURORA: BrandingNames = { name: "Hotel Aurora", stationName: "Aurora FM", namePronunciation: null, stationNamePronunciation: null };

describe("ANNOUNCEMENT_TEMPLATES", () => {
  it("contains the required templates with the exact wording", () => {
    const byKey = Object.fromEntries(ANNOUNCEMENT_TEMPLATES.map((template) => [template.key, template]));
    expect(byKey.station_listening.text).toBe("You’re listening to {station_name}.");
    expect(byKey.welcome_enjoy.text).toBe("Welcome to {business_name}. Enjoy the music.");
    expect(byKey.good_music.text).toBe("Good music. Good company. This is {station_name}.");
    expect(byKey.welcome_enjoy.defaultPlacement).toBe("welcome");
    expect(byKey.station_listening.defaultPlacement).toBe("rotation");
  });

  it("has unique keys that the validation schema accepts and valid wording", () => {
    const keys = ANNOUNCEMENT_TEMPLATES.map((template) => template.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const template of ANNOUNCEMENT_TEMPLATES) {
      expect(template.key).toMatch(TEMPLATE_KEY_PATTERN);
      expect(validateTemplateText(template.text).ok).toBe(true);
      expect(template.label.length).toBeGreaterThan(0);
    }
  });

  it("looks templates up by key", () => {
    expect(getAnnouncementTemplate("good_music")?.label).toBe("Good music, good company");
    expect(getAnnouncementTemplate("nope")).toBeNull();
    expect(getAnnouncementTemplate(null)).toBeNull();
    expect(isAnnouncementTemplateKey("welcome_enjoy")).toBe(true);
    expect(isAnnouncementTemplateKey("welcome")).toBe(false);
    expect(isAnnouncementTemplateKey(42)).toBe(false);
  });
});

describe("renderAnnouncement", () => {
  it("display mode uses the written names", () => {
    expect(renderAnnouncement({ template: "You’re listening to {station_name}.", business: EMERALD, mode: "display" })).toBe(
      "You’re listening to EmeraldBar Radio.",
    );
    expect(renderAnnouncement({ template: "Welcome to {business_name}. Enjoy the music.", business: EMERALD, mode: "display" })).toBe(
      "Welcome to EmeraldBar. Enjoy the music.",
    );
  });

  it("spoken mode uses the name pronunciation", () => {
    expect(renderAnnouncement({ template: "Welcome to {business_name}. Enjoy the music.", business: EMERALD, mode: "spoken" })).toBe(
      "Welcome to Emerald Bar. Enjoy the music.",
    );
  });

  it("spoken station name falls back to the station name with the venue name respelled", () => {
    expect(renderAnnouncement({ template: "This is {station_name}.", business: EMERALD, mode: "spoken" })).toBe("This is Emerald Bar Radio.");
  });

  it("an explicit station pronunciation wins", () => {
    const business = { ...EMERALD, stationNamePronunciation: "Emerald Bar Radio Live" };
    expect(renderAnnouncement({ template: "This is {station_name}.", business, mode: "spoken" })).toBe("This is Emerald Bar Radio Live.");
  });

  it("without pronunciations spoken equals display", () => {
    const template = "Welcome to {business_name}. You’re listening to {station_name}.";
    expect(renderAnnouncement({ template, business: AURORA, mode: "spoken" })).toBe(
      renderAnnouncement({ template, business: AURORA, mode: "display" }),
    );
  });

  it("respells names written literally in custom wording, whole words only, case-insensitively", () => {
    const template = "Thanks for visiting emeraldbar! EmeraldBarista specials today on EmeraldBar Radio.";
    expect(renderAnnouncement({ template, business: EMERALD, mode: "spoken" })).toBe(
      "Thanks for visiting Emerald Bar! EmeraldBarista specials today on Emerald Bar Radio.",
    );
    expect(renderAnnouncement({ template, business: EMERALD, mode: "display" })).toBe(template);
  });

  it("does not re-respell a pronunciation that contains the written name", () => {
    const business: BrandingNames = { name: "Aurora", stationName: "Aurora Radio", namePronunciation: "Aurora Hotel" };
    expect(renderAnnouncement({ template: "Welcome to {business_name}, home of {station_name}.", business, mode: "spoken" })).toBe(
      "Welcome to Aurora Hotel, home of Aurora Hotel Radio.",
    );
  });

  it("handles non-Latin names", () => {
    const business: BrandingNames = { name: "Смарагд", stationName: "Смарагд Радио", namePronunciation: "Сма-рагд" };
    expect(renderAnnouncement({ template: "Добре дошли в {business_name}. Слушате {station_name}.", business, mode: "spoken" })).toBe(
      "Добре дошли в Сма-рагд. Слушате Сма-рагд Радио.",
    );
  });

  it("accepts placeholder spacing and case variations", () => {
    expect(renderAnnouncement({ template: "This is { Station_Name }.", business: AURORA, mode: "display" })).toBe("This is Aurora FM.");
  });

  it("treats blank pronunciations as absent and trims names", () => {
    const business: BrandingNames = { name: " Bar Nine ", stationName: " Nine FM ", namePronunciation: "  ", stationNamePronunciation: "" };
    expect(renderAnnouncement({ template: "{business_name} / {station_name}", business, mode: "spoken" })).toBe("Bar Nine / Nine FM");
  });

  it("throws TemplateError for wording that fails validation", () => {
    expect(() => renderAnnouncement({ template: "Welcome to {venue}.", business: AURORA, mode: "display" })).toThrow(TemplateError);
    expect(() => renderAnnouncement({ template: "   ", business: AURORA, mode: "spoken" })).toThrow(TemplateError);
  });

  it("renderAnnouncementWording returns null spokenText when it equals the display text", () => {
    expect(renderAnnouncementWording("Welcome to {business_name}.", EMERALD)).toEqual({
      text: "Welcome to EmeraldBar.",
      spokenText: "Welcome to Emerald Bar.",
    });
    expect(renderAnnouncementWording("Welcome to {business_name}.", AURORA)).toEqual({ text: "Welcome to Hotel Aurora.", spokenText: null });
  });

  it("spokenBrandingNames exposes both spoken names", () => {
    expect(spokenBrandingNames(EMERALD)).toEqual({ businessName: "Emerald Bar", stationName: "Emerald Bar Radio" });
  });
});

describe("validateTemplateText", () => {
  it("accepts known placeholders and plain text", () => {
    expect(validateTemplateText("Welcome to {business_name}, this is {station_name}. {station_name}!")).toEqual({
      ok: true,
      placeholders: ["business_name", "station_name"],
    });
    expect(validateTemplateText("Last orders at eleven.")).toEqual({ ok: true, placeholders: [] });
  });

  it("rejects unknown placeholders and names them", () => {
    const result = validateTemplateText("Welcome to {venue_name} and {city}. {venue_name}!");
    expect(result).toMatchObject({ ok: false, unknownPlaceholders: ["{venue_name}", "{city}"] });
    if (!result.ok) {
      expect(result.reason).toBe("Unknown placeholders {venue_name}, {city}. Use {business_name} or {station_name}.");
    }
    expect(validateTemplateText("Hi {}")).toMatchObject({ ok: false, unknownPlaceholders: ["{}"] });
  });

  it("rejects stray braces and blank wording", () => {
    expect(validateTemplateText("Welcome to {business_name")).toMatchObject({ ok: false, unknownPlaceholders: [] });
    expect(validateTemplateText("Prices } here")).toMatchObject({ ok: false });
    expect(validateTemplateText("  \n ")).toEqual({ ok: false, reason: "Enter the announcement wording.", unknownPlaceholders: [] });
  });
});

describe("placement helpers", () => {
  it("labels and describes placements", () => {
    expect(placementLabel("welcome")).toBe("Welcome");
    expect(placementLabel("rotation")).toBe("Between songs");
    expect(placementLabel("both")).toBe("Welcome and between songs");
    expect(placementDescription("welcome")).toBe("Plays once when the radio is started.");
    expect(placementDescription("rotation", 4)).toBe("Plays between songs, after every 4 tracks.");
    expect(placementDescription("rotation", 1)).toBe("Plays between songs, after every track.");
    expect(placementDescription("both")).toBe("Plays when the radio is started and between songs.");
    expect(ANNOUNCEMENT_PLACEMENT_OPTIONS.map((option) => option.value)).toEqual(["welcome", "rotation", "both"]);
  });
});
