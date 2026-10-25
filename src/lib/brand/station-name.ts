/** The platform's station-name convention: "<venue> Radio". Shared by the admin forms and the public preview. */
export const STATION_SUFFIX = "Radio";

/** Longest station name the database accepts (businesses.station_name). */
export const MAX_STATION_NAME_LENGTH = 120;

/**
 * Suggested station name for a venue: "EmeraldBar" → "EmeraldBar Radio". A name that already ends
 * in "Radio" is kept as is. Returns "" when there is no name or the suggestion would be too long.
 */
export function suggestStationName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const suggestion = new RegExp(`(^|\\s)${STATION_SUFFIX}$`, "i").test(trimmed) ? trimmed : `${trimmed} ${STATION_SUFFIX}`;
  return suggestion.length <= MAX_STATION_NAME_LENGTH ? suggestion : "";
}

/**
 * The public website's live preview: like the suggestion, but a long name is simply cut so the
 * preview never goes blank while someone is typing.
 */
export function previewStationName(name: string, fallback: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  const base = trimmed === "" ? fallback : trimmed;
  return suggestStationName(base) || suggestStationName(base.slice(0, MAX_STATION_NAME_LENGTH - STATION_SUFFIX.length - 1));
}
