"use client";

import { useState, type ReactNode } from "react";
import { Alert, ConfirmDialog } from "@/components/ui";

export interface ActionConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  /** `danger` (default) for destructive actions: focus starts on Cancel. */
  tone?: "danger" | "primary";
  children?: ReactNode;
  onCancel: () => void;
  /** Runs the action; call `reportError` to keep the dialog open with the reason. */
  onConfirm: (reportError: (message: string) => void) => Promise<void>;
}

/**
 * ConfirmDialog that shows the action's failure inside the dialog ("Nothing was changed" + reason)
 * instead of closing. Remount it (key) per opening so a previous error is not shown again.
 */
export function ActionConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "danger",
  children,
  onCancel,
  onConfirm,
}: ActionConfirmDialogProps) {
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open={open}
      onCancel={onCancel}
      onConfirm={() => {
        setError(null);
        return onConfirm(setError);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone={tone}
    >
      {(children || error) && (
        <div className="grid gap-3 text-sm text-fg-muted">
          {children}
          {error && <Alert tone="danger" title="Nothing was changed" description={error} />}
        </div>
      )}
    </ConfirmDialog>
  );
}
