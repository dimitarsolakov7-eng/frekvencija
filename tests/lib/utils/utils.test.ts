import { describe, expect, it } from "vitest";
import { cn, fileMatchesAccept, formatBytes, formatDateTime, formatDuration, initials } from "@/lib/utils";

describe("cn", () => {
  it("joins truthy classes and flattens arrays", () => {
    expect(cn("a", false, null, undefined, "", ["b", ["c", false]], "  d  ")).toBe("a b c d");
  });

  it("drops 0 and booleans but keeps other numbers (clsx semantics)", () => {
    const count = 0;
    expect(cn(count && "x", true, 2)).toBe("2");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [59.9, "0:59"],
    [60, "1:00"],
    [215.7, "3:35"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3661, "1:01:01"],
    [36000, "10:00:00"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("clamps negatives and marks unknown values", () => {
    expect(formatDuration(-3)).toBe("0:00");
    expect(formatDuration(null)).toBe("--:--");
    expect(formatDuration(undefined)).toBe("--:--");
    expect(formatDuration(Number.NaN)).toBe("--:--");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("--:--");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [1_048_575, "1 MB"],
    [52_428_800, "50 MB"],
    [13_107_200, "12.5 MB"],
    [2 * 1024 ** 3, "2 GB"],
  ])("formats %s bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("marks invalid values", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(null)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("formats in UTC by default with a zone suffix", () => {
    expect(formatDateTime("2026-09-25T14:03:59.999Z")).toBe("25 Sep 2026, 14:03 UTC");
    expect(formatDateTime(new Date(Date.UTC(2026, 0, 5, 0, 7)))).toBe("5 Jan 2026, 00:07 UTC");
  });

  it("supports date-only output and explicit time zones", () => {
    expect(formatDateTime("2026-09-25T23:30:00Z", { dateOnly: true })).toBe("25 Sep 2026");
    // 23:30 UTC is already the next day in Sofia (UTC+3 in September).
    expect(formatDateTime("2026-09-25T23:30:00Z", { timeZone: "Europe/Sofia" })).toBe("26 Sep 2026, 02:30");
  });

  it("returns a placeholder for missing or invalid input", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("")).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });

  it("throws for an unknown time zone", () => {
    expect(() => formatDateTime("2026-09-25T00:00:00Z", { timeZone: "Mars/Olympus" })).toThrow(RangeError);
  });
});

describe("initials", () => {
  it.each([
    ["Hotel Aurora", "HA"],
    ["EmeraldBar Radio", "ER"],
    ["EmeraldBar", "EB"],
    ["BBC", "B"],
    ["the bar", "TB"],
    ["Café Olé", "CO"],
    ["  jazz-club  ", "JC"],
    ["123 Club", "1C"],
    ["Émile", "É"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });

  it("falls back to ? without letters", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
    expect(initials("🎵 ♪")).toBe("?");
    expect(initials(null)).toBe("?");
  });
});

describe("fileMatchesAccept", () => {
  const mp3 = { name: "Song.MP3", type: "audio/mpeg" };
  const untypedMp3 = { name: "song.mp3", type: "" };
  const png = { name: "logo.png", type: "image/png" };

  it("accepts everything without an accept string", () => {
    expect(fileMatchesAccept(png, undefined)).toBe(true);
    expect(fileMatchesAccept(png, " ")).toBe(true);
  });

  it("matches extensions case-insensitively, MIME types and wildcards", () => {
    expect(fileMatchesAccept(mp3, ".mp3")).toBe(true);
    expect(fileMatchesAccept(untypedMp3, ".mp3,audio/mpeg")).toBe(true);
    expect(fileMatchesAccept(untypedMp3, "audio/mpeg")).toBe(false);
    expect(fileMatchesAccept(png, "image/*")).toBe(true);
    expect(fileMatchesAccept(mp3, "image/png, image/jpeg")).toBe(false);
  });
});
