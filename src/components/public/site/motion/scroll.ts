import type Lenis from "lenis";

/** Height of the fixed header, so a section's top is not hidden underneath it. */
export const HEADER_OFFSET = 76;

/**
 * Smoothly scrolls to a homepage section (Lenis on desktop, native smooth scrolling elsewhere, an
 * instant jump with reduced motion), updates the address bar and moves keyboard/screen-reader focus to the
 * section's heading (so keyboard users see where they landed). Returns false when the section is not on
 * this page.
 */
export function scrollToSection(id: string, lenis: Lenis | null): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (lenis && !reduce) {
    lenis.scrollTo(target, { offset: -HEADER_OFFSET, duration: 1.4 });
  } else {
    const top = target.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
    window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  }
  window.history.replaceState(null, "", `#${id}`);
  const focusTarget = target.querySelector<HTMLElement>("h1, h2") ?? target;
  if (!focusTarget.hasAttribute("tabindex")) focusTarget.setAttribute("tabindex", "-1");
  focusTarget.focus({ preventScroll: true });
  return true;
}
