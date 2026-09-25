import Image from "next/image";
import { VENUE_HERO_IMAGE } from "@/lib/brand/genre-artwork";
import { cn } from "@/lib/utils/cn";

export interface VenuePhotoProps {
  /** `sizes` for the responsive image (it fills its positioned parent). */
  sizes: string;
  /** Above-the-fold usage (hero, auth panel): load eagerly with high fetch priority. */
  eager?: boolean;
  /** Descriptive alt text; omit for decorative use. */
  alt?: string;
  /** object-position utilities, e.g. "object-[70%_50%]". */
  imageClassName?: string;
  /** Overlay layers (gradients) drawn over the photo; decorative. */
  overlays?: readonly string[];
}

/**
 * The supplied warm venue photograph, filling its positioned parent (`relative` + a size), with optional
 * dark gradient overlays so text on top stays readable.
 */
export function VenuePhoto({ sizes, eager = false, alt = "", imageClassName, overlays = [] }: VenuePhotoProps) {
  return (
    <>
      <Image
        src={VENUE_HERO_IMAGE.src}
        alt={alt}
        fill
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        className={cn("object-cover", imageClassName)}
        draggable={false}
      />
      {overlays.map((overlay) => (
        <div key={overlay} aria-hidden="true" className={cn("pointer-events-none absolute inset-0", overlay)} />
      ))}
    </>
  );
}
