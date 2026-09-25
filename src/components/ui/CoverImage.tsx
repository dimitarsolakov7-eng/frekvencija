"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { VENUE_HERO_IMAGE, defaultGenreArtwork } from "@/lib/brand/genre-artwork";
import { cn } from "@/lib/utils/cn";

export type CoverOverlay = "bottom" | "left" | "full";

const OVERLAY_CLASSES: Record<CoverOverlay, string> = {
  // Text sits at the bottom (cards, mobile hero).
  bottom: "bg-linear-to-t from-canvas/95 via-canvas/45 to-canvas/0",
  // Text sits on the left (desktop now-playing hero).
  left: "bg-linear-to-r from-canvas/95 via-canvas/60 to-canvas/5",
  // Even dimming for busy images behind centred text.
  full: "bg-canvas/60",
};

/** Remote (signed) URLs skip the image optimizer: no remotePatterns needed and tokens are never cached. */
function isRemote(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src);
}

export interface CoverImageProps {
  /** Uploaded cover (e.g. a signed genre-cover URL). Falls back to the artwork when absent or broken. */
  src?: string | null;
  /** Genre slug (or other stable key) choosing the deterministic default artwork. */
  artworkKey?: string | null;
  /** Explicit fallback; defaults to the key's default artwork, else the venue photograph. */
  fallbackSrc?: string;
  /** Alternative text. Default "" (decorative), right when the name is printed alongside. */
  alt?: string;
  /** next/image `sizes`, e.g. "(max-width: 640px) 50vw, 33vw". */
  sizes?: string;
  /** Load eagerly with high priority (above-the-fold hero). */
  priority?: boolean;
  /** Dark gradient over the image for legible text: true = "bottom". */
  overlay?: boolean | CoverOverlay;
  /**
   * The frame: give it a size or aspect ratio and rounding, e.g. "aspect-[3/2] rounded-card".
   * The image covers it (object-cover).
   */
  className?: string;
  imageClassName?: string;
  /** Content layered above the image and overlay (e.g. hero text and controls). */
  children?: ReactNode;
}

/** Cover artwork that never shows a broken image: uploaded cover → default genre artwork. */
export function CoverImage({
  src,
  artworkKey,
  fallbackSrc,
  alt = "",
  sizes = "(max-width: 640px) 100vw, 50vw",
  priority = false,
  overlay = false,
  className,
  imageClassName,
  children,
}: CoverImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const fallback = fallbackSrc ?? (artworkKey ? defaultGenreArtwork(artworkKey) : VENUE_HERO_IMAGE.src);
  const current = src && src !== failedSrc ? src : fallback;
  const overlayKind: CoverOverlay | null = overlay === true ? "bottom" : overlay || null;

  return (
    <div className={cn("relative isolate overflow-hidden bg-surface-2", className)}>
      <Image
        key={current}
        src={current}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={isRemote(current)}
        // Catches a load error that happened before hydration attached onError.
        ref={(image) => {
          if (image && current !== fallback && image.complete && image.naturalWidth === 0) setFailedSrc(current);
        }}
        onError={() => {
          if (current !== fallback) setFailedSrc(current);
        }}
        className={cn("-z-20 object-cover", imageClassName)}
        draggable={false}
      />
      {overlayKind && <div aria-hidden="true" className={cn("absolute inset-0 -z-10", OVERLAY_CLASSES[overlayKind])} />}
      {children}
    </div>
  );
}
