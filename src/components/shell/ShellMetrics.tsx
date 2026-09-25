"use client";

import { useEffect } from "react";

/** CSS custom properties <ShellMetrics> keeps on <html>. */
const SHELL_HEADER_HEIGHT_VAR = "--shell-header-h";
const SHELL_BOTTOM_HEIGHT_VAR = "--shell-bottom-h";

/**
 * How much of the viewport a shell bar covers: its height (rounded up) while it is pinned (sticky
 * or fixed), 0 while it scrolls with the page (the short-viewport mode) or is hidden.
 */
export function pinnedBarHeight(position: string, height: number): number {
  return position === "sticky" || position === "fixed" ? Math.ceil(Math.max(0, height)) : 0;
}

function measure(element: HTMLElement | null): number {
  if (!element) return 0;
  return pinnedBarHeight(getComputedStyle(element).position, element.getBoundingClientRect().height);
}

/**
 * Measures the app shell's pinned top bar and bottom stack (player bar + tab bar) and publishes
 * their heights as `--shell-header-h` / `--shell-bottom-h` on <html>. globals.css turns them into
 * scroll-padding, so focused controls and #anchors never end up underneath the bars; pages can use
 * them too (e.g. `max-h-[calc(100dvh-var(--shell-bottom-h))]`). A bar that is hidden at the current
 * breakpoint, or that scrolls with the page on a short viewport, counts as 0. Renders nothing.
 */
export function ShellMetrics({ layoutKey }: { layoutKey: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-app-shell]");
    if (!root) return;
    const header = root.querySelector<HTMLElement>("[data-shell-header]");
    const bottom = root.querySelector<HTMLElement>("[data-shell-bottom]");
    const html = document.documentElement;

    const update = () => {
      html.style.setProperty(SHELL_HEADER_HEIGHT_VAR, `${measure(header)}px`);
      html.style.setProperty(SHELL_BOTTOM_HEIGHT_VAR, `${measure(bottom)}px`);
    };
    update();

    // Switching between pinned and scrolling (the short-viewport media query) keeps the bars'
    // size, so only the viewport resize that causes it (rotation, zoom, window size) reports it.
    window.addEventListener("resize", update);
    // Also fires when a bar switches between display:none and visible at a breakpoint.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (header) observer?.observe(header);
    if (bottom) observer?.observe(bottom);
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
      html.style.removeProperty(SHELL_HEADER_HEIGHT_VAR);
      html.style.removeProperty(SHELL_BOTTOM_HEIGHT_VAR);
    };
  }, [layoutKey]);

  return null;
}
