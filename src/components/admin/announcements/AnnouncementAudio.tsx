"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { IconButton, Spinner, Waveform } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";
import { AdminApiError } from "./api";

/**
 * One audio element for the whole announcements page, so only one preview plays at a time
 * (generated clip, on-air recordings, voice samples). Signed URLs are fetched on the first play and
 * cached until shortly before they expire. Nothing here touches a venue's radio.
 */

export interface AudioClip {
  /** Unique per audio version, e.g. `announcement:{id}:{updatedAt}` or `voice:{id}`. */
  key: string;
  /** Resolves a playable URL (signed preview URL, or a provider sample URL). */
  load: () => Promise<{ url: string; expiresAt?: string | null }>;
}

type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface PlaybackState {
  key: string | null;
  status: PlaybackStatus;
  position: number;
  duration: number | null;
  error: string | null;
}

interface AudioContextValue {
  playback: PlaybackState;
  toggle: (clip: AudioClip) => void;
  stop: () => void;
}

const IDLE: PlaybackState = { key: null, status: "idle", position: 0, duration: null, error: null };
/** A cached URL is reused only while it stays valid for at least this long. */
const URL_SAFETY_MS = 60_000;
const BLOCKED_MESSAGE = "Your browser blocked playback. Press play again to listen.";
const FAILED_MESSAGE = "The recording could not be played. Press play to try again.";

const AnnouncementAudioContext = createContext<AudioContextValue | null>(null);

function loadErrorMessage(error: unknown): string {
  return error instanceof AdminApiError ? error.message : "The recording could not be loaded. Press play to try again.";
}

export function AnnouncementAudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const cacheRef = useRef(new Map<string, { url: string; expiresAt: number | null }>());
  const currentKeyRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const [playback, setPlayback] = useState<PlaybackState>(IDLE);

  // Release the element when the page goes away (e.g. switching venues).
  useEffect(() => {
    const element = audioRef.current;
    return () => {
      if (!element) return;
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, []);

  function startPlayback(element: HTMLAudioElement, key: string) {
    element.play().catch((error: unknown) => {
      if (currentKeyRef.current !== key) return;
      const name = error instanceof DOMException ? error.name : "";
      if (name === "AbortError") return;
      if (name === "NotAllowedError") {
        setPlayback((current) => ({ ...current, status: "paused", error: BLOCKED_MESSAGE }));
        return;
      }
      cacheRef.current.delete(key);
      setPlayback((current) => ({ ...current, status: "error", error: FAILED_MESSAGE }));
    });
  }

  function toggle(clip: AudioClip) {
    const element = audioRef.current;
    if (!element) return;
    const same = currentKeyRef.current === clip.key && element.hasAttribute("src");
    if (same && !element.paused) {
      element.pause();
      return;
    }
    if (same && playback.status !== "error") {
      setPlayback((current) => ({ ...current, status: "loading", error: null }));
      startPlayback(element, clip.key);
      return;
    }

    const request = ++requestRef.current;
    element.pause();
    currentKeyRef.current = clip.key;
    const cached = cacheRef.current.get(clip.key);
    if (cached && (cached.expiresAt === null || cached.expiresAt - Date.now() > URL_SAFETY_MS)) {
      setPlayback({ key: clip.key, status: "loading", position: 0, duration: null, error: null });
      element.src = cached.url;
      startPlayback(element, clip.key);
      return;
    }

    // Unlocks the element inside the click (WebKit gates playback per element), then fetches the URL.
    element.removeAttribute("src");
    element.load();
    setPlayback({ key: clip.key, status: "loading", position: 0, duration: null, error: null });
    clip.load().then(
      ({ url, expiresAt }) => {
        if (request !== requestRef.current) return;
        const expires = expiresAt ? Date.parse(expiresAt) : Number.NaN;
        cacheRef.current.set(clip.key, { url, expiresAt: Number.isNaN(expires) ? null : expires });
        element.src = url;
        startPlayback(element, clip.key);
      },
      (error: unknown) => {
        if (request !== requestRef.current) return;
        setPlayback({ key: clip.key, status: "error", position: 0, duration: null, error: loadErrorMessage(error) });
      },
    );
  }

  function stop() {
    const element = audioRef.current;
    requestRef.current += 1;
    currentKeyRef.current = null;
    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    setPlayback(IDLE);
  }

  const update = (patch: Partial<PlaybackState>) => {
    setPlayback((current) => (current.key === currentKeyRef.current ? { ...current, ...patch } : current));
  };

  return (
    <AnnouncementAudioContext.Provider value={{ playback, toggle, stop }}>
      {children}
      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onPlaying={() => update({ status: "playing", error: null })}
        onWaiting={() => update({ status: "loading" })}
        onPause={(event) => {
          if (!event.currentTarget.ended) update({ status: "paused" });
        }}
        onEnded={() => update({ status: "paused", position: 0 })}
        onTimeUpdate={(event) => update({ position: event.currentTarget.currentTime })}
        onDurationChange={(event) => {
          const duration = event.currentTarget.duration;
          if (Number.isFinite(duration) && duration > 0) update({ duration });
        }}
        onError={(event) => {
          // Removing the source to cancel a download is not a failure.
          if (!event.currentTarget.hasAttribute("src")) return;
          const key = currentKeyRef.current;
          if (key) cacheRef.current.delete(key);
          update({ status: "error", error: FAILED_MESSAGE });
        }}
      />
    </AnnouncementAudioContext.Provider>
  );
}

export function useAnnouncementAudio(): AudioContextValue {
  const value = useContext(AnnouncementAudioContext);
  if (!value) throw new Error("useAnnouncementAudio() must be used inside <AnnouncementAudioProvider>.");
  return value;
}

/** Playback state of one clip (idle unless it is the page's current preview). */
export function useClipPlayback(key: string) {
  const { playback, toggle } = useAnnouncementAudio();
  const current = playback.key === key;
  return {
    current,
    status: current ? playback.status : ("idle" as PlaybackStatus),
    position: current ? playback.position : 0,
    duration: current ? playback.duration : null,
    error: current ? playback.error : null,
    toggle,
  };
}

export interface ClipPlayButtonProps {
  clip: AudioClip;
  /** What is played, e.g. "Station identity" → "Play Station identity". */
  label: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "outline";
  disabled?: boolean;
  className?: string;
}

/** Round play/pause button for a clip; its label changes with the state (no aria-pressed). */
export function ClipPlayButton({ clip, label, size = "md", variant = "outline", disabled = false, className }: ClipPlayButtonProps) {
  const { status, toggle } = useClipPlayback(clip.key);
  const playing = status === "playing";
  const loading = status === "loading";
  return (
    <IconButton
      round
      size={size}
      variant={variant}
      disabled={disabled}
      aria-label={playing ? `Pause ${label}` : loading ? `Loading ${label}` : `Play ${label}`}
      icon={loading ? <Spinner size="sm" decorative /> : playing ? <Pause /> : <Play className="translate-x-px" />}
      onClick={() => toggle(clip)}
      className={className}
    />
  );
}

export interface ClipPlayerProps {
  clip: AudioClip;
  label: string;
  /** Duration measured by the server when the audio was validated (seconds). */
  durationSeconds: number | null;
  /** Waveform pattern seed (stable per clip). */
  seed: string;
  disabled?: boolean;
  className?: string;
}

/** Audio preview row of screen 07: emerald play button, waveform with progress, "0:00 / 0:06". */
export function ClipPlayer({ clip, label, durationSeconds, seed, disabled = false, className }: ClipPlayerProps) {
  const playback = useClipPlayback(clip.key);
  const duration = playback.duration ?? durationSeconds;
  const progress = duration && duration > 0 ? Math.min(1, playback.position / duration) : 0;
  return (
    <div className={cn("grid grid-cols-1 gap-2", className)}>
      <div className="flex items-center gap-3 rounded-card border border-border bg-control p-3 sm:gap-4 sm:px-4">
        <ClipPlayButton clip={clip} label={label} variant="primary" size="lg" disabled={disabled} />
        <Waveform
          bars={56}
          seed={seed}
          // Every bar is lit until playback starts; then the played part is lit.
          progress={playback.current && playback.position > 0 ? progress : null}
          // Clipped rather than widening the card on narrow screens.
          className="h-10 w-0 min-w-0 flex-1 overflow-hidden"
        />
        <p className="shrink-0 text-sm text-fg-muted tabular-nums">
          <span className="sr-only">Position </span>
          {formatDuration(playback.position)} / {formatDuration(duration)}
        </p>
      </div>
      {playback.error && (
        <p role="status" className="text-sm text-danger">
          {playback.error}
        </p>
      )}
    </div>
  );
}
