import { PLATFORM_NAME } from "@/config/platform";
import { cn } from "@/lib/utils/cn";

export type PlatformMarkSize = "sm" | "md" | "lg";

const SIZES: Record<PlatformMarkSize, { tile: string; glyph: string; text: string; gap: string }> = {
  sm: { tile: "size-6 rounded-md", glyph: "size-3.5", text: "text-sm", gap: "gap-2" },
  md: { tile: "size-8 rounded-lg", glyph: "size-5", text: "text-base", gap: "gap-2.5" },
  lg: { tile: "size-11 rounded-xl", glyph: "size-7", text: "text-2xl", gap: "gap-3" },
};

export interface PlatformMarkProps {
  size?: PlatformMarkSize;
  /** Show only the glyph (the platform name stays available to screen readers). */
  iconOnly?: boolean;
  className?: string;
}

/** The platform wordmark: an emerald equaliser tile plus PLATFORM_NAME. Wrap it in a link where needed. */
export function PlatformMark({ size = "md", iconOnly = false, className }: PlatformMarkProps) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-center font-semibold tracking-tight text-fg", s.gap, s.text, className)}>
      <span aria-hidden="true" className={cn("grid shrink-0 place-items-center bg-accent text-accent-fg", s.tile)}>
        <svg viewBox="0 0 24 24" fill="currentColor" className={s.glyph}>
          <rect x="3" y="10" width="3.2" height="10" rx="1.6" />
          <rect x="8.2" y="4" width="3.2" height="16" rx="1.6" />
          <rect x="13.4" y="8" width="3.2" height="12" rx="1.6" />
          <rect x="18.6" y="13" width="3.2" height="7" rx="1.6" />
        </svg>
      </span>
      <span className={cn(iconOnly && "sr-only")}>{PLATFORM_NAME}</span>
    </span>
  );
}
