import { describe, expect, it } from "vitest";
import {
  IDLE_VOICE_PREVIEW,
  describeVoicePreview,
  describeVoicePreviewError,
  isVoicePreviewActive,
  radioPlaybackKey,
  voicePreviewRadioEvent,
  voicePreviewReducer,
  type VoicePreviewEvent,
  type VoicePreviewState,
  type VoicePreviewView,
} from "@/components/player/voice-preview";
import { PlayerApiError, type PlayerSnapshot } from "@/lib/player/types";

function run(events: VoicePreviewEvent[], from: VoicePreviewState = IDLE_VOICE_PREVIEW): VoicePreviewState {
  return events.reduce(voicePreviewReducer, from);
}

const start = (request: number, radioWasPlaying: boolean, clipId = "clip-1"): VoicePreviewEvent => ({
  type: "start",
  request,
  clipId,
  radioWasPlaying,
});

describe("voicePreviewReducer", () => {
  it("goes loading → playing → finished and remembers that the radio was playing", () => {
    const loading = run([start(1, true)]);
    expect(loading).toMatchObject({ phase: "loading", clipId: "clip-1", radioWasPlaying: true, request: 1 });
    expect(isVoicePreviewActive(loading)).toBe(true);
    const playing = run([{ type: "playing", request: 1 }], loading);
    expect(playing.phase).toBe("playing");
    const finished = run([{ type: "ended", request: 1 }], playing);
    expect(finished).toMatchObject({ phase: "finished", radioWasPlaying: true });
    expect(isVoicePreviewActive(finished)).toBe(false);
  });

  it("Stop ends the preview and ignores the stopped request's late events", () => {
    const stopped = run([start(1, true), { type: "playing", request: 1 }, { type: "stop" }]);
    expect(stopped.phase).toBe("finished");
    expect(run([{ type: "ended", request: 1 }, { type: "failed", request: 1, message: "late" }], stopped)).toBe(stopped);
  });

  it("ignores events of an older request after a new preview started", () => {
    const second = run([start(1, true), start(2, false, "clip-2")]);
    expect(second).toMatchObject({ request: 2, clipId: "clip-2", phase: "loading" });
    expect(run([{ type: "playing", request: 1 }], second)).toBe(second);
    expect(run([{ type: "ended", request: 1 }], second)).toBe(second);
  });

  it("keeps offering Resume radio across back-to-back previews (the radio was playing before the first)", () => {
    const again = run([start(1, true), { type: "playing", request: 1 }, { type: "ended", request: 1 }, start(2, false)]);
    expect(again.radioWasPlaying).toBe(true);
  });

  it("does not offer Resume radio when the radio was not playing", () => {
    const state = run([start(1, false), { type: "playing", request: 1 }, { type: "ended", request: 1 }]);
    expect(describeVoicePreview(state, false)).toMatchObject({ mode: "done", offerResume: false });
  });

  it("records failures with their message and still offers Resume radio", () => {
    const failed = run([start(1, true), { type: "failed", request: 1, message: "No network." }]);
    expect(failed).toMatchObject({ phase: "failed", error: "No network." });
    expect(describeVoicePreview(failed, false)).toMatchObject({ mode: "failed", offerResume: true, status: "No network." });
  });

  it("returns to idle when the radio resumes or the panel is dismissed", () => {
    const finished = run([start(1, true), { type: "ended", request: 1 }]);
    // `ended` while loading is accepted too (a very short clip can end before `playing` is seen).
    expect(finished.phase).toBe("finished");
    expect(run([{ type: "radio-resumed" }], finished)).toMatchObject({ phase: "idle", radioWasPlaying: false, request: 1 });
    expect(run([{ type: "dismiss" }], finished)).toMatchObject({ phase: "idle", radioWasPlaying: false });
    expect(run([{ type: "dismiss" }])).toBe(IDLE_VOICE_PREVIEW);
  });

  it("ignores a start that is not newer than the current request", () => {
    const loading = run([start(3, false)]);
    expect(run([start(3, true)], loading)).toBe(loading);
    expect(run([start(2, true)], loading)).toBe(loading);
  });
});

describe("describeVoicePreview", () => {
  it("shows Previewing… with the radio paused while the clip plays", () => {
    const playing = run([start(1, true), { type: "playing", request: 1 }]);
    expect(describeVoicePreview(playing, false)).toEqual({
      mode: "playing",
      offerResume: false,
      status: "Previewing… the radio is paused.",
    });
    expect(describeVoicePreview(run([start(1, true)]), false).mode).toBe("loading");
  });

  it("offers an explicit Resume radio after the preview when the radio was playing", () => {
    const finished = run([start(1, true), { type: "playing", request: 1 }, { type: "ended", request: 1 }]);
    expect(describeVoicePreview(finished, false)).toMatchObject({ mode: "done", offerResume: true });
  });

  it("is idle as soon as the radio plays again, whatever the reducer still says", () => {
    const playing = run([start(1, true), { type: "playing", request: 1 }]);
    expect(describeVoicePreview(playing, true)).toEqual({ mode: "idle", offerResume: false, status: null });
    expect(describeVoicePreview(IDLE_VOICE_PREVIEW, false)).toEqual({ mode: "idle", offerResume: false, status: null });
  });
});

type Radio = Pick<PlayerSnapshot, "status" | "genreId" | "current">;

const song = (id: string) => ({ kind: "track", id, title: id, artist: "A", durationSeconds: 200 }) as const;

/** One render of useVoicePreview: apply the radio-follow events until stable, then describe. */
function render(state: VoicePreviewState, radio: Radio): { state: VoicePreviewState; view: VoicePreviewView } {
  const active = radio.status === "playing" || radio.status === "loading" || radio.status === "buffering";
  let next = state;
  for (let i = 0; i < 5; i++) {
    const event = voicePreviewRadioEvent(next, { active, key: radioPlaybackKey(radio) });
    if (!event) return { state: next, view: describeVoicePreview(next, active) };
    next = voicePreviewReducer(next, event);
  }
  throw new Error("the radio-follow events did not settle");
}

describe("the preview panel belongs to the preview that produced it (PLAY-05)", () => {
  const playing: Radio = { status: "playing", genreId: "g1", current: song("t1") };
  const pausedByPreview: Radio = { status: "paused", genreId: "g1", current: song("t1") };

  it("does not come back when the radio stops again after being restarted from another control", () => {
    // The radio plays; Preview pauses it; the clip plays to its end.
    let state = run([start(1, true), { type: "playing", request: 1 }, { type: "ended", request: 1 }]);
    let rendered = render(state, pausedByPreview);
    expect(rendered.view).toEqual({ mode: "done", offerResume: true, status: "Preview finished. The radio is paused." });

    // Play on the player bar (or Space, a genre's Play, a media key) instead of "Resume radio".
    rendered = render(rendered.state, playing);
    expect(rendered.view.mode).toBe("idle");
    state = rendered.state;
    expect(state.phase).toBe("idle");

    // Later the radio pauses, is paused by the OS or fails: no stale panel, no status announcement.
    for (const radio of [pausedByPreview, { ...playing, status: "error" as const, current: null }, { ...playing, status: "blocked" as const }]) {
      expect(render(state, radio).view).toEqual({ mode: "idle", offerResume: false, status: null });
    }
  });

  it("retires the finished/failed panel on any change of the radio's playback state, even while it stays quiet", () => {
    const finished = render(run([start(1, true), { type: "ended", request: 1 }]), pausedByPreview).state;
    expect(finished.radioKey).toBe(radioPlaybackKey(pausedByPreview));
    // Another genre selected while paused, a Skip while paused (next item), or an error.
    for (const radio of [
      { ...pausedByPreview, genreId: "g2" },
      { ...pausedByPreview, current: null },
      { ...pausedByPreview, status: "error" as const },
    ]) {
      expect(render(finished, radio).view.mode).toBe("idle");
    }
    const failed = render(run([start(1, true), { type: "failed", request: 1, message: "No network." }]), pausedByPreview).state;
    expect(render(failed, pausedByPreview).view).toMatchObject({ mode: "failed", offerResume: true });
    expect(render(failed, { ...pausedByPreview, genreId: "g2" }).view.mode).toBe("idle");
  });

  it("keeps the panel while nothing changes, and a stopped preview behaves the same", () => {
    const stopped = render(run([start(1, true), { type: "playing", request: 1 }, { type: "stop" }]), pausedByPreview).state;
    for (let i = 0; i < 3; i++) expect(render(stopped, pausedByPreview).view).toMatchObject({ mode: "done", offerResume: true });
    expect(render(stopped, playing).view.mode).toBe("idle");
  });

  it("a loading or playing preview only ends when the radio plays again (never mixes), not on other changes", () => {
    const active = run([start(1, true), { type: "playing", request: 1 }]);
    expect(render(active, { ...pausedByPreview, genreId: "g2" }).view.mode).toBe("playing");
    expect(render(active, playing).state.phase).toBe("idle");
  });

  it("identifies the radio's playback state by status, genre and current item", () => {
    expect(radioPlaybackKey(pausedByPreview)).not.toBe(radioPlaybackKey(playing));
    expect(radioPlaybackKey({ ...pausedByPreview, genreId: "g2" })).not.toBe(radioPlaybackKey(pausedByPreview));
    expect(radioPlaybackKey({ ...pausedByPreview, current: song("t2") })).not.toBe(radioPlaybackKey(pausedByPreview));
    expect(radioPlaybackKey({ ...pausedByPreview, current: song("t1") })).toBe(radioPlaybackKey(pausedByPreview));
    expect(radioPlaybackKey({ status: "idle", genreId: null, current: null })).toBe("idle|-|-");
  });
});

describe("describeVoicePreviewError", () => {
  it("explains failures in plain words", () => {
    expect(describeVoicePreviewError({ name: "NotAllowedError" })).toMatch(/blocked/i);
    expect(describeVoicePreviewError(new PlayerApiError("network", "offline"))).toMatch(/internet/i);
    expect(describeVoicePreviewError(new PlayerApiError("auth", "401", 401))).toMatch(/log in/i);
    expect(describeVoicePreviewError(new PlayerApiError("unavailable", "gone", 404))).toMatch(/no longer available/i);
    expect(describeVoicePreviewError({ name: "NotSupportedError" })).toMatch(/couldn.t be played on this device/i);
    expect(describeVoicePreviewError(new Error("boom"))).toMatch(/try again/i);
  });
});
