import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type StatusPillTone = "success" | "warning" | "neutral" | "danger" | "info";
export type StatusPillSize = "sm" | "md";

const TONE_CLASSES: Record<StatusPillTone, { pill: string; dot: string }> = {
  success: { pill: "border-accent/35 bg-accent/10", dot: "bg-accent" },
  warning: { pill: "border-warning/40 bg-warning/10", dot: "bg-warning" },
  danger: { pill: "border-danger/40 bg-danger/10", dot: "bg-danger" },
  info: { pill: "border-info/40 bg-info/10", dot: "bg-info" },
  neutral: { pill: "border-border-strong bg-surface-2", dot: "bg-fg-muted" },
};

const SIZE_CLASSES: Record<StatusPillSize, string> = {
  sm: "h-6 gap-1.5 px-2 text-xs",
  md: "h-8 gap-2 px-3 text-sm",
};

export interface StatusPillProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  tone?: StatusPillTone;
  /** The status text ("Active", "Invited", "Draft"…). `children` works too. */
  label?: ReactNode;
  children?: ReactNode;
  size?: StatusPillSize;
}

/**
 * Record status: coloured dot + label in a quiet bordered pill (screens 05–08). The label carries
 * the meaning; the dot colour only reinforces it. Never animates.
 */
export function StatusPill({ tone = "neutral", label, children, size = "md", className, ...props }: StatusPillProps) {
  const toneClasses = TONE_CLASSES[tone];
  return (
    <span
      {...props}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border font-medium whitespace-nowrap text-fg",
        SIZE_CLASSES[size],
        toneClasses.pill,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", toneClasses.dot)} />
      {label ?? children}
    </span>
  );
}
