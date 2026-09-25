import type { Metadata, Route } from "next";
import { MusicLibrary } from "@/components/admin/catalog/MusicLibrary";
import { NO_GENRE, parseTrackListQuery, trackListHref } from "@/components/admin/catalog/track-query";
import type { MusicActions } from "@/components/admin/catalog/services";
import type { GenreOption, TrackPage } from "@/components/admin/catalog/types";
import { PageHeading } from "@/components/shell/PageHeading";
import { Alert, ButtonLink } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth/session";
import { loadGenreOptions, loadTrackPage } from "@/lib/data/admin/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  deleteTrackAction,
  removeTrackAction,
  removeTracksAction,
  restoreTrackAction,
  setTrackActiveAction,
  setTracksActiveAction,
  updateTrackAction,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Music library",
};

const MUSIC_ACTIONS: MusicActions = {
  updateTrack: updateTrackAction,
  setTrackActive: setTrackActiveAction,
  setTracksActive: setTracksActiveAction,
  removeTrack: removeTrackAction,
  removeTracks: removeTracksAction,
  restoreTrack: restoreTrackAction,
  deleteTrack: deleteTrackAction,
};

/**
 * /admin/music (screen 05). Loads the genres (with signed covers) and one page of tracks with the
 * admin's own client, then hands everything to the props-driven <MusicLibrary>. `?genre=<id>` (the
 * genre editor's "Manage tracks") preselects the genre filter.
 */
export default async function AdminMusicPage({ searchParams }: PageProps<"/admin/music">) {
  await requireAdminPage("/admin/music");
  let query = parseTrackListQuery(await searchParams);

  let genres: GenreOption[] | null = null;
  let page: TrackPage | null = null;
  let unknownGenre = false;
  try {
    const supabase = await createSupabaseServerClient();
    genres = await loadGenreOptions(supabase);
    if (query.genre && query.genre !== NO_GENRE && !genres.some((genre) => genre.id === query.genre)) {
      // A link to a genre that has since been deleted: show every genre instead of an empty list.
      query = { ...query, genre: null, page: 1 };
      unknownGenre = true;
    }
    page = await loadTrackPage(supabase, query);
  } catch (error) {
    console.error("[admin/music] failed to load the music catalogue", error);
  }

  if (!genres || !page) {
    return (
      <>
        <PageHeading title="Music library" description="One catalogue. Every venue." />
        <Alert
          tone="danger"
          title="The music library couldn’t be loaded"
          description="The database didn’t answer as expected. Nothing was changed. Try again in a moment; if it keeps failing, check the Supabase project status."
          action={
            <ButtonLink href={trackListHref(query) as Route} size="sm" variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </>
    );
  }

  return <MusicLibrary query={query} genres={genres} page={page} unknownGenre={unknownGenre} actions={MUSIC_ACTIONS} />;
}
