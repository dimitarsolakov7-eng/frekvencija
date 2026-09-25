import type { Route } from "next";
import { SlidersHorizontal } from "lucide-react";
import { ButtonLink, Checkbox } from "@/components/ui";
import type { GenreAccessOption } from "@/lib/data/admin/businesses";

export interface GenreAccessTilesProps {
  genres: readonly GenreAccessOption[];
  /**
   * Ids shown ticked instead of the saved assignment: the starting ticks (e.g. an echo after a failed
   * save), or with `onCheckedChange` the controlled selection.
   */
  checkedIds?: ReadonlySet<string> | null;
  /** Makes the tiles controlled by `checkedIds`: called when the admin ticks or unticks a genre. */
  onCheckedChange?: (genreId: string, checked: boolean) => void;
  /** "/admin/genres" */
  genresHref: string;
  /** Heading id, so the fieldset can be labelled by the visible heading. */
  headingId: string;
  description?: string;
}

/**
 * Genre access as tile checkboxes (screen 06). Exclusive genres are tickable (name="genreIds");
 * genres available to every venue are shown ticked and locked ("All venues"); disabled genres are
 * left out (they are hidden from every venue). `shownGenreIds` tells the server which tiles were
 * offered, so a genre that changed meanwhile is never cleared by accident.
 */
export function GenreAccessTiles({ genres, checkedIds, onCheckedChange, genresHref, headingId, description }: GenreAccessTilesProps) {
  const enabled = genres.filter((genre) => genre.isEnabled);
  const disabledCount = genres.length - enabled.length;

  return (
    <fieldset aria-labelledby={headingId} className="grid gap-3">
      <div className="grid gap-1">
        <h3 id={headingId} className="text-lg font-semibold text-fg">
          Genre access
        </h3>
        <p className="text-sm text-fg-muted">{description ?? "Choose which genres this business can access on their station."}</p>
      </div>

      {enabled.length === 0 ? (
        <p className="rounded-control border border-dashed border-border-strong p-3 text-sm text-fg-muted">
          There are no enabled genres yet. Create genres and add music to them first.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 @xs:grid-cols-2 @md:grid-cols-3">
          {enabled.map((genre) =>
            genre.editable ? (
              <div key={genre.id}>
                <input type="hidden" name="shownGenreIds" value={genre.id} />
                {onCheckedChange ? (
                  <Checkbox
                    variant="tile"
                    name="genreIds"
                    value={genre.id}
                    checked={checkedIds ? checkedIds.has(genre.id) : genre.assigned}
                    onChange={(event) => onCheckedChange(genre.id, event.currentTarget.checked)}
                    label={genre.name}
                    className="h-full"
                  />
                ) : (
                  <Checkbox
                    variant="tile"
                    name="genreIds"
                    value={genre.id}
                    defaultChecked={checkedIds ? checkedIds.has(genre.id) : genre.assigned}
                    label={genre.name}
                    className="h-full"
                  />
                )}
              </div>
            ) : (
              <Checkbox
                key={genre.id}
                variant="tile"
                checked
                disabled
                readOnly
                label={genre.name}
                description="All venues"
                className="h-full [&_p]:text-xs"
              />
            ),
          )}
        </div>
      )}

      {disabledCount > 0 && (
        <p className="text-xs text-fg-muted">
          {disabledCount === 1 ? "1 disabled genre is" : `${disabledCount} disabled genres are`} hidden here; disabled genres
          play nowhere until they are enabled again.
        </p>
      )}

      <ButtonLink
        href={genresHref as Route}
        variant="secondary"
        fullWidth
        icon={<SlidersHorizontal aria-hidden="true" />}
      >
        Manage genres
      </ButtonLink>
    </fieldset>
  );
}
