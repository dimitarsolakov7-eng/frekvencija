import { describe, expect, it } from "vitest";
import {
  countForStatus,
  DEFAULT_TRACK_QUERY,
  describePageWindow,
  formatTrackCount,
  genreTracksHref,
  hasActiveFilters,
  MAX_TRACK_SEARCH_LENGTH,
  NO_GENRE,
  normalizeSearch,
  pageCount,
  pageRange,
  parseTrackListQuery,
  parseTrackStatus,
  toIlikePattern,
  TRACK_STATE_LABELS,
  TRACK_STATUS_FILTERS,
  TRACK_STATUS_LABELS,
  trackListHref,
  trackListSearchParams,
  trackSearchFilter,
  trackState,
  trackStateTone,
  type TrackListQuery,
} from "@/components/admin/catalog/track-query";

const GENRE = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("parseTrackListQuery", () => {
  it("returns the defaults for empty params", () => {
    expect(parseTrackListQuery({})).toEqual(DEFAULT_TRACK_QUERY);
    expect(parseTrackListQuery(new URLSearchParams())).toEqual(DEFAULT_TRACK_QUERY);
  });

  it("reads every valid parameter", () => {
    expect(parseTrackListQuery({ q: "  blue   moon ", genre: GENRE.toUpperCase(), status: "removed", sort: "title", page: "3" })).toEqual({
      q: "blue moon",
      genre: GENRE,
      status: "removed",
      sort: "title",
      page: 3,
    });
  });

  it("accepts the no-genre filter", () => {
    expect(parseTrackListQuery({ genre: NO_GENRE }).genre).toBe(NO_GENRE);
  });

  it("falls back to defaults for invalid values instead of failing", () => {
    expect(parseTrackListQuery({ genre: "jazz", status: "deleted", sort: "random", page: "-2" })).toEqual(DEFAULT_TRACK_QUERY);
    expect(parseTrackListQuery({ page: "0" }).page).toBe(1);
    expect(parseTrackListQuery({ page: "2.5" }).page).toBe(1);
    expect(parseTrackListQuery({ page: "abc" }).page).toBe(1);
    expect(parseTrackListQuery({ page: "99999999" }).page).toBe(1);
    expect(parseTrackListQuery({ genre: "not-a-uuid'; drop table" }).genre).toBeNull();
  });

  it("uses the first value of repeated parameters", () => {
    expect(parseTrackListQuery({ status: ["active", "removed"], q: ["one", "two"] })).toMatchObject({ status: "active", q: "one" });
    expect(parseTrackListQuery(new URLSearchParams("status=inactive&status=removed")).status).toBe("inactive");
  });
});

describe("normalizeSearch", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeSearch("  a \n\t b  ")).toBe("a b");
    expect(normalizeSearch(undefined)).toBe("");
    expect(normalizeSearch(null)).toBe("");
  });

  it("caps the length without splitting a surrogate pair", () => {
    expect(normalizeSearch("x".repeat(500))).toHaveLength(MAX_TRACK_SEARCH_LENGTH);
    const emoji = `${"x".repeat(MAX_TRACK_SEARCH_LENGTH - 1)}🎵`;
    const result = normalizeSearch(emoji);
    expect(result).toBe("x".repeat(MAX_TRACK_SEARCH_LENGTH - 1));
    expect(result.length).toBeLessThanOrEqual(MAX_TRACK_SEARCH_LENGTH);
  });
});

describe("trackListSearchParams / trackListHref", () => {
  const query: TrackListQuery = { q: "moon", genre: GENRE, status: "active", sort: "artist", page: 4 };

  it("omits defaults so URLs stay short", () => {
    expect(trackListSearchParams(DEFAULT_TRACK_QUERY).toString()).toBe("");
    expect(trackListHref(DEFAULT_TRACK_QUERY)).toBe("/admin/music");
  });

  it("round-trips through parseTrackListQuery", () => {
    const params = trackListSearchParams(query);
    expect(parseTrackListQuery(params)).toEqual(query);
  });

  it("resets to page 1 when a filter changes, but keeps the page for no-op patches", () => {
    expect(parseTrackListQuery(new URL(trackListHref(query, { status: "removed" }), "http://x").searchParams).page).toBe(1);
    expect(parseTrackListQuery(new URL(trackListHref(query, { q: "sun" }), "http://x").searchParams).page).toBe(1);
    expect(parseTrackListQuery(new URL(trackListHref(query, { status: "active" }), "http://x").searchParams).page).toBe(4);
    expect(parseTrackListQuery(new URL(trackListHref(query), "http://x").searchParams).page).toBe(4);
  });

  it("changes the page explicitly", () => {
    expect(trackListHref(query, { page: 5 })).toContain("page=5");
    expect(trackListHref(query, { page: 1 })).not.toContain("page=");
  });

  it("encodes search text safely", () => {
    const href = trackListHref(DEFAULT_TRACK_QUERY, { q: "rock & roll #1" });
    expect(new URL(href, "http://x").searchParams.get("q")).toBe("rock & roll #1");
  });

  it("clears a filter with null", () => {
    expect(trackListHref(query, { genre: null })).not.toContain("genre=");
  });
});

describe("hasActiveFilters", () => {
  it("counts search, genre and status, but not sort or page", () => {
    expect(hasActiveFilters(DEFAULT_TRACK_QUERY)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_TRACK_QUERY, sort: "oldest", page: 3 })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_TRACK_QUERY, q: "x" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_TRACK_QUERY, genre: NO_GENRE })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_TRACK_QUERY, status: "active" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_TRACK_QUERY, status: "all" })).toBe(false);
  });
});

describe("search filter", () => {
  it("builds an ilike pattern around the text", () => {
    expect(toIlikePattern("blue moon")).toBe("*blue moon*");
    expect(toIlikePattern("   ")).toBeNull();
  });

  it("neutralises characters that would break PostgREST's or=() syntax or act as wildcards", () => {
    expect(toIlikePattern('Hello, World (Live) "2024": v1.0 100% *')).toBe("*Hello_ World _Live_ _2024__ v1_0 100_ _*");
    expect(toIlikePattern("a\\b")).toBe("*a_b*");
  });

  it("cannot inject another filter", () => {
    const filter = trackSearchFilter("x,id.eq.1)");
    expect(filter).toBe("title.ilike.*x_id_eq_1_*,artist.ilike.*x_id_eq_1_*");
    // Exactly one separator between the two conditions.
    expect(filter?.split(",")).toHaveLength(2);
  });

  it("returns null without search text", () => {
    expect(trackSearchFilter("")).toBeNull();
  });
});

describe("paging", () => {
  it("computes inclusive ranges", () => {
    expect(pageRange(1, 50)).toEqual({ from: 0, to: 49 });
    expect(pageRange(3, 50)).toEqual({ from: 100, to: 149 });
    expect(pageRange(0, 50)).toEqual({ from: 0, to: 49 });
    expect(pageRange(Number.NaN, 50)).toEqual({ from: 0, to: 49 });
  });

  it("counts pages", () => {
    expect(pageCount(0, 50)).toBe(0);
    expect(pageCount(1, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
  });

  it("describes the visible window", () => {
    expect(describePageWindow(1, 50, 50, 312)).toBe("Showing 1–50 of 312");
    expect(describePageWindow(7, 50, 12, 312)).toBe("Showing 301–312 of 312");
    expect(describePageWindow(1, 50, 1, 1)).toBe("Showing 1 of 1");
    expect(describePageWindow(21, 50, 50, 5000)).toBe("Showing 1,001–1,050 of 5,000");
    expect(describePageWindow(2, 50, 0, 10)).toBeNull();
  });
});

describe("status counts and track state", () => {
  const counts = { active: 10, inactive: 3, removed: 2 };

  it("derives the count for every status filter", () => {
    expect(countForStatus("active", counts)).toBe(10);
    expect(countForStatus("inactive", counts)).toBe(3);
    expect(countForStatus("removed", counts)).toBe(2);
    expect(countForStatus("all", counts)).toBe(15);
  });

  it("treats removal as stronger than the enable switch", () => {
    expect(trackState({ isActive: true, removedAt: null })).toBe("active");
    expect(trackState({ isActive: false, removedAt: null })).toBe("inactive");
    expect(trackState({ isActive: true, removedAt: "2026-09-25T10:00:00Z" })).toBe("removed");
    expect(trackState({ isActive: false, removedAt: "2026-09-25T10:00:00Z" })).toBe("removed");
  });

  it("labels and colours each state for the status pill", () => {
    expect(TRACK_STATE_LABELS).toEqual({ active: "Active", inactive: "Inactive", removed: "Removed" });
    expect(trackStateTone("active")).toBe("success");
    expect(trackStateTone("inactive")).toBe("neutral");
    expect(trackStateTone("removed")).toBe("danger");
  });

  it("formats the count footer", () => {
    expect(formatTrackCount(1)).toBe("1 track");
    expect(formatTrackCount(6)).toBe("6 tracks");
    expect(formatTrackCount(1234)).toBe("1,234 tracks");
  });
});

describe("status filter values", () => {
  it("defaults to All statuses and offers Active, Inactive and Removed", () => {
    expect(DEFAULT_TRACK_QUERY.status).toBe("all");
    expect(TRACK_STATUS_FILTERS).toEqual(["all", "active", "inactive", "removed"]);
    expect(TRACK_STATUS_LABELS.all).toBe("All statuses");
  });

  it("reads legacy spellings from older links", () => {
    expect(parseTrackStatus("disabled")).toBe("inactive");
    expect(parseTrackStatus("current")).toBe("all");
    expect(parseTrackStatus(" ACTIVE ")).toBe("active");
    expect(parseTrackStatus("draft")).toBe("all");
    expect(parseTrackStatus(undefined)).toBe("all");
  });
});

describe("links for other screens and previews", () => {
  it("links a genre's tracks (Manage tracks)", () => {
    expect(genreTracksHref(GENRE)).toBe(`/admin/music?genre=${GENRE}`);
  });

  it("keeps a preview's own route", () => {
    expect(trackListHref(DEFAULT_TRACK_QUERY, { status: "removed" }, "/dev/preview/music")).toBe("/dev/preview/music?status=removed");
    expect(genreTracksHref(GENRE, "/dev/preview/music")).toBe(`/dev/preview/music?genre=${GENRE}`);
  });
});
