export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MenuPlacementOptions {
  /** Align the menu's start or end edge with the trigger's. */
  align: "start" | "end";
  /** Preferred side; flips when there is not enough room and the other side has more. */
  side: "bottom" | "top";
  /** Gap between trigger and menu. */
  offset?: number;
  /** Minimum distance from the viewport edges. */
  margin?: number;
}

/**
 * Viewport (position: fixed) coordinates for a popup menu next to its trigger: below (or above)
 * it, aligned to its start or end edge, flipped when it would not fit, and clamped inside the
 * viewport. Pure, so it is unit-tested without a browser.
 */
export function computeMenuPosition(
  trigger: RectLike,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  { align, side, offset = 6, margin = 8 }: MenuPlacementOptions,
): { top: number; left: number; side: "bottom" | "top" } {
  const spaceBelow = viewport.height - trigger.bottom - offset - margin;
  const spaceAbove = trigger.top - offset - margin;
  let resolvedSide = side;
  if (side === "bottom" && menu.height > spaceBelow && spaceAbove > spaceBelow) resolvedSide = "top";
  if (side === "top" && menu.height > spaceAbove && spaceBelow > spaceAbove) resolvedSide = "bottom";

  const rawTop = resolvedSide === "bottom" ? trigger.bottom + offset : trigger.top - offset - menu.height;
  const maxTop = Math.max(margin, viewport.height - margin - menu.height);
  const top = Math.min(Math.max(rawTop, margin), maxTop);

  const rawLeft = align === "end" ? trigger.right - menu.width : trigger.left;
  const maxLeft = Math.max(margin, viewport.width - margin - menu.width);
  const left = Math.min(Math.max(rawLeft, margin), maxLeft);

  return { top: Math.round(top), left: Math.round(left), side: resolvedSide };
}
