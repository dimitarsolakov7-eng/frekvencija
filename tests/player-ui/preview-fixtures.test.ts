import { describe, expect, it } from "vitest";
import {
  PREVIEW_STATES,
  applyPreviewCommand,
  isPreviewState,
  previewBootstrap,
  previewSnapshot,
} from "@/app/dev/preview/radio/fixtures";
import { genreCardState, getPrimaryAction, hasPlayableGenre } from "@/components/player/player-view";

describe("radio preview fixtures", () => {
  it("covers every requested state with a consistent snapshot", () => {
    for (const state of PREVIEW_STATES) {
      const bootstrap = previewBootstrap(state);
      const snapshot = previewSnapshot(state);
      if (snapshot.genreId !== null) expect(bootstrap.genres.some((genre) => genre.id === snapshot.genreId)).toBe(true);
      if (snapshot.status === "error") expect(snapshot.errorCode).not.toBeNull();
      else expect(snapshot.errorCode).toBeNull();
      expect(snapshot.upcoming.length).toBeLessThanOrEqual(3);
    }
    for (const state of ["idle", "playing", "paused", "blocked", "buffering", "network", "empty", "no-genres"]) {
      expect(isPreviewState(state)).toBe(true);
    }
    expect(isPreviewState("nope")).toBe(false);
  });

  it("uses the design's example data only in fixtures", () => {
    const bootstrap = previewBootstrap("playing");
    expect(bootstrap.business.stationName).toBe("EmeraldBar Radio");
    expect(bootstrap.genres.map((genre) => genre.name)).toEqual(["House", "Deep House", "Lounge", "Jazz", "Balkan Hits", "Chillout"]);
    expect(previewSnapshot("playing").current).toMatchObject({ title: "Afterglow", artist: "Frekvencija Sessions" });
    expect(previewBootstrap("no-genres").genres).toEqual([]);
    expect(hasPlayableGenre(previewBootstrap("no-music").genres)).toBe(false);
    expect(previewBootstrap("no-voice").announcements).toEqual([]);
  });

  it("reacts to the controls like a tiny engine", () => {
    const idle = previewSnapshot("idle");
    const playing = applyPreviewCommand(idle, { type: "play" });
    expect(playing).toMatchObject({ status: "playing", hasStarted: true, message: "Playing: Afterglow – Frekvencija Sessions" });
    expect(getPrimaryAction(playing, true).kind).toBe("pause");

    const paused = applyPreviewCommand(playing, { type: "pause" });
    expect(paused).toMatchObject({ status: "paused", message: "Paused" });

    const skipped = applyPreviewCommand(playing, { type: "skip" });
    expect(skipped.current).toMatchObject({ title: "Slow Motion" });
    expect(skipped.upcoming.map((track) => track.title)).toEqual(["Amber Lights", "Night Shift", "Afterglow"]);

    const selected = applyPreviewCommand(paused, { type: "select", genreId: "jazz" });
    expect(selected).toMatchObject({ genreId: "jazz", status: "paused" });
    expect(genreCardState(previewBootstrap("paused").genres[3], selected)).toMatchObject({ selected: true, indicator: "play" });

    expect(applyPreviewCommand(playing, { type: "volume", volume: 2 }).volume).toBe(1);
    expect(applyPreviewCommand(playing, { type: "muted", muted: true }).muted).toBe(true);
  });

  it("follows 'Skip applies to music only' in the station-voice state", () => {
    const voice = previewSnapshot("announcement");
    expect(voice).toMatchObject({ canSkip: false, announcementInProgress: true, current: { kind: "announcement" } });
    expect(applyPreviewCommand(voice, { type: "skip" })).toBe(voice);
    for (const state of PREVIEW_STATES) {
      if (state !== "announcement") expect(previewSnapshot(state).announcementInProgress).toBe(false);
    }
  });

  it("recovers from errors and empty genres the way the engine does", () => {
    const network = previewSnapshot("network");
    expect(applyPreviewCommand(network, { type: "retry" })).toMatchObject({ status: "playing", errorCode: null });
    const empty = previewSnapshot("empty");
    expect(applyPreviewCommand(empty, { type: "play" })).toBe(empty);
    expect(applyPreviewCommand(empty, { type: "select", genreId: "house" })).toMatchObject({ status: "paused", genreId: "house" });
  });
});
