"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./Button";

export interface SubmitButtonProps extends Omit<ButtonProps, "type" | "loading" | "loadingText"> {
  /** Label while the form's action runs, e.g. "Saving…". Defaults to the normal label. */
  pendingLabel?: ReactNode;
}

/**
 * Submit button for forms with a Server Action (or any function `action`): shows a spinner,
 * sets aria-busy and blocks double submission while the owning form is pending.
 * Must be rendered inside the <form>.
 */
export function SubmitButton({ pendingLabel, disabled, children, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" disabled={disabled} loading={pending} loadingText={pendingLabel}>
      {children}
    </Button>
  );
}
