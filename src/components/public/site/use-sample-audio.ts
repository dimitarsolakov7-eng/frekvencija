import { useCallback, useEffect, useRef, useState } from "react";
import { announceSamplePlayback, subscribeToOtherSamples } from "@/lib/public/audio-bus";

export type SampleStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface SampleAudio {
  status: SampleStatus;
  /** 0–1 position in the clip (0 while nothing has played). */
  progress: number;
  /** 0–1. */
  volume: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stop: () => void;
  setVolume: (volume: number) => void;
  /**
   * Per-bar levels (0–1) for a waveform, from a Web Audio analyser while the clip plays. Null when
   * nothing plays or the analyser is unavailable, so a visualisation can only ever move with real
   * audio.
   */
  readLevels: (bars: number) => Float32Array | null;
}

const BAR_SMOOTHING = 0.72;

/**
 * Controls one demo clip on the public website. The <audio> element is created on the first play (a
 * user gesture: nothing autoplays), only one sample plays at a time across the page, and the status
 * follows the element's own events, so "playing" is never shown while nothing is heard.
 */
export function useSampleAudio(id: string, src: string | null): SampleAudio {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const [status, setStatus] = useState<SampleStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [volume, setVolumeState] = useState(0.8);

  const ensureAudio = useCallback((): HTMLAudioElement | null => {
    if (!src || typeof window === "undefined") return null;
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.preload = "none";
    audio.src = src;
    audio.volume = volume;
    audio.addEventListener("playing", () => setStatus("playing"));
    audio.addEventListener("waiting", () => setStatus("loading"));
    audio.addEventListener("pause", () => {
      if (!audio.ended) setStatus("paused");
    });
    audio.addEventListener("ended", () => {
      setStatus("idle");
      setProgress(0);
    });
    audio.addEventListener("error", () => setStatus("error"));
    audio.addEventListener("timeupdate", () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
      setProgress(duration ? Math.min(1, audio.currentTime / duration) : 0);
    });
    audioRef.current = audio;
    return audio;
  }, [src, volume]);

  /** Attaches a Web Audio analyser for the waveform. Best effort: playback works without it. */
  const ensureAnalyser = useCallback((audio: HTMLAudioElement) => {
    if (analyserRef.current || typeof window === "undefined") return;
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    try {
      const context = new Context();
      const source = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyser.connect(context.destination);
      contextRef.current = context;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch {
      analyserRef.current = null;
    }
  }, []);

  const play = useCallback(() => {
    const audio = ensureAudio();
    if (!audio) return;
    announceSamplePlayback(id);
    ensureAnalyser(audio);
    void contextRef.current?.resume().catch(() => undefined);
    setStatus("loading");
    audio.play().catch(() => setStatus("error"));
  }, [ensureAnalyser, ensureAudio, id]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setProgress(0);
    setStatus("idle");
  }, []);

  const toggle = useCallback(() => {
    if (status === "playing" || status === "loading") pause();
    else play();
  }, [pause, play, status]);

  const setVolume = useCallback((next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
  }, []);

  const readLevels = useCallback(
    (bars: number): Float32Array | null => {
      const analyser = analyserRef.current;
      const data = dataRef.current;
      if (status !== "playing" || !analyser || !data) return null;
      analyser.getByteFrequencyData(data);
      const levels = new Float32Array(bars);
      // Spread the bins over the bars (lower frequencies carry most of the music, so skip the very top).
      const usable = Math.max(bars, Math.floor(data.length * 0.75));
      const perBar = usable / bars;
      for (let bar = 0; bar < bars; bar++) {
        const start = Math.floor(bar * perBar);
        const end = Math.max(start + 1, Math.floor((bar + 1) * perBar));
        let sum = 0;
        for (let bin = start; bin < end; bin++) sum += data[bin] ?? 0;
        levels[bar] = Math.min(1, (sum / (end - start) / 255) * 1.25);
      }
      return levels;
    },
    [status],
  );

  useEffect(() => subscribeToOtherSamples(id, pause), [id, pause]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      void contextRef.current?.close().catch(() => undefined);
    };
  }, []);

  return { status, progress, volume, play, pause, toggle, stop, setVolume, readLevels };
}

/** Exponential smoothing for bar heights between analyser frames. */
export function smoothLevel(previous: number, next: number): number {
  return previous * BAR_SMOOTHING + next * (1 - BAR_SMOOTHING);
}
