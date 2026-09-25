"use client";

import { useId, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { IconButton } from "./IconButton";
import { useModalDialog } from "./internal/use-modal-dialog";

export type DrawerSide = "right" | "left" | "bottom";
export type DrawerSize = "sm" | "md" | "lg";

// One border-width declaration per side (the UA gives <dialog> a border on every side).
const SIDE_CLASSES: Record<DrawerSide, string> = {
  right:
    "mr-0 ml-auto h-dvh max-h-none w-[calc(100%-2.5rem)] [border-width:0_0_0_1px] pt-safe pr-safe pb-safe " +
    "motion-safe:animate-drawer-in-right",
  left:
    "mr-auto ml-0 h-dvh max-h-none w-[calc(100%-2.5rem)] [border-width:0_1px_0_0] pt-safe pl-safe pb-safe " +
    "motion-safe:animate-drawer-in-left",
  bottom:
    "mt-auto mb-0 max-h-[88dvh] w-full max-w-none rounded-t-card [border-width:1px_0_0_0] pb-safe " +
    "motion-safe:animate-drawer-in-bottom",
};

const WIDTH_CLASSES: Record<DrawerSize, string> = {
  sm: "max-w-xs",
  md: "max-w-md",
  lg: "max-w-xl",
};

export interface DrawerProps {
  open: boolean;
  /** Called when the user asks to close (Escape, backdrop tap, close button) or the browser closed it. */
  onClose: () => void;
  /** Heading of the sheet (also its accessible name). */
  title: ReactNode;
  /** Keep the title for assistive technology only (e.g. a navigation drawer with its own header). */
  hideTitle?: boolean;
  description?: ReactNode;
  children?: ReactNode;
  /** Sticky action row at the bottom (e.g. Save / Cancel). */
  footer?: ReactNode;
  /** Edge the sheet slides from. Default "right" (mobile editors); "left" for navigation. */
  side?: DrawerSide;
  /** Max width for left/right sheets. Default "md" (448px). */
  size?: DrawerSize;
  /** Allow Escape, backdrop tap and the close button. Disable while work is in flight. Default true. */
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Where focus goes on close. Defaults to the element that was focused when the drawer opened. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Side sheet on a native modal <dialog> (focus trap, inert page, Escape) for mobile editors and
 * navigation. Same focus behaviour as <Dialog>, including focus return when unmounted while open.
 * Content is only mounted while open.
 */
export function Drawer({
  open,
  onClose,
  title,
  hideTitle = false,
  description,
  children,
  footer,
  side = "right",
  size = "md",
  dismissible = true,
  initialFocusRef,
  returnFocusRef,
  className,
}: DrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogProps = useModalDialog({ open, onClose, dismissible, initialFocusRef, returnFocusRef });

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "overflow-hidden border-border bg-surface p-0 text-fg shadow-overlay backdrop:bg-black/70",
        SIDE_CLASSES[side],
        side !== "bottom" && WIDTH_CLASSES[size],
        className,
      )}
    >
      {open && (
        <div className={cn("flex flex-col", side === "bottom" ? "max-h-[88dvh]" : "h-full")}>
          <header
            className={cn(
              "flex items-start gap-4 px-5 pt-5 pb-3 sm:px-6",
              hideTitle && "justify-end pb-0",
            )}
          >
            <div className={cn("grid min-w-0 flex-1 gap-1", hideTitle && "sr-only")}>
              <h2 id={titleId} className="text-xl font-bold tracking-tight text-fg text-balance">
                {title}
              </h2>
              {description && (
                <div id={descriptionId} className="text-sm text-fg-muted text-pretty">
                  {description}
                </div>
              )}
            </div>
            {dismissible && (
              <IconButton aria-label="Close" icon={<X />} onClick={onClose} className="-mt-2 -mr-3" />
            )}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5 sm:px-6">{children}</div>
          {footer && (
            <footer className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
