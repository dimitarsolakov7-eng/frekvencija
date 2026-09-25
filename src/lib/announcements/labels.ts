/**
 * Placement names as the redesigned screens use them (screen 07 "Active recordings", the venue's
 * "Your station voice" card): a clip that plays between songs is the station identity, a clip that
 * plays when the radio starts is the welcome message. Pure and client-safe.
 */
import type { AnnouncementPlacement } from "@/lib/api/contracts";

/** Name of a recording by placement ("Station identity", "Welcome message", …). */
export const RECORDING_PLACEMENT_LABELS: Readonly<Record<AnnouncementPlacement, string>> = {
  rotation: "Station identity",
  welcome: "Welcome message",
  both: "Welcome & station identity",
};

export function recordingLabel(placement: AnnouncementPlacement): string {
  return RECORDING_PLACEMENT_LABELS[placement];
}

export interface PlacementChoice {
  value: AnnouncementPlacement;
  /** Short option label for the editor's placement control. */
  label: string;
}

/** Options of the editor's placement control, in display order. */
export const PLACEMENT_CHOICES: readonly PlacementChoice[] = [
  { value: "rotation", label: "Station identity" },
  { value: "welcome", label: "Welcome message" },
  { value: "both", label: "Both" },
];

/** "Plays between songs, after every 4 completed songs." — when a clip with this placement plays. */
export function placementTiming(placement: AnnouncementPlacement, everyNTracks: number): string {
  const between =
    everyNTracks === 1 ? "between songs, after every completed song" : `between songs, after every ${everyNTracks} completed songs`;
  switch (placement) {
    case "welcome":
      return "Plays once when the radio is started.";
    case "rotation":
      return `Plays ${between}.`;
    case "both":
      return `Plays when the radio is started, then ${between}.`;
  }
}
