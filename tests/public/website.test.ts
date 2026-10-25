/**
 * Pure pieces of the public website: the language helpers and the /lang route, the bilingual copy's
 * consistency, the station-name preview, the pricing gate and the venue configuration.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as switchLanguage } from "@/app/lang/[locale]/route";
import { preferredGenreLabel } from "@/components/admin/businesses/access-request-rules";
import { genreDescription } from "@/components/public/site/GenreList";
import { DEMO_AUDIO, hasDemoAudio } from "@/config/demo-audio";
import { PLANS, PRICING_PUBLISHED, formatPlanPrice, publishedPlans } from "@/config/plans";
import { HERO_PHOTOS, VENUE_TYPES, VENUE_TYPE_KEYS } from "@/config/site";
import { getSiteCopy } from "@/content/site";
import { previewStationName, suggestStationName } from "@/lib/brand/station-name";
import { LOCALES, LOCALE_COOKIE, fill, isLocale, otherLocale, parseLocale, safeReturnPath } from "@/lib/i18n/locale";
import { GENRE_RECOMMENDATION } from "@/lib/public/trial-request";

describe("locale helpers", () => {
  it("parses known languages and falls back to Macedonian", () => {
    expect(LOCALES).toEqual(["mk", "en"]);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale(undefined)).toBe("mk");
    expect(parseLocale("fr")).toBe("mk");
    expect(otherLocale("mk")).toBe("en");
  });

  it("only returns to same-origin paths", () => {
    expect(safeReturnPath("/privacy")).toBe("/privacy");
    expect(safeReturnPath("/#trial")).toBe("/#trial");
    expect(safeReturnPath("/request-access?x=1")).toBe("/request-access?x=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "privacy", "", null, "/a b", `/${"x".repeat(3000)}`]) {
      expect(safeReturnPath(bad)).toBe("/");
    }
  });

  it("fills placeholders and leaves unknown ones alone", () => {
    expect(fill("Го слушате {name} Radio.", { name: "EmeraldCaffe" })).toBe("Го слушате EmeraldCaffe Radio.");
    expect(fill("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });
});

describe("/lang/<locale> route", () => {
  const call = (locale: string, next?: string) =>
    switchLanguage(new NextRequest(`http://localhost:3000/lang/${locale}${next ? `?next=${encodeURIComponent(next)}` : ""}`), {
      params: Promise.resolve({ locale }),
    });

  it("remembers the language in a cookie and sends the visitor back", async () => {
    const response = await call("en", "/privacy");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/privacy");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${LOCALE_COOKIE}=en`);
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Path=/");
  });

  it("ignores unknown languages and unsafe return paths", async () => {
    const unknown = await call("de", "/terms");
    expect(unknown.headers.get("set-cookie")).toBeNull();
    expect(unknown.headers.get("location")).toBe("http://localhost:3000/terms");
    const unsafe = await call("mk", "https://evil.example/phish");
    expect(unsafe.headers.get("location")).toBe("http://localhost:3000/");
  });
});

describe("bilingual copy", () => {
  const mk = getSiteCopy("mk");
  const en = getSiteCopy("en");

  it("keeps both languages structurally identical where the page relies on it", () => {
    expect(mk.locale).toBe("mk");
    expect(en.locale).toBe("en");
    expect(mk.personalizer.examples.map((example) => example.key)).toEqual(en.personalizer.examples.map((example) => example.key));
    expect(mk.announcements.examples.map((example) => example.key)).toEqual(["identity", "offer", "event"]);
    expect(mk.benefits.items).toHaveLength(4);
    expect(en.benefits.items).toHaveLength(4);
    expect(mk.howItWorks.steps).toHaveLength(4);
    expect(mk.announcements.sequence.map((step) => step.kind)).toEqual(["music", "voice", "music", "voice"]);
    expect(mk.faq.items.length).toBeGreaterThanOrEqual(10);
    expect(en.faq.items).toHaveLength(mk.faq.items.length);
    expect(Object.keys(mk.venues.items).sort()).toEqual([...VENUE_TYPE_KEYS].sort());
  });

  it("uses the {name} placeholder in every announcement example and says three days consistently", () => {
    for (const copy of [mk, en]) {
      for (const example of [...copy.personalizer.examples, ...copy.announcements.examples]) expect(example.text).toContain("{name}");
      expect(copy.trial.form.privacyNote).toContain("{privacy}");
      expect(copy.trial.messages.tooLong).toContain("{max}");
      expect(copy.footer.rights).toContain("{year}");
    }
    expect(en.hero.primaryCta).toBe("Request a 3-Day Free Trial");
    expect(mk.hero.primaryCta).toBe("Побарај 3 дена бесплатно");
    expect(mk.trial.successBody).toBe("Ќе ве контактираме за подготовка и активирање на вашата 3-дневна проба.");
  });

  it("promises no exclusive catalogue and no automatic activation", () => {
    expect(en.faq.items.find((item) => item.question.includes("shared"))?.answer).toMatch(/shared across venues/);
    expect(en.howItWorks.note).toMatch(/does not activate the station instantly/);
    expect(en.trial.activationNote).toMatch(/Nothing is charged automatically/);
  });

  it("describes genres with the website's text, the catalogue's, or a fallback", () => {
    expect(genreDescription({ slug: "House", description: "Owner text" }, mk.genres)).toBe(mk.genres.descriptions.house);
    expect(genreDescription({ slug: "ambient", description: "Owner text" }, mk.genres)).toBe("Owner text");
    expect(genreDescription({ slug: "ambient", description: null }, en.genres)).toBe(en.genres.fallbackDescription);
  });
});

describe("station name preview", () => {
  it("suggests '<venue> Radio' and keeps the preview readable while typing", () => {
    expect(suggestStationName("EmeraldCaffe")).toBe("EmeraldCaffe Radio");
    expect(suggestStationName("Jazz Radio")).toBe("Jazz Radio");
    expect(suggestStationName("")).toBe("");
    expect(previewStationName("", "EmeraldCaffe")).toBe("EmeraldCaffe Radio");
    expect(previewStationName("  Hotel   Aurora ", "EmeraldCaffe")).toBe("Hotel Aurora Radio");
    expect(previewStationName("x".repeat(200), "EmeraldCaffe")).toMatch(/^x+ Radio$/);
  });
});

describe("plans, demo audio and venue configuration", () => {
  it("keeps the draft prices unpublished until approved", () => {
    expect(PRICING_PUBLISHED).toBe(false);
    expect(publishedPlans()).toEqual([]);
    expect(PLANS.map((plan) => plan.monthlyPrice)).toEqual([1490, 2490, 2890]);
    expect(formatPlanPrice(1490, "en")).toBe("1,490 MKD");
    expect(formatPlanPrice(1490, "mk")).toMatch(/^1[.,\s ]?490 MKD$/);
  });

  it("has no demo audio configured yet, so the console shows its honest state", () => {
    expect(hasDemoAudio()).toBe(false);
    expect(Object.values(DEMO_AUDIO.announcements).every((clip) => clip === null)).toBe(true);
  });

  it("maps every venue type to a business type and existing photography", () => {
    expect(VENUE_TYPES.map((venue) => venue.businessType)).toEqual(["cafe", "restaurant", "hotel", "bar"]);
    for (const venue of VENUE_TYPES) expect(venue.photo.src).toMatch(/^\/brand\//);
    expect(HERO_PHOTOS.length).toBe(4);
  });

  it("labels the stored preferred genre for the admin", () => {
    expect(preferredGenreLabel("House")).toBe("House");
    expect(preferredGenreLabel(GENRE_RECOMMENDATION)).toBe("Wants a recommendation");
    expect(preferredGenreLabel(null)).toBe("Not given");
    expect(preferredGenreLabel("  ")).toBe("Not given");
  });
});
