import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_TEXT_MAX_LENGTH,
  announcementTextCounter,
  brandingWithPronunciation,
  buildSpokenWording,
  PRONUNCIATION_MAX_LENGTH,
  SPOKEN_TEXT_MAX_LENGTH,
  wordingProblems,
} from "@/lib/announcements/spoken";
import type { BrandingNames } from "@/lib/announcements/templates";

const emeraldBar: BrandingNames = {
  name: "EmeraldBar",
  stationName: "EmeraldBar Radio",
  namePronunciation: "Emerald Bar",
  stationNamePronunciation: null,
};

describe("announcementTextCounter", () => {
  it("counts the stored characters and formats n/500", () => {
    const counter = announcementTextCounter("You're listening to EmeraldBar Radio.");
    expect(counter).toEqual({ count: 37, max: 500, over: false, label: "37/500" });
  });

  it("ignores surrounding whitespace, like the server's validation", () => {
    expect(announcementTextCounter("  Last orders.  \n").count).toBe(12);
    expect(announcementTextCounter("   ").label).toBe("0/500");
  });

  it("counts placeholders as the names they are replaced with", () => {
    expect(announcementTextCounter("This is {station_name}.", emeraldBar).count).toBe("This is EmeraldBar Radio.".length);
    // Without the venue it can only count what was typed.
    expect(announcementTextCounter("This is {station_name}.").count).toBe("This is {station_name}.".length);
  });

  it("counts invalid wording as typed", () => {
    expect(announcementTextCounter("Hi {guest}", emeraldBar).count).toBe(10);
  });

  it("flags text over the database limit", () => {
    const counter = announcementTextCounter("a".repeat(ANNOUNCEMENT_TEXT_MAX_LENGTH + 1));
    expect(counter.over).toBe(true);
    expect(counter.label).toBe("501/500");
    expect(announcementTextCounter("a".repeat(ANNOUNCEMENT_TEXT_MAX_LENGTH)).over).toBe(false);
  });
});

describe("brandingWithPronunciation", () => {
  it("uses the typed spelling for the venue name and never changes the written names", () => {
    expect(brandingWithPronunciation(emeraldBar, "Emmerald Bahr")).toEqual({
      name: "EmeraldBar",
      stationName: "EmeraldBar Radio",
      namePronunciation: "Emmerald Bahr",
      stationNamePronunciation: null,
    });
  });

  it("keeps the saved station pronunciation only while the saved name spelling is shown", () => {
    const withStation = { ...emeraldBar, stationNamePronunciation: "Emerald Bar Radyo" };
    expect(brandingWithPronunciation(withStation, " Emerald Bar ").stationNamePronunciation).toBe("Emerald Bar Radyo");
    expect(brandingWithPronunciation(withStation, "Emmerald Bar").stationNamePronunciation).toBeNull();
    expect(brandingWithPronunciation(withStation, "").stationNamePronunciation).toBeNull();
  });

  it("treats a blank spelling as the written name", () => {
    expect(brandingWithPronunciation(emeraldBar, "   ").namePronunciation).toBeNull();
    expect(brandingWithPronunciation({ ...emeraldBar, namePronunciation: null }, null).stationNamePronunciation).toBeNull();
  });
});

describe("buildSpokenWording", () => {
  it("respells the station and venue names in the text for the voice", () => {
    const wording = buildSpokenWording({ text: "You’re listening to EmeraldBar Radio.", business: emeraldBar, pronunciation: "Emerald Bar" });
    expect(wording).toEqual({
      ok: true,
      text: "You’re listening to EmeraldBar Radio.",
      spoken: "You’re listening to Emerald Bar Radio.",
      spokenText: "You’re listening to Emerald Bar Radio.",
    });
  });

  it("uses the spelling typed in the editor, not the venue's saved one", () => {
    const wording = buildSpokenWording({ text: "Welcome to EmeraldBar.", business: emeraldBar, pronunciation: "Emmerald Bahr" });
    expect(wording).toMatchObject({ ok: true, spoken: "Welcome to Emmerald Bahr." });
  });

  it("matches names case-insensitively as whole words only", () => {
    const wording = buildSpokenWording({
      text: "WELCOME TO EMERALDBAR. The EmeraldBarista says hi.",
      business: emeraldBar,
      pronunciation: "Emerald Bar",
    });
    expect(wording).toMatchObject({ ok: true, spoken: "WELCOME TO Emerald Bar. The EmeraldBarista says hi." });
  });

  it("fills placeholders with the written names in the text and the spoken names for the voice", () => {
    const wording = buildSpokenWording({ text: "Welcome to {business_name}. This is {station_name}.", business: emeraldBar, pronunciation: "Emerald Bar" });
    expect(wording).toEqual({
      ok: true,
      text: "Welcome to EmeraldBar. This is EmeraldBar Radio.",
      spoken: "Welcome to Emerald Bar. This is Emerald Bar Radio.",
      spokenText: "Welcome to Emerald Bar. This is Emerald Bar Radio.",
    });
  });

  it("stores no spoken wording when nothing needs respelling", () => {
    expect(buildSpokenWording({ text: "Last orders, please.", business: emeraldBar, pronunciation: "Emerald Bar" })).toMatchObject({
      ok: true,
      spokenText: null,
    });
    // A cleared spelling means "say the name as written".
    expect(buildSpokenWording({ text: "Welcome to EmeraldBar.", business: emeraldBar, pronunciation: "" })).toMatchObject({
      ok: true,
      spoken: "Welcome to EmeraldBar.",
      spokenText: null,
    });
  });

  it("reports empty and invalid wording", () => {
    expect(buildSpokenWording({ text: "  ", business: emeraldBar, pronunciation: "x" })).toEqual({ ok: false, reason: null });
    const invalid = buildSpokenWording({ text: "Hi {guest}", business: emeraldBar, pronunciation: "x" });
    expect(invalid.ok).toBe(false);
    expect(invalid.ok ? "" : invalid.reason).toContain("{guest}");
  });

  it("does not modify the business object it was given", () => {
    const business = { ...emeraldBar };
    buildSpokenWording({ text: "Welcome to EmeraldBar.", business, pronunciation: "Emmerald" });
    expect(business).toEqual(emeraldBar);
  });
});

describe("wordingProblems", () => {
  it("asks for text when there is none and passes valid wording", () => {
    expect(wordingProblems({ ok: false, reason: null })).toEqual({ text: "Enter the announcement text." });
    expect(wordingProblems(buildSpokenWording({ text: "Hello.", business: emeraldBar, pronunciation: "" }))).toEqual({});
  });

  it("reports text and spoken wording over the database limits", () => {
    const long = buildSpokenWording({ text: "EmeraldBar ".repeat(60), business: emeraldBar, pronunciation: "E".repeat(30) });
    const problems = wordingProblems(long, "E".repeat(30));
    expect(problems.text).toContain(`${ANNOUNCEMENT_TEXT_MAX_LENGTH} characters`);
    expect(problems.pronunciation).toContain(`${SPOKEN_TEXT_MAX_LENGTH} are allowed`);
  });

  it("reports an over-long pronunciation spelling", () => {
    const wording = buildSpokenWording({ text: "Hello.", business: emeraldBar, pronunciation: "" });
    expect(wordingProblems(wording, "x".repeat(PRONUNCIATION_MAX_LENGTH + 1)).pronunciation).toContain(`${PRONUNCIATION_MAX_LENGTH}`);
  });
});
