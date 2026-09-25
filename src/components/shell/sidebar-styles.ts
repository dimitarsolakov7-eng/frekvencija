/**
 * Sidebar row look shared by <SidebarNav> and <SidebarButton> (screens 03/05): 48px rows, line
 * icons, the current item as an emerald-tinted pill. Active and inactive sets are mutually
 * exclusive because `cn` does not merge conflicting utilities.
 */
export const SIDEBAR_ROW_CLASSES =
  "flex h-12 w-full items-center gap-3.5 rounded-control px-4 text-left text-[0.9375rem] font-medium " +
  "transition-colors [&_svg]:size-5 [&_svg]:shrink-0";

export const SIDEBAR_ROW_ACTIVE_CLASSES = "bg-accent/20 text-fg ring-1 ring-inset ring-accent/25 [&_svg]:text-accent-text";

export const SIDEBAR_ROW_INACTIVE_CLASSES = "text-fg/85 hover:bg-surface hover:text-fg [&_svg]:text-fg-muted";

export const SIDEBAR_ROW_DANGER_CLASSES = "text-danger hover:bg-danger/10 [&_svg]:text-danger";
