/**
 * State machine for the "Your station voice" Preview (design/CLAUDE-HANDOFF.md §03/04): previewing
 * must never mix with live station audio. The radio is paused first, the clip plays in its own
 * audio element (never through the engine, so the completed-song counter is untouched), and when
 * the preview ends or is stopped the listener gets an explicit "Resume radio" button, offered only
 * when the radio was playing before the preview started.
 *
 * The finished/failed panel (and its "Resume radio") belongs to the preview that produced it: once
 * the radio plays again or its playback state changes in any way (Play, Skip, a genre, a media key,
 * an error…), the panel is retired for good, so it can never come back later (review finding PLAY-05).
 *
 * Pure (no React, no DOM) so every transition is unit-tested; useVoicePreview() drives it.
 */
import type { PlayerSnapshot } from "@/lib/player/types";

export type VoicePreviewPhase = "idle" | "loading" | "playing" | "finished" | "failed";

export interface VoicePreviewState {
  phase: VoicePreviewPhase;
  /** Clip being (or last) previewed. */
  clipId: string | null;
  /** The radio was producing audio when the first preview of this round started. */
  radioWasPlaying: boolean;
  /** Honest failure message for the "failed" phase. */
  error: string | null;
  /** Id of the latest started request; events carrying another id (late events) are ignored. */
  request: number;
  /**
   * radioPlaybackKey() of the radio when the finished/failed panel first showed (null before that):
   * the panel is only valid while the radio stays exactly there.
   */
  radioKey: string | null;
}

export type VoicePreviewEvent =
  /** Preview pressed. `request` must be newer than any previous one. */
  | { type: "start"; request: number; clipId: string; radioWasPlaying: boolean }
  /** The clip's audio started playing. */
  | { type: "playing"; request: number }
  /** The clip played to its end. */
  | { type: "ended"; request: number }
  /** Signing or playback failed. */
  | { type: "failed"; request: number; message: string }
  /** The listener pressed Stop. */
  | { type: "stop" }
  /** The radio is playing again (Resume radio, or started from another control): the preview is over. */
  | { type: "radio-resumed" }
  /** The radio's playback state changed after the preview ended: its panel is stale. */
  | { type: "radio-changed" }
  /** The radio state seen when the finished/failed panel first rendered (see voicePreviewRadioEvent). */
  | { type: "radio-observed"; radioKey: string }
  /** The listener closed the finished/failed panel without resuming. */
  | { type: "dismiss" };

export const IDLE_VOICE_PREVIEW: VoicePreviewState = Object.freeze({
  phase: "idle",
  clipId: null,
  radioWasPlaying: false,
  error: null,
  request: 0,
  radioKey: null,
}) as VoicePreviewState;

export function isVoicePreviewActive(state: Pick<VoicePreviewState, "phase">): boolean {
  return state.phase === "loading" || state.phase === "playing";
}

export function voicePreviewReducer(state: VoicePreviewState, event: VoicePreviewEvent): VoicePreviewState {
  switch (event.type) {
    case "start":
      if (event.request <= state.request) return state;
      return {
        phase: "loading",
        clipId: event.clipId,
        // A second preview in a row still remembers that the radio was playing before the first one.
        radioWasPlaying: event.radioWasPlaying || (state.phase !== "idle" && state.radioWasPlaying),
        error: null,
        request: event.request,
        radioKey: null,
      };
    case "playing":
      if (event.request !== state.request || state.phase !== "loading") return state;
      return { ...state, phase: "playing" };
    case "ended":
      if (event.request !== state.request || !isVoicePreviewActive(state)) return state;
      return { ...state, phase: "finished", radioKey: null };
    case "failed":
      if (event.request !== state.request || !isVoicePreviewActive(state)) return state;
      return { ...state, phase: "failed", error: event.message, radioKey: null };
    case "stop":
      // Late events of the stopped request are ignored because they all require an active phase.
      if (!isVoicePreviewActive(state)) return state;
      return { ...state, phase: "finished", radioKey: null };
    case "radio-observed":
      // Remembered once per panel; a later difference retires the panel (radio-changed).
      if ((state.phase !== "finished" && state.phase !== "failed") || state.radioKey !== null) return state;
      return { ...state, radioKey: event.radioKey };
    case "radio-resumed":
    case "radio-changed":
    case "dismiss":
      if (state.phase === "idle") return state;
      return { ...IDLE_VOICE_PREVIEW, request: state.request };
  }
}

/** Identifies the radio's playback state (status, genre, item) for the preview panel. */
export function radioPlaybackKey(snapshot: Pick<PlayerSnapshot, "status" | "genreId" | "current">): string {
  const item = snapshot.current ? `${snapshot.current.kind}:${snapshot.current.id}` : "-";
  return `${snapshot.status}|${snapshot.genreId ?? "-"}|${item}`;
}

/**
 * What the preview must do about the radio as it is now (evaluate on every render; dispatch the
 * result until it is null):
 * - the radio plays again (any control, the keyboard, a media key) → the preview is over: a
 *   loading/playing clip stops (never mixed with the station), a finished/failed panel goes away;
 * - a finished/failed panel first remembers the radio's state, and is retired as soon as that
 *   state changes (Play, Skip, another genre, an error…), so an old "Preview finished. The radio
 *   is paused." never comes back when the radio stops again later.
 */
export function voicePreviewRadioEvent(state: VoicePreviewState, radio: { active: boolean; key: string }): VoicePreviewEvent | null {
  if (state.phase === "idle") return null;
  if (radio.active) return { type: "radio-resumed" };
  if (isVoicePreviewActive(state)) return null;
  if (state.radioKey === null) return { type: "radio-observed", radioKey: radio.key };
  return state.radioKey === radio.key ? null : { type: "radio-changed" };
}

export interface VoicePreviewView {
  mode: "idle" | "loading" | "playing" | "done" | "failed";
  /** Offer "Resume radio" (only when it was playing before and is not playing again already). */
  offerResume: boolean;
  /** One short sentence for the card's status line (null when idle). */
  status: string | null;
}

/**
 * What the card shows. `radioActive` is the engine's live state: once the radio plays again the
 * preview panel is over, whatever the reducer still says.
 */
export function describeVoicePreview(state: VoicePreviewState, radioActive: boolean): VoicePreviewView {
  if (radioActive || state.phase === "idle") return { mode: "idle", offerResume: false, status: null };
  switch (state.phase) {
    case "loading":
      return { mode: "loading", offerResume: false, status: "Getting the preview ready…" };
    case "playing":
      return { mode: "playing", offerResume: false, status: "Previewing… the radio is paused." };
    case "finished":
      return {
        mode: "done",
        offerResume: state.radioWasPlaying,
        status: state.radioWasPlaying ? "Preview finished. The radio is paused." : "Preview finished.",
      };
    case "failed":
      return { mode: "failed", offerResume: state.radioWasPlaying, status: state.error ?? "The preview couldn't be played." };
  }
}

/** Plain-language reason for a failed preview (from a PlayerApiError kind or a play() rejection name). */
export function describeVoicePreviewError(error: unknown): string {
  const kind = typeof error === "object" && error !== null ? (error as { kind?: unknown }).kind : undefined;
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  if (name === "NotAllowedError") return "Your browser blocked the preview. Press Preview again.";
  if (kind === "network") return "The preview couldn't load. Check the internet connection and try again.";
  if (kind === "auth") return "Your session has ended. Log in again to preview your station voice.";
  if (kind === "unavailable" || kind === "forbidden") return "This recording is no longer available.";
  if (name === "NotSupportedError") return "This recording couldn't be played on this device.";
  return "The preview couldn't be played. Try again in a moment.";
}
