import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

// Quiet tinted pills (bordered, low-alpha fill); `accent` is the one solid, attention-grabbing tone.
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-border-strong bg-surface-2 text-fg-muted",
  accent: "border-accent bg-accent text-accent-fg",
  success: "border-accent/35 bg-accent/10 text-accent-text",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-danger/35 bg-danger/10 text-danger",
  info: "border-info/35 bg-info/10 text-info",
};

export interface BadgeProps extends ComponentPropsWithRef<"span"> {
  tone?: BadgeTone;
  /** Leading status dot in the tone colour. For record statuses prefer <StatusPill>. */
  dot?: boolean;
}

/** Small label pill (counts, tags, flags). The text must carry the meaning; colour only reinforces it. */
export function Badge({ tone = "neutral", dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
