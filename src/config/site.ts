/**
 * Central configuration of the public website: section anchors, venue categories (photos and genre
 * suggestions), the headline numbers, example station names and the customer login destination.
 * Copy lives in src/content/site; prices in src/config/plans.ts; photos in src/assets/photos.
 */
import type { StaticImageData } from "next/image";
import { PHOTOS } from "@/assets/photos";
import type { BusinessType } from "@/lib/api/contracts";

/** Section ids on the homepage; links point at them from every page as `/#<id>`. */
export const SECTION_IDS = {
  top: "top",
  manifesto: "manifesto",
  numbers: "numbers",
  howItWorks: "how-it-works",
  features: "features",
  venues: "venues",
  announcements: "announcements",
  plans: "plans",
  faq: "faq",
  trial: "trial",
} as const;

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS];

export const sectionHref = (id: SectionId): `/#${string}` => `/#${id}`;

/** Where "Log in" leads (the existing customer sign-in). */
export const LOGIN_PATH = "/login";

export type VenueTypeKey = "cafe" | "restaurant" | "hotel" | "bar";

export interface VenueTypeConfig {
  key: VenueTypeKey;
  /** The matching `business_type` value of the trial form and the database. */
  businessType: BusinessType;
  photo: StaticImageData;
  /**
   * Genre slugs suggested for this kind of venue. Only genres that exist in the catalogue (or the
   * default list before setup) are shown, so this never promises an unavailable genre.
   */
  recommendedGenres: readonly string[];
}

export const VENUE_TYPES: readonly VenueTypeConfig[] = [
  { key: "cafe", businessType: "cafe", photo: PHOTOS.cafe, recommendedGenres: ["lounge", "chillout", "jazz"] },
  { key: "restaurant", businessType: "restaurant", photo: PHOTOS.restaurant, recommendedGenres: ["jazz", "lounge", "deep-house"] },
  { key: "hotel", businessType: "hotel", photo: PHOTOS.hotel, recommendedGenres: ["lounge", "jazz", "chillout"] },
  { key: "bar", businessType: "bar", photo: PHOTOS.bar, recommendedGenres: ["house", "deep-house", "balkan-hits"] },
];

export const VENUE_TYPE_KEYS = VENUE_TYPES.map((venue) => venue.key) as readonly VenueTypeKey[];

export type StatKey = "venues" | "cities" | "hours" | "ads";

export interface SiteStat {
  key: StatKey;
  value: number;
  /** Shown after the number, e.g. "+". */
  suffix: string;
}

/**
 * ILLUSTRATIVE NUMBERS — invented for the design preview at the owner's request. Replace them with
 * real figures before the website goes live: publishing made-up customer numbers is misleading
 * advertising under consumer-protection law. (`ads: 0` is true: there are no outside ads.)
 */
export const SITE_STATS: readonly SiteStat[] = [
  { key: "venues", value: 140, suffix: "+" },
  { key: "cities", value: 18, suffix: "" },
  { key: "hours", value: 52_000, suffix: "+" },
  { key: "ads", value: 0, suffix: "" },
];

/** "140+" — the venues figure used in the hero. */
export function headlineVenues(stats: readonly SiteStat[] = SITE_STATS): string {
  const venues = stats.find((stat) => stat.key === "venues");
  return venues ? `${venues.value}${venues.suffix}` : "";
}

/** The example venue used across the website (never a real customer). */
export const EXAMPLE_VENUE_NAME = "EmeraldCaffe";

/** Example station names the "your name on air" card cycles through; it ends on the example venue. */
export const EXAMPLE_STATION_NAMES: readonly string[] = ["Hotel Aurora", "Bistro Lipa", EXAMPLE_VENUE_NAME];

/**
 * Social profiles shown in the footer. Only verified, real profiles belong here; the list is empty
 * until the owner adds them.
 */
export const SOCIAL_LINKS: readonly { label: string; href: string }[] = [];
