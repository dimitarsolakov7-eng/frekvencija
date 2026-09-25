"use client";

import { MusicLibrary } from "@/components/admin/catalog/MusicLibrary";
import type { TrackListQuery } from "@/components/admin/catalog/track-query";
import type { GenreOption, TrackPage } from "@/components/admin/catalog/types";
import { PREVIEW_MUSIC_ACTIONS, PREVIEW_SERVICES } from "../genres/preview-services";

export interface MusicPreviewProps {
  query: TrackListQuery;
  genres: GenreOption[];
  page: TrackPage;
  unknownGenre: boolean;
}

/** The real music library with fixture data, no-op actions, simulated uploads and demo audio previews. */
export function MusicPreview({ query, genres, page, unknownGenre }: MusicPreviewProps) {
  return (
    <MusicLibrary
      query={query}
      genres={genres}
      page={page}
      unknownGenre={unknownGenre}
      actions={PREVIEW_MUSIC_ACTIONS}
      services={PREVIEW_SERVICES}
      basePath="/dev/preview/music"
      genresPath="/dev/preview/genres"
    />
  );
}
