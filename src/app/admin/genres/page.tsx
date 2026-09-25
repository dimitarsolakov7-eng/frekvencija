import type { Metadata } from "next";
import { GenreManager } from "@/components/admin/catalog/GenreManager";
import type { GenreActions } from "@/components/admin/catalog/services";
import type { GenreCatalog } from "@/components/admin/catalog/types";
import { PageHeading } from "@/components/shell/PageHeading";
import { Alert, ButtonLink } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth/session";
import { loadGenreCatalog } from "@/lib/data/admin/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createGenreAction,
  deleteGenreAction,
  removeGenreCoverAction,
  reorderGenresAction,
  saveGenreAction,
  setGenreEnabledAction,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Genres",
};

const GENRE_ACTIONS: GenreActions = {
  createGenre: createGenreAction,
  saveGenre: saveGenreAction,
  deleteGenre: deleteGenreAction,
  setGenreEnabled: setGenreEnabledAction,
  reorderGenres: reorderGenresAction,
  removeGenreCover: removeGenreCoverAction,
};

/**
 * /admin/genres (screen 08). Loads the genres (order, track counts from genre_track_counts, business
 * access, covers signed with the admin's own client) and every business, then hands them to the
 * props-driven <GenreManager>.
 */
export default async function AdminGenresPage() {
  await requireAdminPage("/admin/genres");

  let catalog: GenreCatalog | null = null;
  try {
    catalog = await loadGenreCatalog(await createSupabaseServerClient());
  } catch (error) {
    console.error("[admin/genres] failed to load the genre catalogue", error);
  }

  if (!catalog) {
    return (
      <>
        <PageHeading title="Genres" description="Give every space the right sound." />
        <Alert
          tone="danger"
          title="The genres couldn’t be loaded"
          description="The database didn’t answer as expected. Nothing was changed. Try again in a moment; if it keeps failing, check the Supabase project status."
          action={
            <ButtonLink href="/admin/genres" size="sm" variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </>
    );
  }

  return <GenreManager genres={catalog.genres} businesses={catalog.businesses} actions={GENRE_ACTIONS} />;
}
