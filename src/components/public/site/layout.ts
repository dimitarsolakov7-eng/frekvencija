/** Page width and side gutters of the public website (20px mobile, 32px tablet, 48px desktop). */
export const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-12";

/** Vertical rhythm of a homepage section. */
export const SECTION_SPACE = "py-20 sm:py-24 lg:py-32";

/** Height of the sticky header at rest; it compacts to `HEADER_COMPACT_HEIGHT` while scrolling. */
export const HEADER_HEIGHT = 76;
export const HEADER_COMPACT_HEIGHT = 60;

/** Quiet navigation link with a 44px touch target. Add the display class (`inline-flex`, or `hidden md:inline-flex`) where it is used. */
export const NAV_LINK_CLASSES =
  "h-11 items-center rounded-full px-3.5 text-[0.9375rem] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";

/** Inline text link of the website (cobalt, underlined on hover/focus). */
export const TEXT_LINK_CLASSES =
  "rounded-sm font-medium text-accent-text underline decoration-accent-text/35 underline-offset-4 transition-colors hover:decoration-accent-text focus-visible:decoration-accent-text";
