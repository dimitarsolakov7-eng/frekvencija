/**
 * Pure pieces of the public website: the language helpers and the /lang route, the bilingual copy's
 * consistency, the station-name preview, the headline numbers, the pricing gate, the motion boot script and
 * the announcement strip.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as switchLanguage } from "@/app/lang/[locale]/route";
import { PHOTO_SOURCES, PHOTOS } from "@/assets/photos";
import { preferredGenreLabel } from "@/components/admin/businesses/access-request-rules";
import { exampleAt } from "@/components/public/site/Announcements";
import { dialPercent } from "@/components/public/site/FmDial";
import { INTRO_SEEN_KEY, MOTION_BOOT_SCRIPT, MOTION_READY_CLASS } from "@/components/public/site/motion/boot";
import { siteNavLinks } from "@/components/public/site/nav";
import { PLANS, PRICING_PUBLISHED, formatPlanPrice, publishedPlans } from "@/config/plans";
import { EXAMPLE_STATION_NAMES, EXAMPLE_VENUE_NAME, siteStats, TRIAL_DAYS, VENUE_TYPES } from "@/config/site";
import { getSiteCopy, highlightRuns } from "@/content/site";
import { previewStationName, suggestStationName } from "@/lib/brand/station-name";
import { LOCALES, LOCALE_COOKIE, fill, isLocale, otherLocale, parseLocale, safeReturnPath } from "@/lib/i18n/locale";
import { formatStatNumber } from "@/lib/public/format";
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
    expect(mk.hero.titleLines).toHaveLength(3);
    expect(mk.announcements.examples.map((example) => example.key)).toEqual(["identity", "offer", "event"]);
    expect(en.announcements.examples.map((example) => example.key)).toEqual(["identity", "offer", "event"]);
    expect(mk.howItWorks.steps).toHaveLength(4);
    expect(en.howItWorks.steps).toHaveLength(4);
    expect(mk.features.hours).toHaveLength(en.features.hours.length);
    expect(mk.faq.items.length).toBeGreaterThanOrEqual(10);
    expect(en.faq.items).toHaveLength(mk.faq.items.length);
    expect(Object.keys(mk.venues.items).sort()).toEqual(VENUE_TYPES.map((venue) => venue.key).sort());
    expect(Object.keys(mk.trial.form.venueTypes).sort()).toEqual(VENUE_TYPES.map((venue) => venue.key).sort());
  });

  it("uses the placeholders the components fill, and says three days consistently", () => {
    for (const copy of [mk, en]) {
      for (const example of copy.announcements.examples) expect(example.text).toContain("{name}");
      expect(copy.trial.form.privacyNote).toContain("{privacy}");
      expect(copy.trial.messages.tooLong).toContain("{max}");
      expect(copy.footer.rights).toContain("{year}");
      expect(highlightRuns(copy.manifesto.text).filter((run) => run.highlight)).toHaveLength(2);
    }
    expect(TRIAL_DAYS).toBe(3);
    expect(mk.nav.trialCta).toBe("Пробај 3 дена бесплатно");
    expect(en.nav.trialCta).toBe("Try it free for 3 days");
    expect(mk.trial.successBody).toBe("Ќе ве контактираме за подготовка и активирање на вашата 3-дневна проба.");
    expect(mk.common.quotes).toEqual({ open: "„", close: "“" });
  });

  it("promises no exclusive catalogue and no automatic activation", () => {
    expect(en.faq.items.find((item) => item.question.includes("shared"))?.answer).toMatch(/one catalogue for all venues/);
    expect(en.howItWorks.note).toMatch(/start when we activate your access/);
    expect(en.trial.activationNote).toMatch(/no automatic charges/);
  });

  it("splits the manifesto into plain and highlighted runs", () => {
    expect(highlightRuns("One *two* three *four*")).toEqual([
      { text: "One ", highlight: false },
      { text: "two", highlight: true },
      { text: " three ", highlight: false },
      { text: "four", highlight: true },
    ]);
  });
});

describe("station name preview", () => {
  it("suggests '<venue> Radio' and keeps the preview readable while typing", () => {
    expect(suggestStationName("EmeraldCaffe")).toBe("EmeraldCaffe Radio");
    expect(suggestStationName("Jazz Radio")).toBe("Jazz Radio");
    expect(previewStationName("", EXAMPLE_VENUE_NAME)).toBe("EmeraldCaffe Radio");
    expect(previewStationName("  Hotel   Aurora ", EXAMPLE_VENUE_NAME)).toBe("Hotel Aurora Radio");
    expect(previewStationName("x".repeat(200), EXAMPLE_VENUE_NAME)).toMatch(/^x+ Radio$/);
    expect(EXAMPLE_STATION_NAMES.at(-1)).toBe(EXAMPLE_VENUE_NAME);
  });
});

describe("numbers, plans and configuration", () => {
  it("formats the headline numbers per language, identically on server and client", () => {
    expect(formatStatNumber(52_000, "mk")).toBe("52.000");
    expect(formatStatNumber(52_000, "en")).toBe("52,000");
    expect(formatStatNumber(140.4, "en")).toBe("140");
    expect(formatStatNumber(-3, "mk")).toBe("0");
  });

  it("states only facts in the Numbers chapter, and drops the genre figure for an empty catalogue", () => {
    expect(siteStats(7).map((stat) => [stat.key, stat.value])).toEqual([
      ["trialDays", TRIAL_DAYS],
      ["genres", 7],
      ["station", 1],
      ["ads", 0],
    ]);
    expect(siteStats(0).map((stat) => stat.key)).toEqual(["trialDays", "station", "ads"]);
  });

  it("keeps the draft prices unpublished until approved", () => {
    expect(PRICING_PUBLISHED).toBe(false);
    expect(publishedPlans()).toEqual([]);
    expect(PLANS.map((plan) => plan.monthlyPrice)).toEqual([1490, 2490, 2890]);
    expect(formatPlanPrice(1490, "en")).toBe("1,490 MKD");
  });

  it("maps every venue type to a business type and a photo, with a source for every photo", () => {
    expect(VENUE_TYPES.map((venue) => venue.businessType)).toEqual(["cafe", "restaurant", "hotel", "bar"]);
    for (const venue of VENUE_TYPES) expect(venue.photo).toBeTruthy();
    expect(Object.keys(PHOTO_SOURCES).sort()).toEqual(Object.keys(PHOTOS).sort());
    for (const source of Object.values(PHOTO_SOURCES)) expect(source).toMatch(/^https:\/\/unsplash\.com\/photos\/[\w-]{11}$/);
  });

  it("links the same five chapters everywhere", () => {
    expect(siteNavLinks(getSiteCopy("en").nav).map((link) => link.id)).toEqual(["how-it-works", "features", "venues", "plans", "faq"]);
  });

  it("labels the stored preferred genre for the admin", () => {
    expect(preferredGenreLabel("House")).toBe("House");
    expect(preferredGenreLabel(GENRE_RECOMMENDATION)).toBe("Wants a recommendation");
    expect(preferredGenreLabel(null)).toBe("Not given");
  });
});

describe("motion", () => {
  it("boots only without reduced motion, plays the intro once per tab on the homepage, and never strands hidden content", () => {
    expect(MOTION_BOOT_SCRIPT).toContain("prefers-reduced-motion: reduce");
    expect(MOTION_BOOT_SCRIPT).toContain(`sessionStorage.getItem("${INTRO_SEEN_KEY}")`);
    expect(MOTION_BOOT_SCRIPT).toContain('location.pathname==="/"&&!location.hash');
    expect(MOTION_BOOT_SCRIPT).toContain(`classList.contains("${MOTION_READY_CLASS}")`);
    expect(MOTION_BOOT_SCRIPT).toMatch(/d\.classList\.remove\("motion"\);d\.classList\.remove\("intro-on"\)\}\},5000\)/);
    expect(() => new Function(MOTION_BOOT_SCRIPT)).not.toThrow();
  });

  it("places frequencies on the FM dial", () => {
    expect(dialPercent(88)).toBe(0);
    expect(dialPercent(108)).toBe(100);
    expect(dialPercent(101.7)).toBeCloseTo(68.5);
  });

  it("puts the example that was announced last on air as the playhead moves", () => {
    expect(exampleAt(0)).toBe(0);
    expect(exampleAt(0.3)).toBe(0);
    expect(exampleAt(0.6)).toBe(1);
    expect(exampleAt(0.9)).toBe(2);
    expect(exampleAt(1)).toBe(2);
  });
});
