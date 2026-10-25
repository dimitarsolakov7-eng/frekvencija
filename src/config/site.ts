/**
 * Central configuration of the public website: venue categories (with their photography and genre
 * recommendations), the photo strip, section anchors and the customer login destination. Copy lives
 * in src/content/site; prices in src/config/plans.ts; demo audio in src/config/demo-audio.ts.
 */
import type { BusinessType } from "@/lib/api/contracts";

/** Section ids on the homepage; the header links to them from every page as `/#<id>`. */
export const SECTION_IDS = {
  listen: "listen",
  benefits: "benefits",
  venues: "venues",
  howItWorks: "how-it-works",
  genres: "genres",
  announcements: "announcements",
  trial: "trial",
  plans: "plans",
  faq: "faq",
} as const;

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS];

export const sectionHref = (id: SectionId): `/#${string}` => `/#${id}`;

/** Where "Log in" leads (the existing customer sign-in). */
export const LOGIN_PATH = "/login";

export type VenueTypeKey = "cafe" | "restaurant" | "hotel" | "bar";

export interface VenuePhotoRef {
  /** Path under /public. */
  src: string;
  /** CSS object-position for the crop, e.g. "50% 40%". */
  position?: string;
}

export interface VenueTypeConfig {
  key: VenueTypeKey;
  /** The matching `business_type` value of the trial form and the database. */
  businessType: BusinessType;
  photo: VenuePhotoRef;
  /**
   * Genre slugs suggested for this kind of venue. Only genres that exist in the catalogue (or the
   * default list before setup) are shown, so this never promises an unavailable genre.
   */
  recommendedGenres: readonly string[];
}

/**
 * The four venue categories of the website. The photos are placeholders made from the one approved
 * venue photograph (public/brand): replace them with real photography per category by dropping
 * files into public/photos/ and pointing `photo.src` at them.
 */
export const VENUE_TYPES: readonly VenueTypeConfig[] = [
  {
    key: "cafe",
    businessType: "cafe",
    photo: { src: "/brand/genres/default-02.jpg", position: "50% 45%" },
    recommendedGenres: ["lounge", "chillout", "pop"],
  },
  {
    key: "restaurant",
    businessType: "restaurant",
    photo: { src: "/brand/genres/default-06.jpg", position: "50% 55%" },
    recommendedGenres: ["jazz", "lounge", "deep-house"],
  },
  {
    key: "hotel",
    businessType: "hotel",
    photo: { src: "/brand/genres/default-03.jpg", position: "50% 50%" },
    recommendedGenres: ["lounge", "jazz", "chillout"],
  },
  {
    key: "bar",
    businessType: "bar",
    photo: { src: "/brand/genres/default-05.jpg", position: "50% 50%" },
    recommendedGenres: ["house", "deep-house", "balkan-hits"],
  },
];

export const VENUE_TYPE_KEYS = VENUE_TYPES.map((venue) => venue.key) as readonly VenueTypeKey[];

export function venueTypeConfig(key: VenueTypeKey): VenueTypeConfig {
  return VENUE_TYPES.find((venue) => venue.key === key) ?? VENUE_TYPES[0];
}

/** Hospitality photography under the hero (placeholders from the approved photograph, see above). */
export const HERO_PHOTOS: readonly VenuePhotoRef[] = [
  { src: "/brand/venue-hero.jpg", position: "62% 50%" },
  { src: "/brand/genres/default-07.jpg", position: "50% 50%" },
  { src: "/brand/genres/default-02.jpg", position: "50% 40%" },
  { src: "/brand/genres/default-03.jpg", position: "50% 50%" },
];

/**
 * Social profiles shown in the footer. Only verified, real profiles belong here; the list is empty
 * until the owner adds them (nothing is invented).
 */
export const SOCIAL_LINKS: readonly { label: string; href: string }[] = [];

/** The example venue used across the website (never a real customer). */
export const EXAMPLE_VENUE_NAME = "EmeraldCaffe";
