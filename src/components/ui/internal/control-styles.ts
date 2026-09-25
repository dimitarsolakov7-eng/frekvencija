/**
 * Shared look of text-like form controls (Input, Textarea, Select, SearchInput): a darker "well"
 * (bg-control) with a 10px radius and 16px text (no iOS zoom on focus). The edge uses the
 * border-input token (≥ 3:1 against every surface a field sits on, WCAG 1.4.11; see globals.css),
 * not the #26382f card hairline, so empty fields stay findable. Disabled fields (exempt from
 * 1.4.11) keep the dimmed hairline, like read-only ones, and do not react to hover.
 */
export const CONTROL_CLASSES =
  "w-full rounded-control border border-border-input bg-control text-base text-fg shadow-none " +
  "placeholder:text-fg-subtle transition-colors duration-150 hover:border-border-input-hover " +
  "focus-visible:border-accent/70 " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:hover:border-danger " +
  "disabled:cursor-not-allowed disabled:border-border disabled:opacity-60 disabled:hover:border-border";

/**
 * Read-only text fields look settled rather than editable (hairline edge, raised fill): their value
 * reads as text and there is nothing to type into. Only for <input>/<textarea>: a <select> always
 * matches :read-only, so it must not get these classes.
 */
export const READ_ONLY_CLASSES = "read-only:border-border read-only:bg-surface-2 read-only:hover:border-border";

/**
 * Shared look of the underline tab strip used by <Tabs> and <NavTabs> (screens 05/06). The strip
 * scrolls horizontally on narrow screens, so everything is drawn inside its box: the baseline is an
 * inset shadow, the active indicator sits at bottom-0 and the focus ring is inset (anything outside
 * would be clipped or would create a vertical scrollbar).
 */
export const TAB_LIST_CLASSES =
  "flex gap-2 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:thin]";

export const TAB_CLASSES =
  "relative inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-t-control px-1.5 text-[0.9375rem] " +
  "transition-colors focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-50 " +
  "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full [&_svg]:size-4 [&_svg]:shrink-0 " +
  "sm:px-2";

// Mutually exclusive: without tailwind-merge, conflicting colour utilities resolve by stylesheet order.
export const TAB_ACTIVE_CLASSES = "font-semibold text-fg after:bg-accent";
export const TAB_INACTIVE_CLASSES = "font-medium text-fg-muted hover:text-fg";

/** Segmented control look (screen 07 "Generate voice | Upload recording"). */
export const SEGMENTED_LIST_CLASSES =
  "inline-flex max-w-full gap-1 overflow-x-auto rounded-control border border-border bg-control p-1 [scrollbar-width:none]";

export const SEGMENTED_TAB_CLASSES =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[8px] px-4 text-sm font-semibold " +
  "transition-colors focus-visible:-outline-offset-2 disabled:pointer-events-none disabled:opacity-50 " +
  "[&_svg]:size-4 [&_svg]:shrink-0";

export const SEGMENTED_ACTIVE_CLASSES = "bg-accent/20 text-fg ring-1 ring-inset ring-accent/35 [&_svg]:text-accent-text";
export const SEGMENTED_INACTIVE_CLASSES = "text-fg-muted hover:bg-surface-2 hover:text-fg";
