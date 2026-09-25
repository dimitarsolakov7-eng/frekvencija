"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { GenreDot, SearchInput, Select } from "@/components/ui";
import {
  MAX_TRACK_SEARCH_LENGTH,
  NO_GENRE,
  normalizeSearch,
  TRACK_STATUS_FILTERS,
  TRACK_STATUS_LABELS,
  type TrackListQuery,
  type TrackStatusFilter,
} from "./track-query";
import type { GenreOption } from "./types";

export interface TrackFiltersProps {
  query: TrackListQuery;
  genres: readonly GenreOption[];
  /** Navigates to the list with these parts of the query changed. */
  onChange: (patch: Partial<TrackListQuery>) => void;
}

/** Typing pauses this long before the list is searched (Enter searches at once). */
const SEARCH_DELAY_MS = 400;

function isStatusFilter(value: string): value is TrackStatusFilter {
  return (TRACK_STATUS_FILTERS as readonly string[]).includes(value);
}

const STATUS_DOT: Record<TrackStatusFilter, "success" | "neutral" | "danger" | null> = {
  all: null,
  active: "success",
  inactive: "neutral",
  removed: "danger",
};

/**
 * Filter row of screen 05: "Search tracks or artists", genre (All genres / each genre / Without
 * genre) and status (All statuses / Active / Inactive / Removed). Every change becomes a URL change
 * (the page reads the filters from searchParams), so views can be bookmarked and Back works.
 */
export function TrackFilters({ query, genres, onChange }: TrackFiltersProps) {
  const [search, setSearch] = useState(query.q);
  const [syncedQuery, setSyncedQuery] = useState(query.q);
  const timer = useRef<number | null>(null);

  // The URL changed from elsewhere (Clear filters, Back): show its search text, unless it is just
  // the debounced echo of what is being typed.
  if (syncedQuery !== query.q) {
    setSyncedQuery(query.q);
    if (normalizeSearch(search) !== query.q) setSearch(query.q);
  }

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function cancelPendingSearch() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }

  function searchNow(value: string) {
    cancelPendingSearch();
    const q = normalizeSearch(value);
    if (q !== query.q) onChange({ q });
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    cancelPendingSearch();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const q = normalizeSearch(value);
      if (q !== query.q) onChange({ q });
    }, SEARCH_DELAY_MS);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    searchNow(search);
  }

  const selectedGenre = query.genre && query.genre !== NO_GENRE ? genres.find((genre) => genre.id === query.genre) : undefined;
  const statusDot = STATUS_DOT[query.status];

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,13rem)_minmax(0,11rem)]">
      <form role="search" aria-label="Search tracks" onSubmit={handleSubmit} className="min-w-0">
        <SearchInput
          label="Search tracks or artists"
          placeholder="Search tracks or artists"
          name="q"
          value={search}
          onValueChange={handleSearchChange}
          onClear={() => searchNow("")}
          maxLength={MAX_TRACK_SEARCH_LENGTH}
          autoComplete="off"
          enterKeyHint="search"
        />
      </form>
      <div className="grid grid-cols-2 gap-3 md:contents">
        <Select
          aria-label="Filter by genre"
          value={query.genre ?? ""}
          onChange={(event) => onChange({ genre: event.currentTarget.value || null })}
          leading={selectedGenre ? <GenreDot genreKey={selectedGenre.slug} /> : undefined}
        >
          <option value="">All genres</option>
          {genres.map((genre) => (
            <option key={genre.id} value={genre.id}>
              {genre.isEnabled ? genre.name : `${genre.name} (inactive)`}
            </option>
          ))}
          <option value={NO_GENRE}>Without genre</option>
        </Select>
        <Select
          aria-label="Filter by status"
          value={query.status}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (isStatusFilter(value)) onChange({ status: value });
          }}
          leading={statusDot ? <StatusDot tone={statusDot} /> : undefined}
        >
          {TRACK_STATUS_FILTERS.map((status) => (
            <option key={status} value={status}>
              {TRACK_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

/** Decorative dot matching the StatusPill colours inside the status select. */
function StatusDot({ tone }: { tone: "success" | "neutral" | "danger" }) {
  const color = tone === "success" ? "bg-accent" : tone === "danger" ? "bg-danger" : "bg-fg-muted";
  return <span aria-hidden="true" className={`size-2 rounded-full ${color}`} />;
}
