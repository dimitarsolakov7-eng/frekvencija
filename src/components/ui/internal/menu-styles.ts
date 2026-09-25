import { cn } from "@/lib/utils/cn";

/**
 * Keyboard focus ring of a menu item: 2px, drawn just inside the row (the menu scrolls, so an outer
 * ring could be clipped), in the ring token (#5FE0B0: 9.3:1 on the menu's surface-2 and 8.1:1 on
 * the focused row's surface-3).
 *
 * Never pair an outline ring with `outline-none` or `outline-hidden`: in Tailwind 4 both set
 * `--tw-outline-style: none` on the element, and `focus-visible:outline-2` reads that variable, so
 * the ring silently disappears (review finding A11Y-01). The style and colour are spelled out here,
 * so the ring does not depend on the base `:focus-visible` rule in globals.css either.
 */
export const MENU_ITEM_FOCUS_RING_CLASSES =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring";

export interface MenuItemStyleOptions {
  tone?: "default" | "danger";
  disabled?: boolean;
}

/**
 * Row look of a <DropdownMenu> item: at least 44px tall; hover and the roving focus tint the row,
 * and keyboard focus adds the ring above.
 */
export function menuItemClasses({ tone = "default", disabled = false }: MenuItemStyleOptions = {}): string {
  return cn(
    "flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-left text-sm font-medium transition-colors",
    "hover:bg-surface-3 focus:bg-surface-3",
    MENU_ITEM_FOCUS_RING_CLASSES,
    "[&_svg]:size-[1.125rem] [&_svg]:shrink-0",
    tone === "danger" ? "text-danger" : "text-fg",
    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
  );
}
