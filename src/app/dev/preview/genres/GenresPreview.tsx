"use client";

import { GenreManager } from "@/components/admin/catalog/GenreManager";
import type { AdminGenreItem, BusinessOption } from "@/components/admin/catalog/types";
import { PREVIEW_GENRE_ACTIONS, PREVIEW_SERVICES } from "./preview-services";

export interface GenresPreviewProps {
  genres: AdminGenreItem[];
  businesses: BusinessOption[];
}

/** The real genres screen with fixture data, no-op actions and simulated cover uploads. */
export function GenresPreview({ genres, businesses }: GenresPreviewProps) {
  return (
    <GenreManager
      genres={genres}
      businesses={businesses}
      actions={PREVIEW_GENRE_ACTIONS}
      services={PREVIEW_SERVICES}
      musicPath="/dev/preview/music"
      businessesPath="/dev/preview/genres"
    />
  );
}
