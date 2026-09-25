"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Focus for the business directory (review finding A11Y-14). Below 1024px the list and the detail
 * column replace each other, so the link that was activated disappears with its column: focus then
 * moves to the heading of what opened, or back to the venue's row in the list.
 *
 * Detail headings carry `data-detail-heading="<venue id>"` ("new" for the add form, "*" for "not
 * found") and tabIndex={-1}; list rows carry `data-business-row="<venue id>"` on their link.
 */

export type DirectoryFocusMove = { kind: "detail"; selected: string } | { kind: "row"; businessId: string } | { kind: "list" } | null;

/**
 * Where focus goes after the selection changed (`previous` → `selected`: a venue id, "new", or
 * null for the list alone). Nothing moves while focus is still on something visible, e.g. on a
 * desktop, where the list stays next to the detail and keeps the focused row.
 */
export function directoryFocusMove(previous: string | null, selected: string | null, focusLost: boolean): DirectoryFocusMove {
  if (previous === selected || !focusLost) return null;
  if (selected !== null) return { kind: "detail", selected };
  if (previous !== null && previous !== "new") return { kind: "row", businessId: previous };
  return { kind: "list" };
}

/** The detail heading for a selection ("*" matches the not-found placeholder of any id). */
export function detailHeadingSelector(selected: string): string {
  return `[data-detail-heading="${selected.replace(/["\\]/g, "\\$&")}"], [data-detail-heading="*"]`;
}

function isRendered(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/** Focuses the first match in `container` once it is rendered (the detail may still be streaming in). */
function focusWhenRendered(container: HTMLElement, selector: string, timeoutMs = 10_000): () => void {
  const tryFocus = () => {
    const target = container.querySelector<HTMLElement>(selector);
    if (!target || !isRendered(target)) return false;
    target.focus();
    return true;
  };
  if (tryFocus()) return () => undefined;
  const observer = new MutationObserver(() => {
    if (tryFocus()) stop();
  });
  const timer = window.setTimeout(stop, timeoutMs);
  function stop() {
    observer.disconnect();
    window.clearTimeout(timer);
  }
  observer.observe(container, { childList: true, subtree: true });
  return stop;
}

/**
 * Moves focus when the directory switches between the list and a detail (`selected` from the URL).
 * `list` is the list section (tabIndex={-1}) and `detail` the detail column.
 */
export function useDirectoryFocus(selected: string | null, list: RefObject<HTMLElement | null>, detail: RefObject<HTMLElement | null>): void {
  const previous = useRef(selected);

  useEffect(() => {
    const before = previous.current;
    previous.current = selected;
    const active = document.activeElement;
    const focusLost = !active || active === document.body || !isRendered(active);
    const move = directoryFocusMove(before, selected, focusLost);
    if (!move) return;
    if (move.kind === "detail") {
      return detail.current ? focusWhenRendered(detail.current, detailHeadingSelector(move.selected)) : undefined;
    }
    const row =
      move.kind === "row" ? list.current?.querySelector<HTMLElement>(`[data-business-row="${move.businessId.replace(/["\\]/g, "\\$&")}"]`) : null;
    (row && isRendered(row) ? row : list.current)?.focus();
  }, [selected, list, detail]);
}
