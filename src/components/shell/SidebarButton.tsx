import type { Route } from "next";
import { renderIcon, type IconLike } from "@/components/ui/internal/render-icon";
import { cn } from "@/lib/utils/cn";
import type { NavMatch } from "./nav-state";
import { ShellNavLink } from "./ShellNavLink";
import {
  SIDEBAR_ROW_ACTIVE_CLASSES,
  SIDEBAR_ROW_CLASSES,
  SIDEBAR_ROW_DANGER_CLASSES,
  SIDEBAR_ROW_INACTIVE_CLASSES,
} from "./sidebar-styles";

export interface SidebarButtonProps {
  label: string;
  /** A lucide icon component (`LogOut`) or element (`<LogOut />`). */
  icon?: IconLike;
  /** Link row (client-side navigation, marked current like a nav item). */
  href?: Route;
  /** For `href` rows. Default "prefix". */
  match?: NavMatch;
  /** Button row (Client Components only). */
  onClick?: () => void;
  /** Form row: POSTs to this URL, e.g. "/auth/signout". Works without JavaScript. */
  action?: string;
  /** Button type when there is neither `href` nor `action` (e.g. "submit" inside your own form). */
  type?: "button" | "submit";
  tone?: "default" | "danger";
  disabled?: boolean;
  className?: string;
}

/** A sidebar row for secondary actions: Help, Settings (links), Sign out (form POST or handler). */
export function SidebarButton({
  label,
  icon,
  href,
  match,
  onClick,
  action,
  type = "button",
  tone = "default",
  disabled = false,
  className,
}: SidebarButtonProps) {
  const content = (
    <>
      {renderIcon(icon)}
      <span className="truncate">{label}</span>
    </>
  );

  if (href) {
    return (
      <ShellNavLink
        href={href}
        match={match}
        className={cn(SIDEBAR_ROW_CLASSES, className)}
        activeClassName={SIDEBAR_ROW_ACTIVE_CLASSES}
        inactiveClassName={tone === "danger" ? SIDEBAR_ROW_DANGER_CLASSES : SIDEBAR_ROW_INACTIVE_CLASSES}
      >
        {content}
      </ShellNavLink>
    );
  }

  const button = (
    <button
      type={action ? "submit" : type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        SIDEBAR_ROW_CLASSES,
        "cursor-pointer disabled:pointer-events-none disabled:opacity-50",
        tone === "danger" ? SIDEBAR_ROW_DANGER_CLASSES : SIDEBAR_ROW_INACTIVE_CLASSES,
        className,
      )}
    >
      {content}
    </button>
  );

  if (action) {
    return (
      <form action={action} method="post" className="contents">
        {button}
      </form>
    );
  }
  return button;
}
