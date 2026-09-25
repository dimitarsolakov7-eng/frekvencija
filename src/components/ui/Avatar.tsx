"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { initials as initialsOf } from "@/lib/utils/initials";
import { avatarAutoToneClasses } from "./avatar-tone";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarTone = "accent" | "neutral" | "auto";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "size-6 text-[0.625rem]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
};

const TONE_CLASSES: Record<Exclude<AvatarTone, "auto">, string> = {
  accent: "bg-accent/20 text-accent-text ring-1 ring-inset ring-accent/30",
  neutral: "bg-surface-3 text-fg ring-1 ring-inset ring-border-strong",
};

export interface AvatarProps {
  /** Person or venue name: the image alt text and the source of the initials. */
  name: string;
  /** Override the computed initials (e.g. "A" for "Administrator"). */
  initials?: string;
  /** Image URL (signed logo URLs are fine; a failed load falls back to the initials). */
  src?: string | null;
  /** Alias of `src`. */
  imageUrl?: string | null;
  size?: AvatarSize;
  shape?: "circle" | "rounded";
  /**
   * Initials colour: `accent` (emerald tint, default), `neutral`, or `auto` (a restrained colour
   * picked deterministically from the name, for lists of venues).
   */
  tone?: AvatarTone;
  /** Hide from assistive technology when the name is printed right next to the avatar. */
  decorative?: boolean;
  className?: string;
}

/** Round avatar: image when available, otherwise initials. */
export function Avatar({
  name,
  initials,
  src,
  imageUrl,
  size = "md",
  shape = "circle",
  tone = "accent",
  decorative = false,
  className,
}: AvatarProps) {
  const url = src ?? imageUrl ?? null;
  // Remember which URL failed rather than a boolean, so a fresh signed URL is tried again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const frame = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold select-none",
    shape === "circle" ? "rounded-full" : "rounded-control",
    SIZE_CLASSES[size],
    className,
  );

  if (url && url !== failedSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URLs must not be cached by the image optimizer.
      <img
        // Catches a load error that happened before hydration attached onError.
        ref={(image) => {
          if (image && image.complete && image.naturalWidth === 0) setFailedSrc(url);
        }}
        src={url}
        alt={decorative ? "" : name}
        decoding="async"
        onError={() => setFailedSrc(url)}
        className={cn(frame, "bg-surface-2 object-cover")}
      />
    );
  }

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn(frame, tone === "auto" ? avatarAutoToneClasses(name) : TONE_CLASSES[tone])}
    >
      {(initials?.trim() || initialsOf(name)).slice(0, 2)}
    </span>
  );
}
