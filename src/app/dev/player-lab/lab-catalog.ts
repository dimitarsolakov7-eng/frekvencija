/**
 * Player lab catalogue: the demo manifest (supabase/seed/audio/manifest.json) turned into genres
 * with tracks and per-venue announcements, plus the PlayerBootstrap the real venue screens render
 * from. Pure and client-safe; the page builds the catalogue on the server.
 */
import type { AnnouncementPlacement, BusinessType, PlayerBootstrap, PlayerGenre, TrackSummary } from "@/lib/api/contracts";

export interface LabGenre {
  id: string;
  name: string;
  description: string | null;
  tracks: TrackSummary[];
}

export interface LabAnnouncement {
  id: string;
  placement: AnnouncementPlacement;
  durationSeconds: number;
  text: string;
}

export interface LabBusiness {
  key: string;
  name: string;
  stationName: string;
  type: BusinessType;
  announcements: LabAnnouncement[];
}

export interface LabCatalog {
  /** The manifest's own "this is synthetic audio" notice. */
  notice: string;
  genres: LabGenre[];
  businesses: LabBusiness[];
}

/** The subset of manifest entries the lab reads (see scripts/lib/manifest.ts). */
export type LabManifestEntry =
  | { kind: "track"; id: string; title: string; artist: string; durationSeconds: number; genre: string }
  | {
      kind: "announcement";
      id: string;
      durationSeconds: number;
      business: string;
      placement: AnnouncementPlacement;
      text: string;
    };

/** A genre id the fake API does not know: selecting it exercises the "genre unavailable" state. */
export const LAB_MISSING_GENRE_ID = "lab-removed-genre";

/** Display data for the demo genres (mirrors scripts/lib/demo-catalog.ts), in display order. */
const KNOWN_GENRES: readonly { slug: string; name: string; description: string }[] = [
  { slug: "house", name: "House", description: "Four-on-the-floor grooves for busy evenings." },
  { slug: "deep-house", name: "Deep House", description: "Warm late-night house with deeper chords." },
  { slug: "lounge", name: "Lounge", description: "Relaxed background music for dining and conversation." },
  { slug: "jazz", name: "Jazz", description: "Smooth, swinging jazz for lobbies and bars." },
  { slug: "balkan-hits", name: "Balkan Hits", description: "Energetic Balkan party favourites." },
  { slug: "chillout", name: "Chillout", description: "Airy downtempo for quiet hours." },
  // No demo audio on purpose: exercises the "no tracks in this genre" state.
  { slug: "pop", name: "Pop", description: "Familiar, upbeat pop. (No demo tracks: shows the empty state.)" },
];

const KNOWN_BUSINESSES: readonly { key: string; name: string; stationName: string; type: BusinessType }[] = [
  { key: "emeraldbar", name: "EmeraldBar", stationName: "EmeraldBar Radio", type: "bar" },
  { key: "hotel-aurora", name: "Hotel Aurora", stationName: "Hotel Aurora Radio", type: "hotel" },
];

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function buildLabCatalog(notice: string, entries: readonly LabManifestEntry[]): LabCatalog {
  const tracksByGenre = new Map<string, TrackSummary[]>();
  const announcementsByBusiness = new Map<string, LabAnnouncement[]>();

  for (const entry of entries) {
    if (entry.kind === "track") {
      const list = tracksByGenre.get(entry.genre) ?? [];
      list.push({ id: entry.id, title: entry.title, artist: entry.artist, durationSeconds: entry.durationSeconds });
      tracksByGenre.set(entry.genre, list);
    } else {
      const list = announcementsByBusiness.get(entry.business) ?? [];
      list.push({ id: entry.id, placement: entry.placement, durationSeconds: entry.durationSeconds, text: entry.text });
      announcementsByBusiness.set(entry.business, list);
    }
  }

  const known = new Set(KNOWN_GENRES.map((genre) => genre.slug));
  const extraGenreSlugs = [...tracksByGenre.keys()].filter((slug) => !known.has(slug)).sort();
  const genres: LabGenre[] = [
    ...KNOWN_GENRES.map((genre) => ({
      id: genre.slug,
      name: genre.name,
      description: genre.description,
      tracks: tracksByGenre.get(genre.slug) ?? [],
    })),
    ...extraGenreSlugs.map((slug) => ({ id: slug, name: titleCase(slug), description: null, tracks: tracksByGenre.get(slug) ?? [] })),
  ];

  const knownBusinesses = new Set(KNOWN_BUSINESSES.map((business) => business.key));
  const extraBusinessKeys = [...announcementsByBusiness.keys()].filter((key) => !knownBusinesses.has(key)).sort();
  const businesses: LabBusiness[] = [
    ...KNOWN_BUSINESSES.map((business) => ({ ...business, announcements: announcementsByBusiness.get(business.key) ?? [] })),
    ...extraBusinessKeys.map((key) => ({
      key,
      name: titleCase(key),
      stationName: `${titleCase(key)} Radio`,
      type: "other" as const,
      announcements: announcementsByBusiness.get(key) ?? [],
    })),
  ];

  return { notice, genres, businesses };
}

/** Genre cards for the lab: the catalogue plus one "removed" genre the fake API answers 404 for. */
export function labGenreCards(catalog: LabCatalog): PlayerGenre[] {
  return [
    ...catalog.genres.map((genre) => ({
      id: genre.id,
      name: genre.name,
      slug: genre.id,
      description: genre.description,
      trackCount: genre.tracks.length,
      // No uploaded covers in the lab: the screens show the default genre artwork.
      coverUrl: null,
    })),
    {
      id: LAB_MISSING_GENRE_ID,
      name: "Removed genre",
      slug: LAB_MISSING_GENRE_ID,
      description: "Listed here but unknown to the API (404): shows the “genre unavailable” error.",
      trackCount: 1,
      coverUrl: null,
    },
  ];
}

export function firstPlayableGenreId(catalog: LabCatalog): string | null {
  return catalog.genres.find((genre) => genre.tracks.length > 0)?.id ?? null;
}

export interface LabBootstrapOptions {
  businessKey: string;
  everyNTracks: number;
  /** 0.10–1.00 gain for announcements. Default 1. */
  announcementVolume?: number;
}

/**
 * The PlayerBootstrap the real venue screens (RadioScreen, player bar, help) render from in the
 * lab: the chosen demo venue, the catalogue's genre cards and that venue's own announcements with
 * their wording. No logo, no uploaded covers and no owner contact details in the lab.
 */
export function buildLabBootstrap(catalog: LabCatalog, options: LabBootstrapOptions): PlayerBootstrap {
  const business = catalog.businesses.find((item) => item.key === options.businessKey) ?? catalog.businesses[0] ?? null;
  const announcements = (business?.announcements ?? []).map(({ id, placement, durationSeconds, text }) => ({
    id,
    placement,
    durationSeconds,
    text,
  }));
  return {
    userId: "lab-user",
    business: {
      id: `lab-${business?.key ?? "venue"}`,
      name: business?.name ?? "Lab venue",
      stationName: business?.stationName ?? "Lab Radio",
      type: business?.type ?? "other",
      logoUrl: null,
      language: "en",
      announcementEveryNTracks: options.everyNTracks,
      announcementVolume: options.announcementVolume ?? 1,
    },
    genres: labGenreCards(catalog),
    preferences: { genreId: firstPlayableGenreId(catalog), volume: 0.8, muted: false },
    announcementCounts: {
      welcome: announcements.filter((item) => item.placement === "welcome" || item.placement === "both").length,
      rotation: announcements.filter((item) => item.placement === "rotation" || item.placement === "both").length,
    },
    announcements,
    support: { email: null, phone: null },
  };
}
