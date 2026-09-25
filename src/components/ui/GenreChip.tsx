import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { pickByKey } from "@/lib/utils/hash";

/** Muted chip palettes (screen 05: House green, Deep House indigo, Lounge amber, Jazz blue, …). */
export const GENRE_CHIP_TONES = ["emerald", "teal", "sky", "indigo", "violet", "rose", "amber", "lime"] as const;

export type GenreChipTone = (typeof GENRE_CHIP_TONES)[number];

// Full class strings (Tailwind only generates classes it can see literally in the source).
const TONE_CLASSES: Record<GenreChipTone, { chip: string; dot: string }> = {
  emerald: { chip: "border-emerald-400/35 bg-emerald-400/10 text-emerald-200", dot: "bg-emerald-400" },
  teal: { chip: "border-teal-400/35 bg-teal-400/10 text-teal-200", dot: "bg-teal-400" },
  sky: { chip: "border-sky-400/35 bg-sky-400/10 text-sky-200", dot: "bg-sky-400" },
  indigo: { chip: "border-indigo-400/40 bg-indigo-400/10 text-indigo-200", dot: "bg-indigo-400" },
  violet: { chip: "border-violet-400/40 bg-violet-400/10 text-violet-200", dot: "bg-violet-400" },
  rose: { chip: "border-rose-400/40 bg-rose-400/10 text-rose-200", dot: "bg-rose-400" },
  amber: { chip: "border-amber-400/40 bg-amber-400/10 text-amber-200", dot: "bg-amber-400" },
  lime: { chip: "border-lime-400/35 bg-lime-400/10 text-lime-200", dot: "bg-lime-400" },
};

/**
 * Deterministic tone for a genre: the same key (slug, id or name; case and surrounding spaces are
 * ignored) always gets the same colour on every page and on server and client alike.
 */
export function genreChipTone(key: string | null | undefined): GenreChipTone {
  return pickByKey(key, GENRE_CHIP_TONES);
}

export interface GenreChipProps extends Omit<ComponentPropsWithRef<"span">, "children"> {
  /** Genre name shown in the chip (or pass it as `children`). */
  name?: ReactNode;
  children?: ReactNode;
  /**
   * Stable key that picks the colour, ideally the genre slug or id so renaming keeps the colour.
   * Defaults to the name when that is a string.
   */
  genreKey?: string;
  /** Explicit tone, overriding the key-derived one. */
  tone?: GenreChipTone;
  size?: "sm" | "md";
}

/** Small, muted, per-genre coloured chip for tables and cards. The name carries the meaning. */
export function GenreChip({ name, children, genreKey, tone, size = "md", className, ...props }: GenreChipProps) {
  const content = name ?? children;
  const key = genreKey ?? (typeof content === "string" ? content : "");
  const resolved = TONE_CLASSES[tone ?? genreChipTone(key)];
  return (
    <span
      {...props}
      className={cn(
        "inline-flex max-w-full shrink-0 items-center rounded-lg border font-medium whitespace-nowrap",
        size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
        resolved.chip,
        className,
      )}
    >
      <span className="truncate">{content}</span>
    </span>
  );
}

export interface GenreDotProps {
  genreKey?: string;
  tone?: GenreChipTone;
  className?: string;
}

/** Decorative dot in a genre's chip colour (e.g. inside a genre <Select leading={…}> or a list). */
export function GenreDot({ genreKey, tone, className }: GenreDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2.5 shrink-0 rounded-full", TONE_CLASSES[tone ?? genreChipTone(genreKey)].dot, className)}
    />
  );
}
