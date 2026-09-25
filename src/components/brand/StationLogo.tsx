"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { initials } from "@/lib/utils/initials";

export type StationLogoSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<StationLogoSize, string> = {
  sm: "size-8 rounded-lg text-xs",
  md: "size-12 rounded-xl text-base",
  lg: "size-20 rounded-2xl text-2xl",
  xl: "size-36 rounded-3xl text-5xl sm:size-44 sm:text-6xl",
};

export interface StationLogoProps {
  /** Station (or venue) name: used for the alt text and the monogram fallback. */
  name: string;
  /** Signed logo URL, or null to show the monogram. */
  src?: string | null;
  size?: StationLogoSize;
  /** Set when the name is printed right next to the logo, so it is not read twice. */
  decorative?: boolean;
  className?: string;
}

/**
 * Venue logo, falling back to an initials monogram when there is no logo or it fails to load
 * (e.g. an expired signed URL).
 */
export function StationLogo({ name, src, size = "md", decorative = false, className }: StationLogoProps) {
  // Remember which URL failed rather than a boolean, so a fresh signed URL is tried again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const altText = decorative ? "" : `${name} logo`;
  const frame = cn("shrink-0 overflow-hidden border border-border", SIZE_CLASSES[size], className);

  if (src && src !== failedSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URL: next/image would cache the tokenised URL in its optimizer (docs/research/nextjs-16.md §7).
      <img
        // Catches a load error that happened before hydration attached onError.
        ref={(image) => {
          if (image && image.complete && image.naturalWidth === 0) setFailedSrc(src);
        }}
        src={src}
        alt={altText}
        decoding="async"
        onError={() => setFailedSrc(src)}
        className={cn(frame, "bg-surface-2 object-contain p-[6%]")}
      />
    );
  }

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : altText}
      aria-hidden={decorative || undefined}
      className={cn(
        frame,
        "inline-flex items-center justify-center bg-linear-to-br from-accent/25 via-surface-2 to-surface-3",
        "font-semibold tracking-tight text-accent-text select-none",
      )}
    >
      {initials(name)}
    </span>
  );
}
