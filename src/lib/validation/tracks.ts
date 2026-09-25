import { z } from "zod";
import { idArray, requiredText } from "./fields";

export const UNKNOWN_ARTIST = "Unknown Artist";

/** Edit form for a track's metadata. A blank artist is stored as "Unknown Artist" (the DB default). */
export const trackMetadataUpdateSchema = z.object({
  title: requiredText("Title", 200),
  artist: z.preprocess(
    (value) => (value === undefined || (typeof value === "string" && value.trim() === "") ? UNKNOWN_ARTIST : value),
    requiredText("Artist", 200),
  ),
  genreIds: idArray("Genres", 100).default([]),
});
export type TrackMetadataUpdateInput = z.output<typeof trackMetadataUpdateSchema>;

/** Most tracks one bulk action may change (a page holds 50; the limit keeps `in (...)` filters short). */
export const MAX_BULK_TRACKS = 200;

/** Track ids for a bulk action (activate, deactivate, remove from playback): 1–200, de-duplicated. */
export const trackBulkIdsSchema = idArray("Tracks", MAX_BULK_TRACKS).refine((ids) => ids.length > 0, {
  error: "Select at least one track.",
});
