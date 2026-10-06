/**
 * Server-render checks for the catalogue screens after the review fixes: the track table's
 * selection cells (A11Y-12), the editors' validation live regions (A11Y-09), paging opting out of
 * the unsaved-changes guard, and the whole music and genre screens rendering inside the admin guard
 * provider (NAV-01 / A11Y-06 / UPL-01 wiring). Fixtures are the development-preview fixtures.
 */
import { createElement as h, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GenreEditor } from "@/components/admin/catalog/GenreEditor";
import { GenreManager } from "@/components/admin/catalog/GenreManager";
import { MusicLibrary } from "@/components/admin/catalog/MusicLibrary";
import { EMPTY_GENRE_DRAFT } from "@/components/admin/catalog/genre-draft";
import { trackDraftFromTrack } from "@/components/admin/catalog/track-helpers";
import { DEFAULT_TRACK_QUERY } from "@/components/admin/catalog/track-query";
import { TrackEditor } from "@/components/admin/catalog/TrackEditor";
import { TrackPagination } from "@/components/admin/catalog/TrackPagination";
import { TrackTable } from "@/components/admin/catalog/TrackTable";
import { UnsavedChangesProvider } from "@/components/admin/shell/unsaved-changes";
import { ToastProvider } from "@/components/ui";
import { PREVIEW_GENRE_ACTIONS, PREVIEW_MUSIC_ACTIONS, PREVIEW_SERVICES } from "@/app/dev/preview/genres/preview-services";
import { PREVIEW_BUSINESSES, PREVIEW_GENRES } from "@/app/dev/preview/genres/fixtures";
import { buildMusicFixture } from "@/app/dev/preview/music/fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  usePathname: () => "/admin/music",
}));

const noop = () => undefined;

/** Whether some <tag …> in the markup carries every given attribute (in any order). */
function hasTag(html: string, tag: string, attributes: string[]): boolean {
  const tags = html.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g")) ?? [];
  return tags.some((markup) => attributes.every((attribute) => markup.includes(attribute)));
}

function render(node: ReactNode): string {
  // React separates adjacent text nodes with <!-- --> in server HTML; drop them to match visible text.
  return renderToString(h(ToastProvider, null, h(UnsavedChangesProvider, null, node))).replace(/<!-- -->/g, "");
}

const fixture = buildMusicFixture(DEFAULT_TRACK_QUERY);
const tracks = fixture.page.tracks;

describe("TrackTable selection cells (A11Y-12)", () => {
  const html = render(
    h(TrackTable, {
      tracks,
      genres: fixture.genres,
      caption: "Tracks",
      selectedTrackId: null,
      checkedIds: [],
      busyTrackIds: new Set<string>(),
      onCheckedChange: noop,
      onCheckAll: noop,
      onOpen: noop,
      onReplace: noop,
      onSetActive: noop,
      onRemove: noop,
      onRestore: noop,
      onDelete: noop,
    }),
  );

  it("puts every checkbox in a 48×44px label that also covers the rest of its cell, so a near miss toggles it instead of opening the editor", () => {
    const labelClass = "flex h-11 w-12 cursor-pointer items-center justify-center after:absolute after:inset-0 after:content-[&#x27;&#x27;]";
    const cell = (tag: "td" | "th", label: string) =>
      new RegExp(`<${tag} [^>]*class="[^"]*\\brelative w-12 px-0!"[^>]*><label class="${labelClass.replace(/[[\]]/g, "\\$&")}"><input type="checkbox" aria-label="${label}"`);
    expect(html).toMatch(cell("th", "Select all tracks on this page"));
    for (const track of tracks) expect(html).toMatch(cell("td", `Select ${track.title}`));
    expect(html.split(`<label class="${labelClass}">`)).toHaveLength(tracks.length + 2);
  });

  it("keeps the 20px box itself", () => {
    expect(html).toContain('class="size-5 cursor-pointer rounded accent-accent"');
  });
});

describe("TrackPagination", () => {
  it("opts its Previous/Next links out of the unsaved-changes guard (paging keeps edits and uploads)", () => {
    const html = render(
      h(TrackPagination, {
        query: { ...DEFAULT_TRACK_QUERY, page: 2 },
        page: { ...fixture.page, page: 2, pageCount: 3, total: 120 },
      }),
    );
    expect(html).toMatch(/<nav aria-label="Pages" data-skip-unsaved-guard=""/);
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
  });
});

describe("editor validation announcements (A11Y-09)", () => {
  it("the genre editor has a polite live region for refused saves", () => {
    const html = render(
      h(GenreEditor, {
        mode: "create",
        genre: null,
        businesses: PREVIEW_BUSINESSES,
        draft: EMPTY_GENRE_DRAFT,
        onDraftChange: noop,
        dirty: false,
        saving: false,
        error: null,
        onSave: noop,
        onDiscard: noop,
        onToggleActive: noop,
        manageTracksHref: null,
      }),
    );
    expect(html).toContain('<p class="sr-only" aria-live="polite"><span></span></p>');
    // The browser's own validation is off, so the editor's feedback is the only one.
    expect(hasTag(html, "form", ['noValidate=""', 'aria-label="New genre"'])).toBe(true);
  });

  it("the track editor has one too, and shows title problems with aria-invalid while typing", () => {
    const track = tracks[0];
    const html = render(
      h(TrackEditor, {
        track,
        genres: fixture.genres,
        draft: { ...trackDraftFromTrack(track, fixture.genres), title: "" },
        onDraftChange: noop,
        dirty: true,
        saving: false,
        error: null,
        onSave: noop,
        onDiscard: noop,
        onReplace: noop,
        preview: null,
        onPreview: noop,
        onStopPreview: noop,
        onPreviewFailed: noop,
        allowAudio: false,
        genresHref: "/admin/genres",
      }),
    );
    expect(html).toContain('<p class="sr-only" aria-live="polite"><span></span></p>');
    expect(hasTag(html, "input", ['name="title"', 'aria-invalid="true"', "aria-describedby="])).toBe(true);
    expect(html).toContain("Enter a title.");
  });
});

describe("catalogue screens inside the admin guard provider", () => {
  it("renders the music library (editor, table, upload queue) without a pending question", () => {
    const html = render(
      h(MusicLibrary, {
        query: fixture.query,
        genres: fixture.genres,
        page: fixture.page,
        actions: PREVIEW_MUSIC_ACTIONS,
        services: PREVIEW_SERVICES,
      }),
    );
    expect(html).toContain("Selected track");
    expect(html).toContain("Upload queue");
    expect(html).toContain(`Select ${tracks[0].title}`);
    expect(html).not.toContain("Discard unsaved changes?");
  });

  it("renders the genre manager with the first genre in the editor", () => {
    const html = render(
      h(GenreManager, {
        genres: PREVIEW_GENRES.map((genre) => ({ ...genre, accessBusinessIds: [...genre.accessBusinessIds] })),
        businesses: [...PREVIEW_BUSINESSES],
        actions: PREVIEW_GENRE_ACTIONS,
        services: PREVIEW_SERVICES,
      }),
    );
    expect(html).toContain("Edit genre");
    expect(html).toContain("Manage tracks");
    expect(html).toContain(`Details of ${PREVIEW_GENRES[0].name}`);
    expect(html).not.toContain("Discard unsaved changes?");
  });
});
