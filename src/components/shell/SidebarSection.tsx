import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface SidebarSectionProps {
  children: ReactNode;
  /**
   * "bottom" (default): the section fills the remaining sidebar height and sits at the bottom
   * (Help / Settings / Sign out). "flow": a plain group in reading order.
   */
  position?: "bottom" | "flow";
  /** Makes the group a labelled navigation landmark (e.g. "Account"). */
  label?: string;
  className?: string;
}

/** Groups sidebar rows; by default it pins them to the bottom of the sidebar. */
export function SidebarSection({ children, position = "bottom", label, className }: SidebarSectionProps) {
  const classes = cn("grid content-end gap-1 px-3", position === "bottom" ? "mt-auto pt-6 pb-6" : "py-3", className);
  if (label) {
    return (
      <nav aria-label={label} className={classes}>
        {children}
      </nav>
    );
  }
  return <div className={classes}>{children}</div>;
}
