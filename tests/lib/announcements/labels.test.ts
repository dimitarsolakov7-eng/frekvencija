import { describe, expect, it } from "vitest";
import { PLACEMENT_CHOICES, placementTiming, RECORDING_PLACEMENT_LABELS, recordingLabel } from "@/lib/announcements/labels";

describe("recording labels", () => {
  it("names recordings by placement as the screens do", () => {
    expect(recordingLabel("rotation")).toBe("Station identity");
    expect(recordingLabel("welcome")).toBe("Welcome message");
    expect(recordingLabel("both")).toBe("Welcome & station identity");
    expect(Object.keys(RECORDING_PLACEMENT_LABELS).sort()).toEqual(["both", "rotation", "welcome"]);
  });

  it("offers Station identity, Welcome message and Both in the editor", () => {
    expect(PLACEMENT_CHOICES.map((choice) => [choice.value, choice.label])).toEqual([
      ["rotation", "Station identity"],
      ["welcome", "Welcome message"],
      ["both", "Both"],
    ]);
  });

  it("explains when each placement plays, with the venue's interval", () => {
    expect(placementTiming("welcome", 4)).toBe("Plays once when the radio is started.");
    expect(placementTiming("rotation", 4)).toBe("Plays between songs, after every 4 completed songs.");
    expect(placementTiming("rotation", 1)).toBe("Plays between songs, after every completed song.");
    expect(placementTiming("both", 6)).toBe("Plays when the radio is started, then between songs, after every 6 completed songs.");
  });
});
