import { describe, expect, it, vi } from "vitest";
import {
  BLOCKED_COPY,
  NO_MUSIC_COPY,
  SESSION_EXPIRED_LOGIN_PATH,
  comingUpEmptyText,
  createIdleSnapshot,
  describeBarItem,
  describeHero,
  describeNowPlaying,
  describePlayerError,
  everyNSongsLabel,
  formatTrackCount,
  genreCardState,
  getPrimaryAction,
  hasPlayableGenre,
  heroStatus,
  isAudioActive,
  liveStatusText,
  percentToVolume,
  pickVoiceClip,
  playGenre,
  resolveInitialGenreId,
  runPrimaryAction,
  SKIP_MUSIC_ONLY_COPY,
  skipUnavailableReason,
  stationVoiceCountdown,
  statusLabel,
  statusMessage,
  statusTone,
  toEngineConfig,
  venueInitial,
  volumeToPercent,
} from "@/components/player/player-view";
import type { AnnouncementSummary, PlayerBootstrap, PlayerGenre } from "@/lib/api/contracts";
import type { PlayerCommands, PlayerErrorCode, PlayerSnapshot } from "@/lib/player/types";

const genre = (id: string, trackCount: number, extra: Partial<PlayerGenre> = {}): PlayerGenre => ({
  id,
  name: `Genre ${id}`,
  slug: id,
  description: null,
  trackCount,
  coverUrl: null,
  ...extra,
});

const base = createIdleSnapshot({ genreId: "g1", volume: 0.8, muted: false });
const snap = (overrides: Partial<PlayerSnapshot>): PlayerSnapshot => ({ ...base, ...overrides });
const started = (overrides: Partial<PlayerSnapshot>): PlayerSnapshot => snap({ hasStarted: true, ...overrides });
const track = { kind: "track", id: "t", title: "Afterglow", artist: "Frekvencija Sessions", durationSeconds: 248 } as const;
const announcement = { kind: "announcement", id: "a", label: "Station announcement", durationSeconds: 4 } as const;

function commandsMock() {
  return {
    start: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    resume: vi.fn<() => void>(),
    togglePlay: vi.fn<() => void>(),
    skip: vi.fn<() => void>(),
    selectGenre: vi.fn<(genreId: string) => void>(),
    setVolume: vi.fn<(volume: number) => void>(),
    setMuted: vi.fn<(muted: boolean) => void>(),
    retry: vi.fn<() => void>(),
    destroy: vi.fn<() => void>(),
  } satisfies PlayerCommands;
}

function bootstrap(overrides: Partial<PlayerBootstrap> = {}): PlayerBootstrap {
  return {
    userId: "user-1",
    business: {
      id: "biz-1",
      name: "EmeraldBar",
      stationName: "EmeraldBar Radio",
      type: "bar",
      logoUrl: "https://example.test/logo.png",
      language: "en",
      announcementEveryNTracks: 3,
      announcementVolume: 0.7,
    },
    genres: [genre("g1", 4), genre("g2", 0)],
    preferences: { genreId: null, volume: 0.6, muted: true },
    announcementCounts: { welcome: 1, rotation: 2 },
    announcements: [],
    support: { email: null, phone: null },
    ...overrides,
  };
}

describe("resolveInitialGenreId", () => {
  it("keeps the saved genre when it is offered and has tracks", () => {
    expect(resolveInitialGenreId([genre("a", 2), genre("b", 3)], "b")).toBe("b");
  });

  it("falls back to the first genre with tracks when the saved one is empty, missing or unset", () => {
    const genres = [genre("empty", 0), genre("a", 2), genre("b", 3)];
    expect(resolveInitialGenreId(genres, "empty")).toBe("a");
    expect(resolveInitialGenreId(genres, "gone")).toBe("a");
    expect(resolveInitialGenreId(genres, null)).toBe("a");
  });

  it("keeps an existing (empty) saved genre when nothing has tracks, and null when nothing is offered", () => {
    expect(resolveInitialGenreId([genre("a", 0), genre("b", 0)], "b")).toBe("b");
    expect(resolveInitialGenreId([genre("a", 0)], null)).toBeNull();
    expect(resolveInitialGenreId([], "a")).toBeNull();
  });
});

describe("toEngineConfig / createIdleSnapshot", () => {
  it("maps the bootstrap onto the engine configuration", () => {
    expect(toEngineConfig(bootstrap())).toEqual({
      userId: "user-1",
      businessId: "biz-1",
      stationName: "EmeraldBar Radio",
      businessName: "EmeraldBar",
      logoUrl: "https://example.test/logo.png",
      initialGenreId: "g1",
      initialVolume: 0.6,
      initialMuted: true,
      announcementEveryNTracks: 3,
      announcementVolume: 0.7,
    });
  });

  it("clamps an out-of-range saved volume", () => {
    expect(toEngineConfig(bootstrap({ preferences: { genreId: null, volume: 7, muted: false } })).initialVolume).toBe(1);
    expect(toEngineConfig(bootstrap({ preferences: { genreId: null, volume: -1, muted: false } })).initialVolume).toBe(0);
  });

  it("builds the same idle snapshot a fresh engine reports, with an empty upcoming list", () => {
    expect(createIdleSnapshot({ genreId: null, volume: 0.5, muted: false })).toMatchObject({
      status: "idle",
      genreId: null,
      hasStarted: false,
      canSkip: false,
      announcementInProgress: false,
      volumeControllable: true,
      upcoming: [],
      message: "Choose a genre to start the radio.",
    });
    expect(createIdleSnapshot({ genreId: "g1", volume: 0.5, muted: true })).toMatchObject({ message: null, muted: true });
  });

  it("detects whether any genre can play", () => {
    expect(hasPlayableGenre([genre("a", 0), genre("b", 1)])).toBe(true);
    expect(hasPlayableGenre([genre("a", 0)])).toBe(false);
    expect(hasPlayableGenre([])).toBe(false);
  });
});

describe("getPrimaryAction", () => {
  it("offers Start Radio before the first start, disabled without a playable genre", () => {
    expect(getPrimaryAction(base, true)).toEqual({ kind: "start", label: "Start Radio", disabled: false });
    expect(getPrimaryAction(base, false).disabled).toBe(true);
    expect(getPrimaryAction(snap({ genreId: null }), true).disabled).toBe(true);
  });

  it("changes its label with the playback state", () => {
    for (const status of ["playing", "buffering", "loading"] as const) {
      expect(getPrimaryAction(started({ status }), true)).toMatchObject({ kind: "pause", label: "Pause" });
    }
    expect(getPrimaryAction(started({ status: "paused" }), true)).toMatchObject({ kind: "resume", label: "Play" });
    expect(getPrimaryAction(started({ status: "blocked" }), true)).toMatchObject({ kind: "unblock", label: "Resume radio" });
  });

  it("offers Retry only for errors a retry can fix", () => {
    const retryable: PlayerErrorCode[] = ["catalogue_unavailable", "network", "unknown"];
    for (const errorCode of retryable) {
      expect(getPrimaryAction(started({ status: "error", errorCode }), true)).toMatchObject({ kind: "retry", disabled: false });
    }
    const other: PlayerErrorCode[] = ["auth_expired", "business_inactive", "genre_unavailable"];
    for (const errorCode of other) {
      expect(getPrimaryAction(started({ status: "error", errorCode }), true)).toMatchObject({ kind: "none", disabled: true });
    }
    expect(getPrimaryAction(started({ status: "empty" }), true)).toMatchObject({ kind: "none", disabled: true });
  });

  it("runs the matching engine command", () => {
    const commands = commandsMock();
    runPrimaryAction(commands, "start");
    runPrimaryAction(commands, "pause");
    runPrimaryAction(commands, "resume");
    runPrimaryAction(commands, "unblock");
    runPrimaryAction(commands, "retry");
    runPrimaryAction(commands, "none");
    expect(commands.start).toHaveBeenCalledTimes(1);
    expect(commands.pause).toHaveBeenCalledTimes(1);
    expect(commands.resume).toHaveBeenCalledTimes(2);
    expect(commands.retry).toHaveBeenCalledTimes(1);
    expect(commands.togglePlay).not.toHaveBeenCalled();
  });
});

describe("playGenre (the explicit “Play {genre}” button)", () => {
  it("selects another genre first, then asks the engine to play", () => {
    const commands = commandsMock();
    playGenre(commands, { genreId: "g1" }, "g2");
    expect(commands.selectGenre).toHaveBeenCalledWith("g2");
    expect(commands.resume).toHaveBeenCalledTimes(1);
    expect(commands.selectGenre.mock.invocationCallOrder[0]).toBeLessThan(commands.resume.mock.invocationCallOrder[0]);
  });

  it("does not reselect the current genre (that would restart it) and only resumes", () => {
    const commands = commandsMock();
    playGenre(commands, { genreId: "g1" }, "g1");
    expect(commands.selectGenre).not.toHaveBeenCalled();
    expect(commands.resume).toHaveBeenCalledTimes(1);
    expect(commands.start).not.toHaveBeenCalled();
  });
});

describe("skipUnavailableReason (Skip applies to music only)", () => {
  it("explains a disabled Skip while an announcement plays or is being loaded", () => {
    expect(SKIP_MUSIC_ONLY_COPY).toBe("Skip is available during music.");
    expect(skipUnavailableReason(started({ status: "playing", current: announcement, canSkip: false, announcementInProgress: true }))).toBe(
      SKIP_MUSIC_ONLY_COPY,
    );
    expect(skipUnavailableReason(started({ status: "loading", current: null, canSkip: false, announcementInProgress: true }))).toBe(
      SKIP_MUSIC_ONLY_COPY,
    );
    expect(skipUnavailableReason(started({ status: "paused", current: announcement, canSkip: false }))).toBe(SKIP_MUSIC_ONLY_COPY);
  });

  it("says nothing when Skip works or the reason is obvious", () => {
    expect(skipUnavailableReason(started({ status: "playing", current: track, canSkip: true }))).toBeNull();
    expect(skipUnavailableReason(base)).toBeNull();
    expect(skipUnavailableReason(started({ status: "error", errorCode: "network", canSkip: false }))).toBeNull();
    expect(skipUnavailableReason(started({ status: "playing", current: track, canSkip: false, notice: "only one track" }))).toBeNull();
  });
});

describe("genreCardState", () => {
  const house = genre("house", 12, { name: "House" });

  it("marks the selected genre and shows Playing only while it actually plays", () => {
    expect(genreCardState(house, started({ genreId: "house", status: "playing" }))).toMatchObject({
      selected: true,
      indicator: "playing",
      selectable: true,
      meta: "12 tracks",
    });
    for (const status of ["paused", "blocked", "idle", "error"] as const) {
      expect(genreCardState(house, started({ genreId: "house", status })).indicator).toBe("play");
    }
    expect(genreCardState(house, started({ genreId: "house", status: "buffering" })).indicator).toBe("loading");
    expect(genreCardState(house, started({ genreId: "house", status: "loading" })).indicator).toBe("loading");
  });

  it("offers Play on every other genre with tracks, whatever the radio is doing", () => {
    expect(genreCardState(house, started({ genreId: "jazz", status: "playing" }))).toMatchObject({
      selected: false,
      indicator: "play",
      selectable: true,
    });
  });

  it("disables genres without tracks (but keeps the selected one pressable)", () => {
    const empty = genre("pop", 0);
    expect(genreCardState(empty, started({ genreId: "house", status: "playing" }))).toMatchObject({
      empty: true,
      selectable: false,
      indicator: "none",
      actionLabel: null,
      meta: "No tracks yet",
    });
    expect(genreCardState(empty, started({ genreId: "pop", status: "empty" }))).toMatchObject({ selected: true, selectable: true, indicator: "none" });
  });

  it("labels the one action button in every state: Play, then loading, then playing (A11Y-04)", () => {
    expect(genreCardState(house, started({ genreId: "jazz", status: "playing" })).actionLabel).toBe("Play House");
    expect(genreCardState(house, started({ genreId: "house", status: "loading" })).actionLabel).toBe("House is loading");
    expect(genreCardState(house, started({ genreId: "house", status: "buffering" })).actionLabel).toBe("House is loading");
    expect(genreCardState(house, started({ genreId: "house", status: "playing" })).actionLabel).toBe("House is playing");
    expect(genreCardState(house, started({ genreId: "house", status: "paused" })).actionLabel).toBe("Play House");
  });
});

describe("station voice helpers", () => {
  const clip = (id: string, placement: AnnouncementSummary["placement"]): AnnouncementSummary => ({
    id,
    placement,
    durationSeconds: 4,
    text: `Text ${id}`,
  });

  it("prefers a clip heard between songs, then the welcome clip", () => {
    expect(pickVoiceClip([clip("w", "welcome"), clip("r", "rotation")])?.id).toBe("r");
    expect(pickVoiceClip([clip("w", "welcome"), clip("b", "both")])?.id).toBe("b");
    expect(pickVoiceClip([clip("w", "welcome")])?.id).toBe("w");
    expect(pickVoiceClip([])).toBeNull();
  });

  it("labels the announcement interval", () => {
    expect(everyNSongsLabel(4)).toBe("Every 4 songs");
    expect(everyNSongsLabel(1)).toBe("After every song");
    expect(everyNSongsLabel(Number.NaN)).toBe("After every song");
  });

  it("counts down to the station voice only when that is honest", () => {
    expect(stationVoiceCountdown(started({ status: "playing", current: track, tracksUntilAnnouncement: 3 }))).toBe(
      "Station voice after 3 more songs",
    );
    expect(stationVoiceCountdown(started({ status: "paused", current: track, tracksUntilAnnouncement: 1 }))).toBe(
      "Station voice after this song",
    );
    expect(stationVoiceCountdown(started({ status: "loading", current: null, tracksUntilAnnouncement: 0 }))).toBe("Station voice up next");
    expect(stationVoiceCountdown(started({ status: "playing", current: track, tracksUntilAnnouncement: null }))).toBeNull();
    expect(stationVoiceCountdown(snap({ tracksUntilAnnouncement: 2 }))).toBeNull();
    expect(stationVoiceCountdown(started({ status: "error", tracksUntilAnnouncement: 2 }))).toBeNull();
    expect(stationVoiceCountdown(started({ status: "playing", current: announcement, tracksUntilAnnouncement: 4 }))).toBeNull();
  });

  it("explains an empty Coming up list for each state", () => {
    expect(comingUpEmptyText(snap({ genreId: null }))).toMatch(/choose a genre/i);
    expect(comingUpEmptyText(base)).toMatch(/start the radio/i);
    expect(comingUpEmptyText(started({ status: "loading" }))).toMatch(/choosing/i);
    expect(comingUpEmptyText(started({ status: "empty" }))).toMatch(/no songs/i);
    expect(comingUpEmptyText(started({ status: "error" }))).toMatch(/stopped/i);
  });
});

describe("status presentation", () => {
  const context = { hasGenres: true, canStart: true };

  it("labels every status", () => {
    expect(statusLabel(base)).toBe("Ready");
    expect(statusLabel(snap({ genreId: null }))).toBe("Choose a genre");
    expect(statusLabel(started({ status: "loading" }))).toBe("Loading…");
    expect(statusLabel(started({ status: "buffering" }))).toBe("Buffering…");
    expect(statusLabel(started({ status: "playing" }))).toBe("Playing");
    expect(statusLabel(started({ status: "paused" }))).toBe("Paused");
    expect(statusLabel(started({ status: "blocked" }))).toBe("Audio blocked");
    expect(statusLabel(started({ status: "empty" }))).toBe("No tracks");
    expect(statusLabel(started({ status: "error", errorCode: "network" }))).toBe("Connection lost");
    expect(statusLabel(started({ status: "error", errorCode: null }))).toBe("Error");
  });

  it("maps statuses to tones (a network error is a warning, not a failure)", () => {
    expect(statusTone(started({ status: "playing" }))).toBe("success");
    expect(statusTone(started({ status: "buffering" }))).toBe("info");
    expect(statusTone(started({ status: "blocked" }))).toBe("warning");
    expect(statusTone(started({ status: "error", errorCode: "network" }))).toBe("warning");
    expect(statusTone(started({ status: "error", errorCode: "auth_expired" }))).toBe("danger");
    expect(statusTone(base)).toBe("neutral");
  });

  it("uses the engine message for the live region, with the exact blocked and empty-catalogue copy", () => {
    expect(statusMessage(started({ status: "playing", message: "Playing: A – B" }), { hasGenres: true })).toBe("Playing: A – B");
    expect(statusMessage(base, { hasGenres: true })).toBe("Ready. Press Start Radio to begin.");
    expect(statusMessage(snap({ genreId: null, message: null }), { hasGenres: true })).toMatch(/choose a genre/i);
    expect(statusMessage(started({ status: "paused", message: null }), { hasGenres: true })).toBe("Paused");
    expect(liveStatusText(started({ status: "blocked", message: "Audio was blocked by the browser." }), context)).toBe(BLOCKED_COPY);
    expect(BLOCKED_COPY).toBe("Tap to resume your radio.");
    expect(liveStatusText(base, { hasGenres: false, canStart: false })).toBe(NO_MUSIC_COPY);
    expect(liveStatusText(base, { hasGenres: true, canStart: false })).toBe("No music available yet.");
  });

  it("shows a visible (non-live) status line, busy while loading or buffering", () => {
    expect(heroStatus(started({ status: "buffering" }), context)).toMatchObject({ busy: true, text: expect.stringMatching(/^Buffering/) });
    expect(heroStatus(started({ status: "loading" }), context)).toMatchObject({ busy: true });
    expect(heroStatus(started({ status: "blocked" }), context)).toMatchObject({ text: BLOCKED_COPY, tone: "warning" });
    expect(heroStatus(started({ status: "error", errorCode: "network" }), context)).toMatchObject({ text: "Connection lost" });
    expect(heroStatus(started({ status: "playing" }), context)).toMatchObject({ text: "Playing", tone: "success", busy: false });
    expect(heroStatus(base, { hasGenres: false, canStart: false })).toBeNull();
  });

  it("describes tracks and announcements", () => {
    expect(describeNowPlaying(null, "Station")).toBeNull();
    expect(describeNowPlaying(track, "Station")).toEqual({
      kind: "track",
      title: "Afterglow",
      subtitle: "Frekvencija Sessions",
      line: "Afterglow — Frekvencija Sessions",
    });
    expect(describeNowPlaying({ ...announcement, label: "Welcome announcement" }, "EmeraldBar Radio")).toEqual({
      kind: "announcement",
      title: "Welcome announcement",
      subtitle: "EmeraldBar Radio",
      line: "Welcome announcement",
    });
  });

  it("gives every error code a title and one next step", () => {
    expect(describePlayerError("network", "Connection lost. Retrying…")).toMatchObject({
      action: "retry",
      description: expect.stringMatching(/reconnecting automatically/i),
    });
    expect(describePlayerError("network", "Connection lost. Check the internet connection and press Retry.").description).toBe(
      "Check the internet connection and press Retry.",
    );
    expect(describePlayerError("auth_expired", null)).toMatchObject({ action: "sign-in", actionLabel: "Log in again" });
    expect(describePlayerError("genre_unavailable", null).action).toBe("choose-genre");
    expect(describePlayerError("catalogue_unavailable", null).action).toBe("retry");
    expect(describePlayerError("business_inactive", null)).toMatchObject({ action: "reload", title: expect.stringMatching(/not active/i) });
    expect(describePlayerError(null, null).title).toMatch(/something went wrong/i);
    expect(SESSION_EXPIRED_LOGIN_PATH).toBe("/login?error=session_expired&next=%2Fradio");
  });
});

describe("describeHero / describeBarItem", () => {
  const house = genre("house", 12, { name: "House", description: "Uplifting, rhythmic, timeless." });
  const context = { hasGenres: true, canStart: true, genre: house, stationName: "EmeraldBar Radio" };

  it("shows the genre, the track and the artist while playing", () => {
    expect(describeHero(started({ status: "playing", current: track, genreId: "house" }), context)).toEqual({
      eyebrow: "Now playing",
      heading: "House",
      title: "Afterglow",
      subtitle: "Frekvencija Sessions",
    });
    expect(describeHero(started({ status: "paused", current: track }), context).eyebrow).toBe("Paused");
  });

  it("labels announcements as station voice, never as a song", () => {
    expect(describeHero(started({ status: "playing", current: announcement }), context)).toMatchObject({
      heading: "House",
      title: "Station announcement",
      subtitle: "EmeraldBar Radio",
    });
    expect(describeBarItem(started({ status: "playing", current: announcement }), context)).toEqual({
      title: "Station announcement",
      subtitle: "EmeraldBar Radio",
    });
  });

  it("introduces the selected genre before the first start", () => {
    expect(describeHero(base, context)).toEqual({
      eyebrow: "Ready to play",
      heading: "House",
      title: null,
      subtitle: "Uplifting, rhythmic, timeless.",
    });
    expect(describeBarItem(base, context)).toEqual({ title: "EmeraldBar Radio", subtitle: "House · Ready to play" });
  });

  it("says No music available yet when there are no genres or no music", () => {
    expect(describeHero(base, { ...context, hasGenres: false, genre: null }).heading).toBe(NO_MUSIC_COPY);
    expect(describeHero(base, { ...context, canStart: false }).heading).toBe(NO_MUSIC_COPY);
    expect(describeBarItem(base, { ...context, canStart: false }).subtitle).toBe(NO_MUSIC_COPY);
  });

  it("covers loading, blocked, empty and error without a current item", () => {
    expect(describeHero(started({ status: "loading" }), context)).toMatchObject({ eyebrow: "Tuning in", subtitle: "Loading House…" });
    expect(describeHero(started({ status: "blocked" }), context).subtitle).toBe(BLOCKED_COPY);
    expect(describeHero(started({ status: "empty" }), context).eyebrow).toBe("No tracks yet");
    expect(describeHero(started({ status: "error", errorCode: "network", current: track }), context)).toMatchObject({
      eyebrow: "Playback stopped",
      title: null,
    });
    expect(describeBarItem(started({ status: "error", errorCode: "network" }), context).subtitle).toBe("Connection lost");
    expect(describeBarItem(started({ status: "blocked" }), context).subtitle).toBe(BLOCKED_COPY);
  });
});

describe("small helpers", () => {
  it("converts volume to whole percent and back, clamped", () => {
    expect(volumeToPercent(0.804)).toBe(80);
    expect(volumeToPercent(3)).toBe(100);
    expect(volumeToPercent(Number.NaN)).toBe(0);
    expect(percentToVolume(55)).toBe(0.55);
    expect(percentToVolume(150)).toBe(1);
  });

  it("knows which statuses mean audio is wanted", () => {
    expect(["playing", "buffering", "loading"].every((s) => isAudioActive(s as PlayerSnapshot["status"]))).toBe(true);
    expect(["idle", "paused", "blocked", "empty", "error"].some((s) => isAudioActive(s as PlayerSnapshot["status"]))).toBe(false);
  });

  it("uses a single venue initial for avatars", () => {
    expect(venueInitial("EmeraldBar")).toBe("E");
    expect(venueInitial("  hotel Aurora")).toBe("H");
    expect(venueInitial("Čaj & Co")).toBe("Č");
    expect(venueInitial("  ")).toBe("?");
  });

  it("formats track counts", () => {
    expect(formatTrackCount(0)).toBe("No tracks yet");
    expect(formatTrackCount(1)).toBe("1 track");
    expect(formatTrackCount(12)).toBe("12 tracks");
  });
});
