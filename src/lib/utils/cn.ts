export type ClassValue = string | number | boolean | null | undefined | readonly ClassValue[];

/**
 * Joins class names, skipping falsy values and flattening nested arrays.
 *
 * It does not resolve conflicting Tailwind utilities (there is no tailwind-merge in this project):
 * when both `p-4` and `p-6` are present, the stylesheet order decides. Components therefore only
 * accept additive classes (layout, margins, widths); to deliberately override one of a component's
 * own utilities use Tailwind's important modifier, e.g. `cn(buttonBase, "px-8!")`.
 */
export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];
  const collect = (value: ClassValue): void => {
    if (value === null || value === undefined || typeof value === "boolean") return;
    if (typeof value === "number") {
      // clsx semantics: numbers are kept except 0, so `count && "x"` never emits "0".
      if (value !== 0 && !Number.isNaN(value)) classes.push(String(value));
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) classes.push(trimmed);
      return;
    }
    for (const item of value) collect(item);
  };
  for (const input of inputs) collect(input);
  return classes.join(" ");
}
