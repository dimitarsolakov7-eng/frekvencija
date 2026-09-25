import type { ReactNode } from "react";
import type { Route } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui";
import { describePageWindow, formatCount, formatTrackCount, MUSIC_PATH, trackListHref, type TrackListQuery } from "./track-query";
import type { TrackPage } from "./types";

export interface TrackPaginationProps {
  query: TrackListQuery;
  page: TrackPage;
  /** Route of the list (a development preview passes its own). */
  basePath?: string;
  /** Extra controls next to the count (e.g. the sort order). */
  extra?: ReactNode;
}

/**
 * Count footer ("6 tracks", or "Showing 51–100 of 312") with Previous/Next links when paged. Paging
 * keeps the library mounted (a track with unsaved edits stays in the editor, uploads keep running),
 * so its links opt out of the unsaved-changes guard (data-skip-unsaved-guard).
 */
export function TrackPagination({ query, page, basePath = MUSIC_PATH, extra }: TrackPaginationProps) {
  const paged = page.pageCount > 1;
  const summary = paged ? describePageWindow(page.page, page.pageSize, page.tracks.length, page.total) : formatTrackCount(page.total);
  const hasPrevious = page.page > 1;
  const hasNext = page.page < page.pageCount;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-fg-muted" aria-live="polite">
          {summary}
        </p>
        {extra}
      </div>
      {paged && (
        <nav aria-label="Pages" data-skip-unsaved-guard="" className="flex items-center gap-2">
          {hasPrevious ? (
            <ButtonLink
              href={trackListHref(query, { page: Math.min(page.page - 1, page.pageCount) }, basePath) as Route}
              scroll={false}
              variant="secondary"
              size="sm"
              rel="prev"
              icon={<ChevronLeft aria-hidden="true" />}
            >
              Previous
            </ButtonLink>
          ) : (
            <Button variant="secondary" size="sm" disabled icon={<ChevronLeft aria-hidden="true" />}>
              Previous
            </Button>
          )}
          <span className="px-1 text-sm text-fg-muted tabular-nums">
            Page {formatCount(page.page)} of {formatCount(page.pageCount)}
          </span>
          {hasNext ? (
            <ButtonLink
              href={trackListHref(query, { page: page.page + 1 }, basePath) as Route}
              scroll={false}
              variant="secondary"
              size="sm"
              rel="next"
              iconRight={<ChevronRight aria-hidden="true" />}
            >
              Next
            </ButtonLink>
          ) : (
            <Button variant="secondary" size="sm" disabled iconRight={<ChevronRight aria-hidden="true" />}>
              Next
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
