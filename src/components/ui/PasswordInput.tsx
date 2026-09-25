"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { IconButton } from "./IconButton";
import { Input, type InputProps } from "./Input";

export interface PasswordInputProps extends Omit<InputProps, "type"> {
  /** Accessible name of the toggle. Default "Show password" (its pressed state says whether it is shown). */
  toggleLabel?: string;
}

/**
 * Password field with an accessible show/hide toggle: a button inside the field whose
 * `aria-pressed` reflects visibility. Accepts the props <Field> injects (id, required,
 * aria-describedby, aria-invalid). Pressing Enter (submitting) hides the password again.
 */
export function PasswordInput({ className, toggleLabel = "Show password", onKeyDown, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn("pr-12!", className)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key === "Enter") setVisible(false);
        }}
      />
      <IconButton
        variant="ghost"
        aria-label={toggleLabel}
        aria-pressed={visible}
        aria-controls={props.id}
        icon={visible ? <EyeOff /> : <Eye />}
        disabled={props.disabled}
        onClick={() => setVisible((value) => !value)}
        className="absolute top-0.5 right-0.5 size-10!"
      />
    </div>
  );
}
