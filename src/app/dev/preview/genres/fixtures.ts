/**
 * Fixture catalogue for the development previews of screens 05 and 08 (/dev/preview/music,
 * /dev/preview/genres): the example genres, venues and tracks of the design pack. Covers are null, so
 * the real default artwork (defaultGenreArtwork(slug)) is shown. Never used outside /dev.
 */
import type { AdminGenreItem, BusinessOption, GenreOption } from "@/components/admin/catalog/types";

export const PREVIEW_GENRE_IDS = {
  house: "0f5b2d7e-1a2b-4c3d-8e4f-000000000001",
  deepHouse: "0f5b2d7e-1a2b-4c3d-8e4f-000000000002",
  lounge: "0f5b2d7e-1a2b-4c3d-8e4f-000000000003",
  jazz: "0f5b2d7e-1a2b-4c3d-8e4f-000000000004",
  balkanHits: "0f5b2d7e-1a2b-4c3d-8e4f-000000000005",
  chillout: "0f5b2d7e-1a2b-4c3d-8e4f-000000000006",
} as const;

export const PREVIEW_BUSINESS_IDS = {
  emeraldBar: "5a1c9e20-7b3d-4f1a-9c2e-000000000001",
  hotelAurora: "5a1c9e20-7b3d-4f1a-9c2e-000000000002",
  cafeCentral: "5a1c9e20-7b3d-4f1a-9c2e-000000000003",
  restaurantOlive: "5a1c9e20-7b3d-4f1a-9c2e-000000000004",
} as const;

export const PREVIEW_BUSINESSES: readonly BusinessOption[] = [
  { id: PREVIEW_BUSINESS_IDS.cafeCentral, name: "Café Central", isActive: true },
  { id: PREVIEW_BUSINESS_IDS.emeraldBar, name: "EmeraldBar", isActive: true },
  { id: PREVIEW_BUSINESS_IDS.hotelAurora, name: "Hotel Aurora", isActive: true },
  { id: PREVIEW_BUSINESS_IDS.restaurantOlive, name: "Restaurant Olive", isActive: false },
];

function genre(
  id: string,
  slug: string,
  name: string,
  description: string,
  sortOrder: number,
  counts: { playable: number; total: number },
  extra: Partial<AdminGenreItem> = {},
): AdminGenreItem {
  return {
    id,
    name,
    slug,
    description,
    sortOrder,
    isEnabled: true,
    availableToAll: true,
    playableCount: counts.playable,
    totalCount: counts.total,
    accessBusinessIds: [],
    coverPath: null,
    coverUrl: null,
    ...extra,
  };
}

export const PREVIEW_GENRES: readonly AdminGenreItem[] = [
  genre(PREVIEW_GENRE_IDS.house, "house", "House", "Uplifting, rhythmic, timeless.", 1, { playable: 2, total: 2 }),
  genre(PREVIEW_GENRE_IDS.deepHouse, "deep-house", "Deep House", "Deeper moods for longer evenings.", 2, { playable: 2, total: 2 }),
  genre(PREVIEW_GENRE_IDS.lounge, "lounge", "Lounge", "Stylish, relaxed, sophisticated.", 3, { playable: 1, total: 2 }),
  genre(PREVIEW_GENRE_IDS.jazz, "jazz", "Jazz", "Classic vibes, modern spaces.", 4, { playable: 1, total: 1 }, {
    availableToAll: false,
    accessBusinessIds: [PREVIEW_BUSINESS_IDS.emeraldBar, PREVIEW_BUSINESS_IDS.hotelAurora],
  }),
  genre(PREVIEW_GENRE_IDS.balkanHits, "balkan-hits", "Balkan Hits", "Modern Balkan sounds for great energy.", 5, { playable: 1, total: 1 }),
  genre(PREVIEW_GENRE_IDS.chillout, "chillout", "Chillout", "Laid-back sounds for any time.", 6, { playable: 0, total: 1 }),
];

export function toGenreOptions(genres: readonly AdminGenreItem[]): GenreOption[] {
  return genres.map((item) => ({ id: item.id, name: item.name, slug: item.slug, isEnabled: item.isEnabled, coverUrl: item.coverUrl }));
}
