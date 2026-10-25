"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import { AudioLines, Mic, Pause, Play, RotateCcw, Volume1, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui";
import { waveformHeights } from "@/components/ui/Waveform";
import type { DemoClip } from "@/config/demo-audio";
import type { SiteCopy } from "@/content/site/types";
import { cn } from "@/lib/utils/cn";
import { smoothLevel, useSampleAudio, type SampleStatus } from "./use-sample-audio";

export interface RadioConsoleProps {
  copy: SiteCopy["console"];
  common: Pick<SiteCopy["common"], "exampleBadge">;
  /** The station sample (music with the example announcement), or null when not configured. */
  clip: DemoClip | null;
  /** A prerecorded example announcement, or null. */
  announcementClip: DemoClip | null;
  className?: string;
}

const BARS = 56;

function statusLabel(status: SampleStatus, copy: SiteCopy["console"]): string {
  switch (status) {
    case "playing":
      return copy.statusPlaying;
    case "paused":
      return copy.statusPaused;
    case "loading":
      return copy.statusLoading;
    default:
      return copy.statusReady;
  }
}

/**
 * The website's signature component: a wide radio console with the precision of an audio device.
 * White body, fine borders, strong station typography, a round cobalt play control, a waveform that
 * moves only while audio really plays, volume, and access to a sample announcement. Playback starts
 * only on a tap; without configured demo audio it shows an honest "demo coming soon" state.
 */
export function RadioConsole({ copy, common, clip, announcementClip, className }: RadioConsoleProps) {
  const station = useSampleAudio("console:station", clip?.src ?? null);
  const announcement = useSampleAudio("console:announcement", announcementClip?.src ?? null);
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const levelsRef = useRef<Float32Array>(new Float32Array(BARS));
  const noticeId = useId();
  const restingHeights = waveformHeights(BARS, "frekvencija-console");
  const unavailable = clip === null;
  const playing = station.status === "playing";
  const busy = station.status === "loading";
  const errored = station.status === "error";
  const announcementPlaying = announcement.status === "playing" || announcement.status === "loading";

  // Drive the bars straight from the analyser (no re-renders): real levels when available, otherwise a
  // calm pseudo-motion that still runs only while the clip is audibly playing. At rest the bars settle.
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const real = playing ? station.readLevels(BARS) : null;
      const t = (now - start) / 1000;
      for (let index = 0; index < BARS; index++) {
        const target = playing
          ? real
            ? 0.18 + real[index] * 0.82
            : 0.25 + 0.55 * Math.abs(Math.sin(t * 2.1 + index * 0.37) * Math.cos(t * 0.9 + index * 0.11))
          : 0.22;
        const next = smoothLevel(levelsRef.current[index], target);
        levelsRef.current[index] = next;
        barsRef.current[index]?.style.setProperty("--bar-scale", next.toFixed(3));
      }
      const settled = !playing && levelsRef.current.every((level) => Math.abs(level - 0.22) < 0.005);
      if (!settled) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, station]);

  const volumeIcon = station.volume === 0 ? VolumeX : station.volume < 0.5 ? Volume1 : Volume2;
  const VolumeIcon = volumeIcon;

  return (
    <section
      aria-label={copy.stationName}
      className={cn(
        "relative grid gap-6 rounded-[28px] border border-border bg-surface p-5 shadow-overlay sm:p-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_auto] lg:items-center lg:gap-8 lg:p-8",
        className,
      )}
    >
      {/* Station identity */}
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow text-fg-muted">{copy.eyebrow}</p>
          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-fg-muted uppercase">
            {common.exampleBadge}
          </span>
        </div>
        <p className="display-md truncate text-fg">{copy.stationName}</p>
        <dl className="flex items-center gap-2 text-sm">
          <dt className="text-fg-muted">{copy.genreLabel}</dt>
          <dd className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 font-semibold text-accent-text">
            <AudioLines aria-hidden="true" className="size-3.5" />
            {copy.genre}
          </dd>
        </dl>
        <p className="flex items-center gap-2 text-sm text-fg-muted" aria-live="polite">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 rounded-full",
              playing ? "bg-accent motion-safe:animate-pulse-soft" : busy ? "bg-warning" : errored ? "bg-danger" : "bg-border-strong",
            )}
          />
          {unavailable ? copy.unavailableTitle : errored ? copy.errorBody : statusLabel(station.status, copy)}
        </p>
      </div>

      {/* Waveform + progress */}
      <div className="grid min-w-0 gap-3">
        <div
          aria-hidden="true"
          className="flex h-24 items-center gap-[3px] rounded-[18px] border border-border bg-surface-2/60 px-4 sm:h-28"
        >
          {restingHeights.map((height, index) => (
            <span
              key={index}
              ref={(element) => {
                barsRef.current[index] = element;
              }}
              className={cn("console-bar block min-w-0.5 flex-1 rounded-full", playing ? "bg-accent" : "bg-fg/25")}
              style={{ height: `${Math.round(height * 100)}%`, "--bar-scale": "0.22" } as CSSProperties}
            />
          ))}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(station.progress * 100)}%` }} />
        </div>
        {unavailable ? (
          <p id={noticeId} className="text-sm text-fg-muted text-pretty">
            {copy.unavailableBody}
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <VolumeIcon aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
            <input
              type="range"
              className="ui-range"
              min={0}
              max={100}
              step={1}
              value={Math.round(station.volume * 100)}
              aria-label={copy.volume}
              onChange={(event) => station.setVolume(Number(event.currentTarget.value) / 100)}
              style={{ "--range-progress": `${Math.round(station.volume * 100)}%` } as CSSProperties}
            />
          </div>
        )}
      </div>

      {/* Transport */}
      <div className="flex items-center justify-between gap-4 lg:flex-col lg:items-end lg:justify-center">
        <button
          type="button"
          aria-label={playing || busy ? copy.pause : copy.play}
          aria-describedby={unavailable ? noticeId : undefined}
          disabled={unavailable}
          onClick={errored ? station.play : station.toggle}
          className={cn(
            "grid size-[4.5rem] shrink-0 place-items-center rounded-full bg-accent text-accent-fg shadow-[0_14px_30px_-12px_rgb(45_75_255/0.7)] transition-[transform,background-color] duration-200",
            "hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:size-20",
          )}
        >
          {busy ? (
            <span aria-hidden="true" className="size-6 animate-spin rounded-full border-2 border-accent-fg/40 border-t-accent-fg" />
          ) : errored ? (
            <RotateCcw aria-hidden="true" className="size-7" />
          ) : playing ? (
            <Pause aria-hidden="true" className="size-7 fill-current" />
          ) : (
            <Play aria-hidden="true" className="ml-1 size-7 fill-current" />
          )}
        </button>
        <Button
          variant="outline"
          size="md"
          className="rounded-full!"
          icon={<Mic aria-hidden="true" />}
          disabled={announcementClip === null}
          aria-pressed={announcementPlaying}
          onClick={announcementPlaying ? announcement.stop : announcement.play}
        >
          {announcementPlaying ? copy.stopSample : copy.sampleAnnouncement}
        </Button>
      </div>
    </section>
  );
}
