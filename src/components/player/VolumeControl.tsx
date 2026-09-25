"use client";

import { Volume1, Volume2, VolumeX } from "lucide-react";
import { IconButton, Slider } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { percentToVolume, volumeToPercent } from "./player-view";

export interface VolumeControlProps {
  /** 0–1 master volume. */
  volume: number;
  muted: boolean;
  /** False where element volume is read-only (iPhone/iPad): the slider is replaced by an explanation. */
  controllable: boolean;
  onVolumeChange(volume: number): void;
  onMutedChange(muted: boolean): void;
  /** `compact`: player bar (ghost mute button, short slider, one-line note). `full`: sheets and pages. */
  variant?: "compact" | "full";
  className?: string;
}

/** Explanation shown instead of the slider where the device controls the volume itself. */
export const DEVICE_VOLUME_NOTE =
  "This device sets the volume itself (for example an iPhone or iPad). Use its volume buttons; Mute still works here.";

/** Mute toggle (fixed label + aria-pressed) and a volume slider with a percentage value text. */
export function VolumeControl({
  volume,
  muted,
  controllable,
  onVolumeChange,
  onMutedChange,
  variant = "full",
  className,
}: VolumeControlProps) {
  const percent = volumeToPercent(volume);
  const icon = muted || percent === 0 ? <VolumeX /> : percent < 50 ? <Volume1 /> : <Volume2 />;
  const compact = variant === "compact";

  return (
    <div className={cn("flex min-w-0 items-center", compact ? "gap-2" : "flex-wrap gap-x-4 gap-y-2", className)}>
      <IconButton
        aria-label="Mute"
        aria-pressed={muted}
        variant={compact ? "ghost" : "secondary"}
        size={compact ? "md" : "lg"}
        icon={icon}
        onClick={() => onMutedChange(!muted)}
        className="aria-pressed:text-warning"
      />
      {controllable ? (
        <Slider
          label="Volume"
          hideLabel
          showValue={!compact}
          min={0}
          max={100}
          step={1}
          value={percent}
          formatValue={(value) => (muted ? `${value}% (muted)` : `${value}%`)}
          onValueChange={(value) => {
            // Moving the slider while muted is a clear "I want to hear it" signal.
            if (muted && value > 0) onMutedChange(false);
            onVolumeChange(percentToVolume(value));
          }}
          className={compact ? "w-24 md:w-32 xl:w-40" : "min-w-40 flex-1"}
        />
      ) : compact ? (
        <p className="max-w-40 text-xs text-fg-muted text-pretty">Use the device&apos;s volume buttons.</p>
      ) : (
        <p className="min-w-48 flex-1 text-sm text-fg-muted text-pretty">{DEVICE_VOLUME_NOTE}</p>
      )}
    </div>
  );
}
