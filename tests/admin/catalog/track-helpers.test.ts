import { describe, expect, it } from "vitest";
import {
  describeUploadPhase,
  isTrackDraftDirty,
  pruneSelection,
  selectionState,
  toggleGenre,
  toggleSelection,
  trackDraftFormData,
  trackDraftFromTrack,
  trackDraftProblems,
  trackGenres,
  uploadFileMeta,
  uploadPercent,
  uploadsInProgressMessage,
} from "@/components/admin/catalog/track-helpers";
import type { GenreOption } from "@/components/admin/catalog/types";
import { trackMetadataUpdateSchema } from "@/lib/validation/tracks";
import { formDataToObject } from "@/lib/validation/forms";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const JAZZ = "22222222-2222-4222-8222-222222222222";
const LOUNGE = "33333333-3333-4333-8333-333333333333";

const GENRES: GenreOption[] = [
  { id: HOUSE, name: "House", slug: "house", isEnabled: true, coverUrl: null },
  { id: JAZZ, name: "Jazz", slug: "jazz", isEnabled: true, coverUrl: "https://storage.test/jazz.png" },
  { id: LOUNGE, name: "Lounge", slug: "lounge", isEnabled: false, coverUrl: null },
];

describe("trackGenres", () => {
  it("returns the track's genres in the catalogue's display order, so the first genre is stable", () => {
    expect(trackGenres({ genreIds: [LOUNGE, HOUSE] }, GENRES).map((genre) => genre.name)).toEqual(["House", "Lounge"]);
  });

  it("drops genres that no longer exist", () => {
    expect(trackGenres({ genreIds: ["gone", JAZZ] }, GENRES).map((genre) => genre.id)).toEqual([JAZZ]);
    expect(trackGenres({ genreIds: [] }, GENRES)).toEqual([]);
  });
});

describe("track editor draft", () => {
  const track = { title: "Afterglow", artist: "Frekvencija Sessions", genreIds: [JAZZ, HOUSE, "gone"] };

  it("starts from the track, genres in display order", () => {
    expect(trackDraftFromTrack(track, GENRES)).toEqual({ title: "Afterglow", artist: "Frekvencija Sessions", genreIds: [HOUSE, JAZZ] });
  });

  it("shows the default artist as an empty field", () => {
    expect(trackDraftFromTrack({ ...track, artist: "Unknown Artist" }, GENRES).artist).toBe("");
  });

  it("toggles genres keeping the display order", () => {
    expect(toggleGenre([JAZZ], HOUSE, true, GENRES)).toEqual([HOUSE, JAZZ]);
    expect(toggleGenre([HOUSE, JAZZ], HOUSE, false, GENRES)).toEqual([JAZZ]);
    expect(toggleGenre([HOUSE], HOUSE, true, GENRES)).toEqual([HOUSE]);
  });

  it("is dirty only when saving would change something", () => {
    const baseline = trackDraftFromTrack(track, GENRES);
    expect(isTrackDraftDirty(baseline, baseline)).toBe(false);
    expect(isTrackDraftDirty({ ...baseline, title: "  Afterglow " }, baseline)).toBe(false);
    expect(isTrackDraftDirty({ ...baseline, title: "Afterglow (Edit)" }, baseline)).toBe(true);
    expect(isTrackDraftDirty({ ...baseline, artist: "" }, { ...baseline, artist: "Unknown Artist" })).toBe(false);
    expect(isTrackDraftDirty({ ...baseline, artist: "Someone" }, baseline)).toBe(true);
    expect(isTrackDraftDirty({ ...baseline, genreIds: [JAZZ, HOUSE] }, baseline)).toBe(false);
    expect(isTrackDraftDirty({ ...baseline, genreIds: [HOUSE] }, baseline)).toBe(true);
    expect(isTrackDraftDirty({ ...baseline, genreIds: [HOUSE, LOUNGE] }, baseline)).toBe(true);
  });

  it("builds the FormData updateTrackAction reads", () => {
    const data = trackDraftFormData({ title: " Afterglow ", artist: "", genreIds: [HOUSE, JAZZ] });
    expect(data.getAll("genreIds")).toEqual([HOUSE, JAZZ]);
    expect(trackMetadataUpdateSchema.parse(formDataToObject(data, { arrays: ["genreIds"] }))).toEqual({
      title: "Afterglow",
      artist: "Unknown Artist",
      genreIds: [HOUSE, JAZZ],
    });
  });

  it("reports problems before submitting", () => {
    expect(trackDraftProblems({ title: " ", artist: "", genreIds: [] })).toEqual({ title: "Enter a title." });
    expect(trackDraftProblems({ title: "x".repeat(201), artist: "y".repeat(201), genreIds: [] })).toEqual({
      title: "Use at most 200 characters.",
      artist: "Use at most 200 characters.",
    });
    expect(trackDraftProblems({ title: "Afterglow", artist: "", genreIds: [] })).toEqual({});
  });
});

describe("bulk selection", () => {
  it("ticks and unticks rows without duplicates", () => {
    expect(toggleSelection(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a", true)).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a", false)).toEqual(["b"]);
  });

  it("forgets rows that are no longer listed", () => {
    expect(pruneSelection(["a", "x", "b"], ["b", "a", "c"])).toEqual(["a", "b"]);
  });

  it("derives the select-all checkbox state", () => {
    expect(selectionState([], ["a", "b"])).toBe("none");
    expect(selectionState(["a"], ["a", "b"])).toBe("some");
    expect(selectionState(["b", "a", "x"], ["a", "b"])).toBe("all");
    expect(selectionState(["a"], [])).toBe("none");
  });
});

describe("upload queue rows", () => {
  it("describes the file as type and size", () => {
    expect(uploadFileMeta({ name: "evening-session.mp3", size: 8.4 * 1024 * 1024 })).toBe("MP3 • 8.4 MB");
    expect(uploadFileMeta({ name: "C:\\music\\cover.final.JPG", size: 1536 })).toBe("JPG • 1.5 KB");
    expect(uploadFileMeta({ name: "no-extension", size: 10 })).toBe("File • 10 B");
    expect(uploadFileMeta({ name: "trailing.", size: 10 })).toBe("File • 10 B");
  });

  it("shows measurable progress only while uploading (100% when done)", () => {
    expect(uploadPercent({ phase: "uploading", progress: 0.684 })).toBe(68);
    expect(uploadPercent({ phase: "uploading", progress: 1.3 })).toBe(100);
    expect(uploadPercent({ phase: "done", progress: 0.2 })).toBe(100);
    expect(uploadPercent({ phase: "validating", progress: 1 })).toBeNull();
    expect(uploadPercent({ phase: "queued", progress: 0 })).toBeNull();
  });

  it("names every phase", () => {
    expect(describeUploadPhase("queued")).toBe("Waiting…");
    expect(describeUploadPhase("signing")).toBe("Preparing…");
    expect(describeUploadPhase("uploading")).toBe("Uploading…");
    expect(describeUploadPhase("validating")).toBe("Checking the file…");
    expect(describeUploadPhase("done")).toBe("Added to the library");
    expect(describeUploadPhase("error")).toBe("Not uploaded");
    expect(describeUploadPhase("cancelled")).toBe("Cancelled");
  });

  it("explains what leaving the page does to running uploads (UPL-01, shown by the unsaved-changes guard)", () => {
    expect(uploadsInProgressMessage(1)).toBe(
      "1 upload is still in progress. If you leave this page, files that haven’t finished uploading are cancelled.",
    );
    expect(uploadsInProgressMessage(3)).toMatch(/^3 uploads are still in progress\. /);
  });
});
