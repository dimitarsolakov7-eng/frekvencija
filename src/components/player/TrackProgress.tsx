import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";

export interface TrackProgressProps {
  positionSeconds: number;
  durationSeconds: number | null;
  /** Show an indeterminate bar (an item is loading and its length is unknown). */
  loading?: boolean;
  className?: string;
}

/**
 * Read-only position of the current item: a thin bar plus "1:24 / 4:08" (no seeking). The bar is
 * decorative; the times are ordinary text, read when someone navigates to them and never announced
 * live, so screen readers are not flooded with progress updates.
 */
export function TrackProgress({ positionSeconds, durationSeconds, loading = false, className }: TrackProgressProps) {
  const known = durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds > 0;
  const position = known ? Math.min(Math.max(0, positionSeconds), durationSeconds) : Math.max(0, positionSeconds);
  const percent = known ? (position / durationSeconds) * 100 : 0;
  const indeterminate = loading && !known;

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <div aria-hidden="true" className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
        {indeterminate ? (
          <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-accent motion-safe:animate-progress-indeterminate motion-reduce:w-full motion-reduce:opacity-40" />
        ) : (
          <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-linear" style={{ width: `${percent}%` }} />
        )}
      </div>
      <p className="shrink-0 text-xs text-fg-muted tabular-nums sm:text-sm">
        <span className="sr-only">Track position </span>
        {formatDuration(known || position > 0 ? position : null)}
        <span aria-hidden="true"> / </span>
        <span className="sr-only"> of </span>
        {formatDuration(known ? durationSeconds : null)}
      </p>
    </div>
  );
}
