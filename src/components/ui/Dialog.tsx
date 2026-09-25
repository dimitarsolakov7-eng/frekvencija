"use client";

import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { useModalDialog } from "./internal/use-modal-dialog";

export type DialogSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export interface DialogProps {
  open: boolean;
  /** Called when the user asks to close (Escape, backdrop click, close button) or the browser closed it. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action buttons, right-aligned (stacked on phones). */
  footer?: ReactNode;
  size?: DialogSize;
  /** Allow Escape, backdrop click and the close button. Disable while work is in flight. Default true. */
  dismissible?: boolean;
  /** Element to focus after opening; otherwise the browser focuses the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Where focus goes on close. Defaults to the element that was focused when the dialog opened. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Modal dialog built on the native <dialog> element with `showModal()`: the browser provides the
 * top layer, inert background and focus trapping. This component adds controlled open state,
 * labelling, backdrop-click dismissal and focus return to the element that opened it (also when
 * the dialog is unmounted while open). Content is only mounted while open, so forms inside start
 * fresh each time.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  initialFocusRef,
  returnFocusRef,
  className,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogProps = useModalDialog({ open, onClose, dismissible, initialFocusRef, returnFocusRef });

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] overflow-hidden rounded-card border border-border",
        "bg-surface p-0 text-fg shadow-overlay backdrop:bg-black/70",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <header className="flex items-start gap-4 px-5 pt-5 pb-3 sm:px-6 sm:pt-6">
            <div className="grid min-w-0 flex-1 gap-1">
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
              <IconButton
                aria-label="Close dialog"
                icon={<X />}
                size="sm"
                onClick={onClose}
                className="-mt-1.5 -mr-2"
              />
            )}
          </header>
          {children !== undefined && children !== null && children !== false && (
            // pt-1 leaves room for a first control's focus ring inside the scrolling body.
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5 sm:px-6">{children}</div>
          )}
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

export interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  /**
   * Runs the confirmed action. If it returns a promise the confirm button shows a spinner and the
   * dialog cannot be dismissed until it settles. Close the dialog (and report errors, e.g. via
   * `children` or a toast) from the caller; a rejected promise is not swallowed.
   */
  onConfirm: () => void | Promise<unknown>;
  title: ReactNode;
  description?: ReactNode;
  /** Extra content, e.g. an error <Alert> from the last attempt. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for destructive actions (focus starts on Cancel). Default `danger`. */
  tone?: "danger" | "primary";
  /** External pending state, e.g. from useTransition. */
  pending?: boolean;
  /** Where focus goes on close (defaults to the element focused when it opened). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  pending = false,
  returnFocusRef,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [running, setRunning] = useState(false);
  const busy = pending || running;

  async function handleConfirm() {
    const result = onConfirm();
    if (!result || typeof (result as PromiseLike<unknown>).then !== "function") return;
    setRunning(true);
    try {
      await result;
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      dismissible={!busy}
      initialFocusRef={tone === "danger" ? cancelRef : confirmRef}
      returnFocusRef={returnFocusRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            onClick={() => void handleConfirm()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
