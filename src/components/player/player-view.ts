/**
 * Pure view logic for the venue player (no React, no DOM): how an engine snapshot is presented and
 * which command a control runs. Shared by the /radio screen, the persistent player bar, the account
 * and help pages, the dev lab and the dev previews, and unit-tested in tests/player-ui.
 */
import type { AnnouncementSummary, PlayerBootstrap, PlayerGenre } from "@/lib/api/contracts";
import { clamp01 } from "@/lib/player/runtime";
import type {
  EngineConfig,
  NowPlaying,
  PlayerCommands,
  PlayerErrorCode,
  PlayerSnapshot,
  PlayerStatus,
} from "@/lib/player/types";

// ---------------------------------------------------------------------------
// Fixed copy (docs/REDESIGN.md §6, design/CLAUDE-HANDOFF.md "states")
// ---------------------------------------------------------------------------

/** Shown when the browser refused to play without a click/tap. */
export const BLOCKED_COPY = "Tap to resume your radio.";

/** Empty catalogue (no genres, or no genre with music). */
export const NO_MUSIC_COPY = "No music available yet.";

/** Station voice card without any approved clip. */
export const NO_VOICE_CLIP_COPY = "No approved announcement yet — music plays without voice clips.";

/** Where "Log in again" goes after the session expired: the login page explains why and returns here. */
export const SESSION_EXPIRED_LOGIN_PATH = "/login?error=session_expired&next=%2Fradio";

/** Why Skip does nothing during an announcement (design/CLAUDE-HANDOFF.md §03/04: Skip applies to music only). */
export const SKIP_MUSIC_ONLY_COPY = "Skip is available during music.";

// ---------------------------------------------------------------------------
// Bootstrap → engine configuration
// ---------------------------------------------------------------------------

/**
 * Genre selected when the player loads: the saved preference if it is still offered and has tracks,
 * otherwise the first genre with tracks (so "Start Radio" works straight away), otherwise the saved
 * preference if it still exists, otherwise none.
 */
export function resolveInitialGenreId(genres: readonly PlayerGenre[], preferredGenreId: string | null): string | null {
  const preferred = preferredGenreId === null ? undefined : genres.find((genre) => genre.id === preferredGenreId);
  if (preferred && preferred.trackCount > 0) return preferred.id;
  const firstPlayable = genres.find((genre) => genre.trackCount > 0);
  if (firstPlayable) return firstPlayable.id;
  return preferred?.id ?? null;
}

export function hasPlayableGenre(genres: readonly PlayerGenre[]): boolean {
  return genres.some((genre) => genre.trackCount > 0);
}

export function toEngineConfig(bootstrap: PlayerBootstrap): EngineConfig {
  const { business, preferences } = bootstrap;
  return {
    userId: bootstrap.userId,
    businessId: business.id,
    stationName: business.stationName,
    businessName: business.name,
    logoUrl: business.logoUrl,
    initialGenreId: resolveInitialGenreId(bootstrap.genres, preferences.genreId),
    initialVolume: clamp01(preferences.volume),
    initialMuted: preferences.muted,
    announcementEveryNTracks: business.announcementEveryNTracks,
    announcementVolume: business.announcementVolume,
  };
}

/**
 * The snapshot shown before the engine exists (server render and the first client render). It
 * matches what a freshly constructed PlayerEngine reports, so nothing jumps when the engine attaches.
 */
export function createIdleSnapshot(init: { genreId: string | null; volume: number; muted: boolean }): PlayerSnapshot {
  return {
    status: "idle",
    genreId: init.genreId,
    current: null,
    positionSeconds: 0,
    durationSeconds: null,
    volume: clamp01(init.volume),
    muted: init.muted,
    message: init.genreId === null ? "Choose a genre to start the radio." : null,
    errorCode: null,
    notice: null,
    hasStarted: false,
    tracksSinceAnnouncement: 0,
    tracksUntilAnnouncement: null,
    upcoming: [],
    canSkip: false,
    announcementInProgress: false,
    volumeControllable: true,
  };
}

// ---------------------------------------------------------------------------
// Main (play/pause) action
// ---------------------------------------------------------------------------

export type PrimaryActionKind = "start" | "pause" | "resume" | "unblock" | "retry" | "none";

export interface PrimaryAction {
  kind: PrimaryActionKind;
  /** Visible/accessible label; it changes with the state (so the button never uses aria-pressed). */
  label: string;
  disabled: boolean;
}

/** Statuses in which the listener wants audio and the engine is producing or fetching it. */
export function isAudioActive(status: PlayerStatus): boolean {
  return status === "playing" || status === "buffering" || status === "loading";
}

/** Errors a plain retry can fix (the others need a sign-in, a reload or another genre). */
export function isRetryableError(code: PlayerErrorCode | null): boolean {
  return code === "catalogue_unavailable" || code === "network" || code === "unknown" || code === null;
}

/**
 * What the big button, the player bar button (and the Space/K shortcut) do right now.
 * @param canStart whether a genre with tracks is selectable at all
 */
export function getPrimaryAction(snapshot: PlayerSnapshot, canStart: boolean): PrimaryAction {
  const { status } = snapshot;
  if (!snapshot.hasStarted || status === "idle") {
    return { kind: "start", label: "Start Radio", disabled: !canStart || snapshot.genreId === null };
  }
  switch (status) {
    case "playing":
    case "buffering":
    case "loading":
      return { kind: "pause", label: "Pause", disabled: false };
    case "paused":
      return { kind: "resume", label: "Play", disabled: false };
    case "blocked":
      return { kind: "unblock", label: "Resume radio", disabled: false };
    case "empty":
      // Nothing to play in this genre: the listener has to pick another one.
      return { kind: "none", label: "Play", disabled: true };
    case "error":
      return isRetryableError(snapshot.errorCode)
        ? { kind: "retry", label: "Retry", disabled: false }
        : { kind: "none", label: "Play", disabled: true };
  }
}

/** Runs the primary action. Call it synchronously from the click/keydown handler (user gesture). */
export function runPrimaryAction(commands: PlayerCommands, kind: PrimaryActionKind): void {
  switch (kind) {
    case "start":
      commands.start();
      return;
    case "pause":
      commands.pause();
      return;
    case "resume":
    case "unblock":
      commands.resume();
      return;
    case "retry":
      commands.retry();
      return;
    case "none":
      return;
  }
}

/**
 * The explicit "Play {genre}" action: select the genre (if it isn't already) and make sure the
 * radio plays. The engine's resume() starts the radio the first time, retries after an error or an
 * empty genre, resumes after a pause or a browser block, and does nothing while already playing.
 * Call it synchronously from the click handler so play() stays inside the user's gesture.
 */
export function playGenre(commands: PlayerCommands, snapshot: Pick<PlayerSnapshot, "genreId">, genreId: string): void {
  if (snapshot.genreId !== genreId) commands.selectGenre(genreId);
  commands.resume();
}

/**
 * Why Skip does nothing right now, when that deserves saying: an announcement is playing or about
 * to play (Skip applies to music only). Null when Skip works or the reason is obvious (not started,
 * stopped, a single-track genre with its own notice).
 */
export function skipUnavailableReason(snapshot: Pick<PlayerSnapshot, "canSkip" | "announcementInProgress" | "current">): string | null {
  if (snapshot.canSkip) return null;
  return snapshot.announcementInProgress || snapshot.current?.kind === "announcement" ? SKIP_MUSIC_ONLY_COPY : null;
}

// ---------------------------------------------------------------------------
// Genre cards
// ---------------------------------------------------------------------------

/** What the right-hand side of a genre card shows. */
export type GenreCardIndicator = "playing" | "loading" | "play" | "none";

export interface GenreCardState {
  /** The engine's current genre (emerald outline, aria-pressed). */
  selected: boolean;
  /** No playable tracks. */
  empty: boolean;
  /** Whether the card body (select) can be pressed; an empty genre stays pressable while selected. */
  selectable: boolean;
  indicator: GenreCardIndicator;
  /**
   * Accessible name of the card's action button, which stays mounted while the indicator changes
   * (so keyboard focus is kept): "Play {genre}", then "{genre} is loading" / "{genre} is playing".
   * Null when the genre has no tracks (no button).
   */
  actionLabel: string | null;
  /** Short state text for the card ("12 tracks", "No tracks yet", "Playing"…). */
  meta: string;
}

/**
 * Card semantics for one genre: "Playing" (with the equaliser) only while that genre is actually
 * playing, a loading indicator while it is being fetched or buffering, otherwise a Play button;
 * genres without tracks are disabled with "No tracks yet".
 */
export function genreCardState(genre: PlayerGenre, snapshot: Pick<PlayerSnapshot, "genreId" | "status">): GenreCardState {
  const selected = genre.id === snapshot.genreId;
  const empty = genre.trackCount <= 0;
  let indicator: GenreCardIndicator = empty ? "none" : "play";
  if (selected && !empty && snapshot.status === "playing") indicator = "playing";
  else if (selected && !empty && (snapshot.status === "loading" || snapshot.status === "buffering")) indicator = "loading";
  return {
    selected,
    empty,
    selectable: !empty || selected,
    indicator,
    actionLabel: GENRE_ACTION_LABELS[indicator](genre.name),
    meta: formatTrackCount(genre.trackCount),
  };
}

const GENRE_ACTION_LABELS: Record<GenreCardIndicator, (name: string) => string | null> = {
  play: (name) => `Play ${name}`,
  loading: (name) => `${name} is loading`,
  playing: (name) => `${name} is playing`,
  none: () => null,
};

// ---------------------------------------------------------------------------
// Station voice + coming up
// ---------------------------------------------------------------------------

/**
 * The clip shown (and previewed) on the "Your station voice" card: a rotation clip (the one heard
 * between songs) when there is one, otherwise the welcome clip, otherwise none.
 */
export function pickVoiceClip(announcements: readonly AnnouncementSummary[]): AnnouncementSummary | null {
  return (
    announcements.find((clip) => clip.placement === "rotation" || clip.placement === "both") ??
    announcements.find((clip) => clip.placement === "welcome") ??
    null
  );
}

/** "Every 4 songs" badge (the venue's announcement interval). */
export function everyNSongsLabel(everyNTracks: number): string {
  const n = Math.max(1, Math.round(Number.isFinite(everyNTracks) ? everyNTracks : 1));
  return n === 1 ? "After every song" : `Every ${n} songs`;
}

/**
 * Small note under "Coming up": when the station voice is next heard. Null when there is nothing
 * honest to say (no rotation clip, not started, stopped, or the voice is playing right now).
 */
export function stationVoiceCountdown(
  snapshot: Pick<PlayerSnapshot, "tracksUntilAnnouncement" | "hasStarted" | "status" | "current">,
): string | null {
  const remaining = snapshot.tracksUntilAnnouncement;
  if (remaining === null || !snapshot.hasStarted) return null;
  if (snapshot.status === "idle" || snapshot.status === "error" || snapshot.status === "empty") return null;
  if (snapshot.current?.kind === "announcement") return null;
  if (snapshot.current?.kind === "track") {
    return remaining <= 1 ? "Station voice after this song" : `Station voice after ${remaining} more songs`;
  }
  return remaining <= 0 ? "Station voice up next" : `Station voice after ${remaining} more songs`;
}

/** Text of the read-only "Coming up" list when it has no entries. */
export function comingUpEmptyText(snapshot: Pick<PlayerSnapshot, "status" | "hasStarted" | "genreId">): string {
  if (snapshot.genreId === null) return "Choose a genre to see what's coming up.";
  if (!snapshot.hasStarted || snapshot.status === "idle") return "Start the radio to see the next songs.";
  switch (snapshot.status) {
    case "loading":
    case "buffering":
      return "Choosing the next songs…";
    case "empty":
      return "No songs in this genre yet.";
    case "error":
      return "Nothing is queued while playback is stopped.";
    default:
      return "The next songs appear here shortly.";
  }
}

// ---------------------------------------------------------------------------
// Status presentation
// ---------------------------------------------------------------------------

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const ERROR_LABELS: Record<PlayerErrorCode, string> = {
  catalogue_unavailable: "Can't play",
  network: "Connection lost",
  auth_expired: "Signed out",
  business_inactive: "Venue inactive",
  genre_unavailable: "Genre unavailable",
  unknown: "Error",
};

/** Short label for a status badge. */
export function statusLabel(snapshot: PlayerSnapshot): string {
  switch (snapshot.status) {
    case "idle":
      return snapshot.genreId === null ? "Choose a genre" : "Ready";
    case "loading":
      return "Loading…";
    case "playing":
      return "Playing";
    case "paused":
      return "Paused";
    case "buffering":
      return "Buffering…";
    case "blocked":
      return "Audio blocked";
    case "empty":
      return "No tracks";
    case "error":
      return ERROR_LABELS[snapshot.errorCode ?? "unknown"];
  }
}

export function statusTone(snapshot: PlayerSnapshot): StatusTone {
  switch (snapshot.status) {
    case "playing":
      return "success";
    case "loading":
    case "buffering":
      return "info";
    case "blocked":
    case "empty":
      return "warning";
    case "error":
      return snapshot.errorCode === "network" ? "warning" : "danger";
    case "idle":
    case "paused":
      return "neutral";
  }
}

/**
 * The sentence for a status line. Uses the engine's own message (which only changes on
 * transitions, never with the playback position) and fills the idle gaps.
 */
export function statusMessage(snapshot: PlayerSnapshot, options: { hasGenres: boolean }): string {
  if (!options.hasGenres) return "No genres are available for this venue yet.";
  if (snapshot.status === "blocked") return BLOCKED_COPY;
  if (snapshot.message) return snapshot.message;
  if (snapshot.status === "idle") {
    return snapshot.genreId === null ? "Choose a genre to start the radio." : "Ready. Press Start Radio to begin.";
  }
  return statusLabel(snapshot);
}

export interface ViewContext {
  /** The venue has at least one genre. */
  hasGenres: boolean;
  /** At least one genre has playable tracks. */
  canStart: boolean;
}

/**
 * Text of the persistent player's polite live region: state transitions and the now-playing title
 * only (never the position). "Tap to resume your radio." for a browser block; "No music available
 * yet." when nothing can play.
 */
export function liveStatusText(snapshot: PlayerSnapshot, context: ViewContext): string {
  if (!context.hasGenres || (!context.canStart && !snapshot.hasStarted)) return NO_MUSIC_COPY;
  return statusMessage(snapshot, { hasGenres: context.hasGenres });
}

export interface HeroStatus {
  text: string;
  tone: StatusTone;
  /** Loading or buffering: show a spinner. */
  busy: boolean;
}

/** The visible one-line status next to the big play button (not a live region). */
export function heroStatus(snapshot: PlayerSnapshot, context: ViewContext): HeroStatus | null {
  if (!context.hasGenres || (!context.canStart && !snapshot.hasStarted)) return null;
  switch (snapshot.status) {
    case "idle":
      return {
        text: snapshot.genreId === null ? "Choose a genre to start the radio." : "Ready when you are.",
        tone: "neutral",
        busy: false,
      };
    case "loading":
      return { text: "Loading…", tone: "info", busy: true };
    case "buffering":
      return { text: "Buffering… the music continues in a moment.", tone: "info", busy: true };
    case "playing":
      return { text: "Playing", tone: "success", busy: false };
    case "paused":
      return { text: "Paused", tone: "neutral", busy: false };
    case "blocked":
      return { text: BLOCKED_COPY, tone: "warning", busy: false };
    case "empty":
      return { text: "No tracks in this genre yet.", tone: "warning", busy: false };
    case "error":
      return { text: describePlayerError(snapshot.errorCode, snapshot.message).title, tone: statusTone(snapshot), busy: false };
  }
}

export interface NowPlayingView {
  kind: "track" | "announcement";
  title: string;
  /** Artist for tracks; the station name for announcements. */
  subtitle: string;
  /** One line for compact places and the document outline: "Title — Artist". */
  line: string;
}

export function describeNowPlaying(current: NowPlaying | null, stationName: string): NowPlayingView | null {
  if (!current) return null;
  if (current.kind === "track") {
    return { kind: "track", title: current.title, subtitle: current.artist, line: `${current.title} — ${current.artist}` };
  }
  return { kind: "announcement", title: current.label, subtitle: stationName, line: current.label };
}

export interface HeroView {
  /** Small uppercase label ("Now playing", "Paused"…), written in sentence case. */
  eyebrow: string;
  /** The large line: the genre name, or a state headline when there is no genre. */
  heading: string;
  /** Track title, announcement label, or null. */
  title: string | null;
  /** Artist, station name, or a short explanation. */
  subtitle: string | null;
}

export interface HeroContext extends ViewContext {
  genre: PlayerGenre | null;
  stationName: string;
}

/** Text of the now-playing hero card for every state. */
export function describeHero(snapshot: PlayerSnapshot, context: HeroContext): HeroView {
  const { genre, stationName } = context;
  if (!context.hasGenres) {
    return {
      eyebrow: "Your station",
      heading: NO_MUSIC_COPY,
      title: null,
      subtitle: "No genres have been added for this venue yet. Your administrator can assign them.",
    };
  }
  if (!context.canStart && !snapshot.hasStarted) {
    return {
      eyebrow: "Your station",
      heading: NO_MUSIC_COPY,
      title: null,
      subtitle: "Your genres don't have any music yet. The radio is ready as soon as your administrator adds songs.",
    };
  }
  const heading = genre?.name ?? stationName;
  const now = describeNowPlaying(snapshot.current, stationName);
  if (now && snapshot.status !== "error" && snapshot.status !== "empty") {
    const eyebrow = snapshot.status === "paused" || snapshot.status === "blocked" ? "Paused" : "Now playing";
    return { eyebrow, heading, title: now.title, subtitle: now.subtitle };
  }
  if (!snapshot.hasStarted || snapshot.status === "idle") {
    return genre
      ? { eyebrow: "Ready to play", heading: genre.name, title: null, subtitle: genre.description }
      : { eyebrow: "Ready to play", heading: "Choose a genre", title: null, subtitle: "Pick the sound for your space below." };
  }
  switch (snapshot.status) {
    case "loading":
    case "buffering":
      return { eyebrow: "Tuning in", heading, title: null, subtitle: genre ? `Loading ${genre.name}…` : "Loading…" };
    case "paused":
      return { eyebrow: "Paused", heading, title: null, subtitle: genre ? `Press play to continue ${genre.name}.` : "Press play to continue." };
    case "blocked":
      return { eyebrow: "Paused", heading, title: null, subtitle: BLOCKED_COPY };
    case "empty":
      return { eyebrow: "No tracks yet", heading, title: null, subtitle: "There are no tracks in this genre yet." };
    case "playing":
      return { eyebrow: "Now playing", heading, title: null, subtitle: null };
    case "error":
      return { eyebrow: "Playback stopped", heading, title: null, subtitle: null };
  }
}

/** Title/subtitle for the persistent player bar. */
export function describeBarItem(
  snapshot: PlayerSnapshot,
  context: ViewContext & { genre: PlayerGenre | null; stationName: string },
): { title: string; subtitle: string } {
  const now = describeNowPlaying(snapshot.current, context.stationName);
  if (now) return { title: now.title, subtitle: now.subtitle };
  if (!context.hasGenres || (!context.canStart && !snapshot.hasStarted)) {
    return { title: context.stationName, subtitle: NO_MUSIC_COPY };
  }
  const genreName = context.genre?.name ?? null;
  if (snapshot.status === "error") {
    return { title: context.stationName, subtitle: describePlayerError(snapshot.errorCode, snapshot.message).title };
  }
  if (snapshot.status === "blocked") return { title: context.stationName, subtitle: BLOCKED_COPY };
  if (!snapshot.hasStarted || snapshot.status === "idle") {
    return { title: context.stationName, subtitle: genreName ? `${genreName} · Ready to play` : "Choose a genre to start" };
  }
  return { title: context.stationName, subtitle: genreName ? `${genreName} · ${statusLabel(snapshot)}` : statusLabel(snapshot) };
}

export interface ErrorView {
  title: string;
  description: string;
  /** The one thing the listener can do about it. */
  action: "retry" | "sign-in" | "choose-genre" | "reload";
  actionLabel: string;
}

export function describePlayerError(code: PlayerErrorCode | null, engineMessage: string | null): ErrorView {
  switch (code) {
    case "catalogue_unavailable":
      return {
        title: "Tracks in this genre can't be played right now",
        description: "Several tracks in a row failed to load. Try again, or choose another genre.",
        action: "retry",
        actionLabel: "Retry",
      };
    case "network":
      return {
        title: "Connection lost",
        // The engine says whether it is still retrying on its own (bounded backoff) or has given up.
        description: engineMessage?.includes("Retrying")
          ? "Reconnecting automatically… You can also press Retry now."
          : "Check the internet connection and press Retry.",
        action: "retry",
        actionLabel: "Retry now",
      };
    case "auth_expired":
      return {
        title: "Your session has ended",
        description: "Log in again to keep the radio playing. Your genre and volume are saved.",
        action: "sign-in",
        actionLabel: "Log in again",
      };
    case "business_inactive":
      return {
        title: "This venue is not active",
        description: "Playback has stopped because the venue was switched off. Reload the page to see how to reach your administrator.",
        action: "reload",
        actionLabel: "Reload page",
      };
    case "genre_unavailable":
      return {
        title: "This genre is no longer available",
        description: "It may have been removed from your venue. Choose another genre to keep playing.",
        action: "choose-genre",
        actionLabel: "Choose another genre",
      };
    case "unknown":
    case null:
      return {
        title: "Something went wrong",
        description: "Press Retry. If it keeps happening, reload the page.",
        action: "retry",
        actionLabel: "Retry",
      };
  }
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

/** The venue's single initial for avatars ("E" for EmeraldBar), as in the design. */
export function venueInitial(name: string): string {
  const first = Array.from(name.trim()).find((character) => /[\p{L}\p{N}]/u.test(character));
  return first ? first.toLocaleUpperCase("en") : "?";
}

/** 0–1 volume → whole percent for the slider. */
export function volumeToPercent(volume: number): number {
  return Math.round(clamp01(volume) * 100);
}

export function percentToVolume(percent: number): number {
  return clamp01(percent / 100);
}

export function formatTrackCount(count: number): string {
  if (count <= 0) return "No tracks yet";
  return count === 1 ? "1 track" : `${count} tracks`;
}
