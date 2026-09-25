/**
 * Display formatting helpers. Every function is deterministic (fixed locale, fixed time zone by
 * default) so server-rendered output matches the client and never causes a hydration mismatch.
 */

/** Placeholder shown for missing or invalid values. */
export const UNKNOWN_VALUE = "—";

/** Placeholder for an unknown duration, shaped like a time so layouts do not jump. */
export const UNKNOWN_DURATION = "--:--";

/**
 * Formats seconds as `m:ss`, or `h:mm:ss` from one hour. Fractions are truncated (a 215.7 s track
 * shows as 3:35) and negative values clamp to 0:00. `null`/`NaN`/`Infinity` give "--:--".
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return UNKNOWN_DURATION;
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const byteNumberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, useGrouping: false });

/**
 * Formats a byte count with binary multiples (1 KB = 1024 B), matching how upload limits such as
 * "50 MB" (52,428,800 bytes) are configured. Shows at most one decimal: "512 B", "1.5 KB", "48 MB".
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return UNKNOWN_VALUE;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // 1,048,575 B is 1023.999 KB, which would print as "1024 KB": promote it to the next unit.
  if (Math.round(value * 10) / 10 >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${byteNumberFormat.format(value)} ${BYTE_UNITS[unit]}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const numericFormatters = new Map<string, Intl.DateTimeFormat>();

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * Only numeric parts are taken from Intl: month *names* differ between ICU versions (en-GB prints
 * "Sept" in newer ICU), which would make server and browser output disagree.
 */
function datePartsIn(date: Date, timeZone: string): DateParts {
  let formatter = numericFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    numericFormatters.set(timeZone, formatter);
  }
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Some engines still print midnight as "24" despite hourCycle h23.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

export interface FormatDateTimeOptions {
  /** IANA time zone. Defaults to "UTC" so server and client render identical text. */
  timeZone?: string;
  /** Omit the time of day. */
  dateOnly?: boolean;
}

/**
 * Formats an ISO timestamp (or Date) as "25 Sep 2026, 14:03 UTC", or "25 Sep 2026" with `dateOnly`.
 * The zone suffix is printed for UTC only; pass an explicit `timeZone` from client code that knows
 * the viewer's zone. Invalid input returns "—" instead of "Invalid Date". An unknown time zone
 * throws a RangeError (a programming error, not a data problem).
 */
export function formatDateTime(
  value: string | Date | null | undefined,
  options: FormatDateTimeOptions = {},
): string {
  if (value === null || value === undefined || value === "") return UNKNOWN_VALUE;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return UNKNOWN_VALUE;

  const timeZone = options.timeZone ?? "UTC";
  const parts = datePartsIn(date, timeZone);
  const day = `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
  if (options.dateOnly) return day;

  const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  return timeZone === "UTC" ? `${day}, ${time} UTC` : `${day}, ${time}`;
}
