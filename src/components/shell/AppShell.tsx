import type { ReactNode } from "react";
import { SkipLink } from "@/components/ui/VisuallyHidden";
import { cn } from "@/lib/utils/cn";
import { ShellMetrics } from "./ShellMetrics";

export interface AppShellProps {
  /** Desktop (≥1024px) sidebar content: <SidebarBrand>, <SidebarIdentity>, <SidebarNav>, <SidebarSection>… */
  sidebar: ReactNode;
  /** Top bar content below 1024px, normally <MobileTopBar right={…} />. */
  mobileHeader: ReactNode;
  /** Bottom navigation below 1024px, normally <MobileTabBar items={…} />. */
  mobileNav?: ReactNode;
  /**
   * Persistent player (render it as a card: rounded-card border bg-surface). Pinned to the bottom
   * of the main column on desktop and above `mobileNav` on smaller screens.
   */
  playerBar?: ReactNode;
  /** Desktop-only row above the page content, right-aligned (e.g. <UserMenu>). */
  topBar?: ReactNode;
  children: ReactNode;
  /** Classes for the content wrapper inside <main> (default: full width up to 1600px, centred). */
  contentClassName?: string;
}

/**
 * Two-column app frame (screens 03–08).
 *
 * - ≥1024px: fixed 240px sidebar (bg-sidebar, hairline right border) and a scrolling main column.
 * - <1024px: the sidebar is hidden; `mobileHeader` sticks to the top (safe-area aware).
 * - `playerBar` and `mobileNav` form one sticky bottom stack at the end of the main column. Being
 *   sticky rather than fixed, they take up space in the flow, so page content always scrolls
 *   clear of them; the tab bar pads itself for the home indicator.
 * - Short viewports (≤ 512px tall: landscape phones, 200–400% zoom) pin nothing: the top bar and the
 *   bottom stack scroll with the page (the `short:` variant), which would otherwise be covered almost
 *   entirely by ~260px of bars (WCAG 1.4.10). The layout does not shift: sticky and static bars
 *   take the same place in the flow.
 * - The heights of the pinned top bar and bottom stack are published as `--shell-header-h` and
 *   `--shell-bottom-h` on <html> (0 while a bar scrolls with the page); scroll-padding keeps focused
 *   elements clear of them.
 * - Main content gets 16/24/32px side padding (notch-safe) and the page's <main id="main-content">
 *   target for the skip link.
 */
export function AppShell({ sidebar, mobileHeader, mobileNav, playerBar, topBar, children, contentClassName }: AppShellProps) {
  const hasPlayer = playerBar !== undefined && playerBar !== null && playerBar !== false;
  const hasMobileNav = mobileNav !== undefined && mobileNav !== null && mobileNav !== false;
  const hasBottom = hasPlayer || hasMobileNav;

  return (
    <div data-app-shell="" className="flex min-h-dvh flex-1 flex-col lg:pl-(--shell-sidebar-w)">
      <SkipLink />
      <ShellMetrics layoutKey={`${hasPlayer ? "player" : ""}:${hasMobileNav ? "tabs" : ""}`} />

      <div
        data-shell-sidebar=""
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden w-(--shell-sidebar-w) flex-col overflow-y-auto overscroll-contain",
          "border-r border-border bg-sidebar lg:flex",
        )}
      >
        {sidebar}
      </div>

      <header
        data-shell-header=""
        className="sticky top-0 z-30 border-b border-border bg-sidebar/95 pt-safe backdrop-blur-md short:static lg:hidden"
      >
        {mobileHeader}
      </header>

      {topBar && <div className="hidden items-center justify-end gap-3 px-page pt-6 lg:flex">{topBar}</div>}

      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          // A programmatic focus target for the skip link, not a control: no ring around the page.
          "flex-1 px-page pt-6 focus:outline-none sm:pt-8",
          topBar ? "lg:pt-2" : "lg:pt-10",
          hasBottom ? "pb-8" : "pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]",
        )}
      >
        <div className={cn("mx-auto w-full max-w-[1600px]", contentClassName)}>{children}</div>
      </main>

      {hasBottom && (
        <div data-shell-bottom="" className="sticky bottom-0 z-30 short:static">
          {hasPlayer && (
            <div
              data-shell-player=""
              className={cn(
                "bg-linear-to-t from-canvas from-65% to-canvas/0 px-page pt-4",
                hasMobileNav ? "pb-3 lg:pb-4" : "pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] lg:pb-4",
              )}
            >
              <div className="mx-auto w-full max-w-[1600px]">{playerBar}</div>
            </div>
          )}
          {hasMobileNav && (
            <div
              data-shell-tabbar=""
              className="border-t border-border bg-sidebar/95 pr-safe pb-safe pl-safe backdrop-blur-md lg:hidden"
            >
              {mobileNav}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
