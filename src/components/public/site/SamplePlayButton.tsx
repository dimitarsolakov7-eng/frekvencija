"use client";

import { Pause, Play } from "lucide-react";
import { Button, type ButtonSize } from "@/components/ui";
import type { DemoClip } from "@/config/demo-audio";
import { cn } from "@/lib/utils/cn";
import { useSampleAudio } from "./use-sample-audio";

export interface SamplePlayButtonProps {
  /** Unique id of this sample on the page (only one sample plays at a time). */
  id: string;
  clip: DemoClip | null;
  label: string;
  stopLabel: string;
  /** Shown instead of the button when no clip is configured. */
  unavailableLabel: string;
  size?: ButtonSize;
  className?: string;
}

/** Play / stop for one configured demo clip; an honest text note when there is none. */
export function SamplePlayButton({ id, clip, label, stopLabel, unavailableLabel, size = "sm", className }: SamplePlayButtonProps) {
  const sample = useSampleAudio(id, clip?.src ?? null);
  if (!clip) {
    return <p className={cn("text-sm text-fg-subtle", className)}>{unavailableLabel}</p>;
  }
  const active = sample.status === "playing" || sample.status === "loading";
  return (
    <Button
      variant="outline"
      size={size}
      className={cn("rounded-full!", className)}
      icon={active ? <Pause aria-hidden="true" className="fill-current" /> : <Play aria-hidden="true" className="fill-current" />}
      aria-pressed={active}
      loading={sample.status === "loading"}
      onClick={active ? sample.stop : sample.play}
    >
      {active ? stopLabel : label}
    </Button>
  );
}
