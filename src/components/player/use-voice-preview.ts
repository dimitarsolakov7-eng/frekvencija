"use client";

/**
 * Drives the station-voice Preview (see voice-preview.ts): pauses the radio, signs the venue's own
 * clip, plays it in a separate <audio> element that the engine never sees, and offers an explicit
 * "Resume radio" afterwards. If the radio starts again from any other control while a preview is
 * loading or playing, the preview stops, so the two never mix; once the radio plays or changes
 * after a preview ended, that preview's panel is gone for good.
 */
import { useEffect, useReducer, useRef, type RefObject } from "react";
import { isAbortError } from "@/lib/player/runtime";
import type { PlayerCommands } from "@/lib/player/types";
import type { PlayerContextValue } from "./PlayerProvider";
import {
  IDLE_VOICE_PREVIEW,
  describeVoicePreview,
  describeVoicePreviewError,
  isVoicePreviewActive,
  voicePreviewRadioEvent,
  voicePreviewReducer,
  type VoicePreviewState,
  type VoicePreviewView,
} from "./voice-preview";

export interface VoicePreviewOptions {
  signAnnouncement: PlayerContextValue["signAnnouncement"];
  commands: Pick<PlayerCommands, "pause" | "resume">;
  /** The engine is producing (or fetching) audio right now. */
  radioActive: boolean;
  /** radioPlaybackKey() of the engine snapshot: any change after a preview ended retires its panel. */
  radioKey: string;
  /** Listener's master volume 0–1 and mute (the preview follows them like the radio would). */
  volume: number;
  muted: boolean;
  /** The venue's announcement gain 0.10–1.00. */
  announcementVolume: number;
}

export interface VoicePreviewControls {
  state: VoicePreviewState;
  view: VoicePreviewView;
  /** Call from the Preview click (the element is unlocked inside the gesture). */
  start(clipId: string): void;
  stop(): void;
  /** Call from the "Resume radio" click (resume() must run inside the gesture). */
  resumeRadio(): void;
  dismiss(): void;
}

interface PreviewRefs {
  audio: RefObject<HTMLAudioElement | null>;
  abort: RefObject<AbortController | null>;
  /** Request id the element currently belongs to; 0 while nothing should play. */
  active: RefObject<number>;
}

/** Stops and releases whatever the preview element is doing (idempotent). */
function silence(refs: PreviewRefs): void {
  refs.abort.current?.abort();
  refs.abort.current = null;
  refs.active.current = 0;
  const el = refs.audio.current;
  if (!el) return;
  try {
    el.pause();
    if (el.hasAttribute("src")) {
      // Cancels the download without firing an error (never `src = ""`).
      el.removeAttribute("src");
      el.load();
    }
  } catch {
    // A media element that refuses to pause has nothing left to stop.
  }
}

function applyVolume(el: HTMLAudioElement, settings: { volume: number; muted: boolean; announcementVolume: number }): void {
  try {
    el.muted = settings.muted;
    el.volume = Math.min(1, Math.max(0, settings.volume * settings.announcementVolume));
  } catch {
    // iPhone/iPad keep element volume read-only; the device buttons apply.
  }
}

export function useVoicePreview(options: VoicePreviewOptions): VoicePreviewControls {
  const [state, dispatch] = useReducer(voicePreviewReducer, IDLE_VOICE_PREVIEW);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef(0);
  const sequenceRef = useRef(0);
  const settingsRef = useRef({ volume: options.volume, muted: options.muted, announcementVolume: options.announcementVolume });
  const refs: PreviewRefs = { audio: audioRef, abort: abortRef, active: activeRef };

  // The radio started again from another control (big button, genre card, keyboard, media keys)
  // while a preview was loading or playing: the preview is over. After a preview ended, any radio
  // playback or change retires its panel (it must never come back when the radio stops later).
  // Adjusting state during render is React's pattern for state that follows a changing input; the
  // effect below silences the element.
  const follow = voicePreviewRadioEvent(state, { active: options.radioActive, key: options.radioKey });
  if (follow) dispatch(follow);

  const active = isVoicePreviewActive(state);
  useEffect(() => {
    if (!active) silence({ audio: audioRef, abort: abortRef, active: activeRef });
  }, [active]);

  const { volume, muted, announcementVolume } = options;
  useEffect(() => {
    settingsRef.current = { volume, muted, announcementVolume };
    const el = audioRef.current;
    if (el) applyVolume(el, settingsRef.current);
  }, [volume, muted, announcementVolume]);

  // Leaving the page (e.g. navigating to Account) ends the preview.
  useEffect(() => () => silence({ audio: audioRef, abort: abortRef, active: activeRef }), []);

  function element(): HTMLAudioElement {
    const existing = audioRef.current;
    if (existing) return existing;
    const el = new Audio();
    el.preload = "auto";
    el.addEventListener("playing", () => {
      const request = activeRef.current;
      if (request) dispatch({ type: "playing", request });
    });
    el.addEventListener("ended", () => {
      const request = activeRef.current;
      if (request) dispatch({ type: "ended", request });
    });
    el.addEventListener("error", () => {
      const request = activeRef.current;
      // Unloading (removeAttribute + load) fires no error; anything else is a real failure.
      if (request && el.hasAttribute("src")) {
        dispatch({ type: "failed", request, message: describeVoicePreviewError({ name: "NotSupportedError" }) });
      }
    });
    audioRef.current = el;
    return el;
  }

  function start(clipId: string): void {
    const radioWasPlaying = options.radioActive;
    // Never mix: the station goes quiet first (a paused engine keeps its place and its counter).
    options.commands.pause();
    silence(refs);
    const request = ++sequenceRef.current;
    activeRef.current = request;
    const controller = new AbortController();
    abortRef.current = controller;
    const el = element();
    // Synchronously inside the click: WebKit only lets an element play after a gesture touched it.
    el.load();
    dispatch({ type: "start", request, clipId, radioWasPlaying });

    options.signAnnouncement(clipId, controller.signal).then(
      (media) => {
        if (controller.signal.aborted || activeRef.current !== request) return;
        el.src = media.url;
        applyVolume(el, settingsRef.current);
        el.play().then(
          () => {
            if (activeRef.current === request) dispatch({ type: "playing", request });
          },
          (error: unknown) => {
            // An AbortError means the preview was stopped or replaced while starting.
            if (activeRef.current !== request || isAbortError(error)) return;
            dispatch({ type: "failed", request, message: describeVoicePreviewError(error) });
          },
        );
      },
      (error: unknown) => {
        if (controller.signal.aborted || activeRef.current !== request) return;
        dispatch({ type: "failed", request, message: describeVoicePreviewError(error) });
      },
    );
  }

  function stop(): void {
    silence(refs);
    dispatch({ type: "stop" });
  }

  function resumeRadio(): void {
    silence(refs);
    options.commands.resume();
    dispatch({ type: "radio-resumed" });
  }

  function dismiss(): void {
    silence(refs);
    dispatch({ type: "dismiss" });
  }

  return { state, view: describeVoicePreview(state, options.radioActive), start, stop, resumeRadio, dismiss };
}
