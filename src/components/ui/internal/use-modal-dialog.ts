"use client";

import {
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { pushOpenModal } from "./modal-stack";

export interface ModalDialogOptions {
  open: boolean;
  onClose: () => void;
  dismissible: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Where focus goes when the dialog closes; defaults to the element focused when it opened. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Moves focus back after a modal closes: to `target` when it is still in the document and focus
 * is not already somewhere meaningful (inside the closing dialog, on <body>, or on a removed node).
 */
export function restoreFocus(target: HTMLElement | null | undefined, dialog: HTMLDialogElement | null): void {
  if (!target?.isConnected) return;
  const active = document.activeElement;
  if (!active || active === document.body || !active.isConnected || (dialog?.contains(active) ?? false)) {
    target.focus();
  }
}

/**
 * Shared behaviour of <Dialog> and <Drawer> on a native <dialog> with showModal(): the browser
 * supplies the top layer, the inert background and the focus trap; this adds controlled `open`,
 * Escape/backdrop dismissal and focus return to the opener — also when the component unmounts
 * while open (the cleanup below runs before React removes the <dialog> from the document).
 * Open dialogs are recorded in the modal stack, so the toast layer can stay on top and usable.
 */
export function useModalDialog({ open, onClose, dismissible, initialFocusRef, returnFocusRef }: ModalDialogOptions) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerDownOnBackdropRef = useRef(false);

  // Layout effect: open/close in the same frame the content (un)mounts, so no empty frame paints.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // After showModal(), so the dialog's own initial focus never lands on a toast moved into it.
    const releaseModal = pushOpenModal(dialog);
    initialFocusRef?.current?.focus();
    return () => {
      // Runs when `open` turns false and when the component unmounts while open.
      if (dialog.open) dialog.close();
      // Read at close time on purpose: the caller may point the ref elsewhere while the dialog is open.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      restoreFocus(returnFocusRef?.current ?? opener, dialog);
      // Synchronously, before React can remove the <dialog>: the toast layer moves out of it.
      releaseModal();
    };
  }, [open, initialFocusRef, returnFocusRef]);

  function handleNativeClose() {
    const dialog = dialogRef.current;
    // A stale close event (e.g. from React Strict Mode re-running effects) after re-opening.
    if (dialog?.open) return;
    // Closed by the browser rather than by our state (e.g. a repeated Escape press): sync the owner,
    // whose state change then runs the effect cleanup above (focus return).
    if (open) onClose();
  }

  const dialogProps = {
    ref: dialogRef,
    // Explicit so page-level shortcut handlers can detect an open modal via [aria-modal="true"].
    "aria-modal": open || undefined,
    onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
      event.preventDefault();
      if (dismissible) onClose();
    },
    onClose: handleNativeClose,
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      pointerDownOnBackdropRef.current = event.target === event.currentTarget;
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      // The dialog element itself is only hit on the backdrop: its content box fills it.
      const startedOnBackdrop = pointerDownOnBackdropRef.current;
      pointerDownOnBackdropRef.current = false;
      if (dismissible && startedOnBackdrop && event.target === event.currentTarget) onClose();
    },
  } as const;

  return dialogProps;
}
