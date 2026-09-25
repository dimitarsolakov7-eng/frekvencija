import { useId } from "react";
import { cn } from "@/lib/utils/cn";

export interface ProgressBarProps {
  /** Current value; `null`/`undefined` renders an indeterminate bar (no aria-valuenow). */
  value?: number | null;
  max?: number;
  /** Accessible name, e.g. "Uploading song.mp3". Shown above the bar with `showLabel`. */
  label: string;
  showLabel?: boolean;
  /** Show the value (or `valueText`) at the right of the label row. */
  showValue?: boolean;
  /** Human-readable value, e.g. "3.2 MB of 12 MB"; used for display and aria-valuetext. */
  valueText?: string;
  tone?: "accent" | "danger";
  size?: "sm" | "md";
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showLabel = false,
  showValue = false,
  valueText,
  tone = "accent",
  size = "md",
  className,
}: ProgressBarProps) {
  const labelId = useId();
  const indeterminate = value === null || value === undefined || !Number.isFinite(value);
  const safeMax = max > 0 ? max : 100;
  const clamped = indeterminate ? 0 : Math.min(safeMax, Math.max(0, value));
  const percent = (clamped / safeMax) * 100;
  const displayValue = valueText ?? `${Math.round(percent)}%`;
  const barColor = tone === "danger" ? "bg-danger" : "bg-accent";

  return (
    <div className={cn("grid gap-1.5", className)}>
      {(showLabel || showValue) && (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span id={labelId} className={cn("min-w-0 truncate text-fg", !showLabel && "sr-only")}>
            {label}
          </span>
          {showValue && !indeterminate && (
            <span aria-hidden="true" className="shrink-0 text-fg-muted tabular-nums">
              {displayValue}
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-labelledby={showLabel || showValue ? labelId : undefined}
        aria-label={showLabel || showValue ? undefined : label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={indeterminate ? undefined : clamped}
        aria-valuetext={indeterminate ? undefined : displayValue}
        className={cn("relative w-full overflow-hidden rounded-full bg-surface-3", size === "sm" ? "h-1.5" : "h-2.5")}
      >
        {indeterminate ? (
          <div
            className={cn(
              "absolute inset-y-0 left-0 w-1/3 rounded-full motion-safe:animate-progress-indeterminate",
              "motion-reduce:w-full motion-reduce:opacity-40",
              barColor,
            )}
          />
        ) : (
          <div
            className={cn("h-full rounded-full transition-[width] duration-300 ease-out", barColor)}
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </div>
  );
}
