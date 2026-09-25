"use client";

import { useEffect, useId, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface SwitchProps
  extends Omit<
    ComponentPropsWithRef<"button">,
    "type" | "role" | "value" | "defaultValue" | "onChange" | "children" | "aria-checked"
  > {
  /** Controlled state. */
  checked?: boolean;
  /** Initial state when uncontrolled (also restored when the owning form resets). */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /**
   * Form field name. Like a native checkbox, the switch submits `name=value` only while on, so a
   * server action reads it with `formData.get(name) === value`.
   */
  name?: string;
  /** Submitted value while on. Defaults to "on" (same as a checkbox). */
  value?: string;
  /** Visible label (rendered to the left). Without it, provide `aria-label` or wrap in <Field>. */
  label?: ReactNode;
  description?: ReactNode;
}

/** On/off toggle: a `role="switch"` button with `aria-checked`, usable with or without a form. */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  name,
  value = "on",
  label,
  description,
  id,
  disabled,
  className,
  onClick,
  ref,
  ...props
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? `${generatedId}switch`;
  const descriptionId = description ? `${switchId}-description` : undefined;
  const describedBy = [props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined;

  const isControlled = checked !== undefined;
  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked);
  const isOn = isControlled ? checked : uncontrolledChecked;

  // Native checkboxes return to their default when their form resets (React resets forms after
  // every form action); mirror that for the uncontrolled switch. The element is looked up by id so
  // the caller's `ref` can go straight to the button.
  useEffect(() => {
    if (isControlled) return;
    const element = document.getElementById(switchId);
    const form = element instanceof HTMLButtonElement ? element.form : null;
    if (!form) return;
    const handleReset = () => setUncontrolledChecked(defaultChecked);
    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, [isControlled, defaultChecked, switchId]);

  const control = (
    <button
      {...props}
      ref={ref}
      id={switchId}
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const next = !isOn;
        if (!isControlled) setUncontrolledChecked(next);
        onCheckedChange?.(next);
      }}
      className={cn(
        "group relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border",
        // Off: the track edge uses the control boundary token (≥ 3:1 on cards, WCAG 1.4.11).
        "border-border-input bg-surface-3 transition-colors duration-150",
        "aria-checked:border-accent aria-checked:bg-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        !label && className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-5 translate-x-0.5 rounded-full bg-fg-muted shadow-sm transition-transform duration-150",
          "group-aria-checked:translate-x-6 group-aria-checked:bg-white",
        )}
      />
    </button>
  );

  const hiddenInput = name && isOn ? <input type="hidden" name={name} value={value} /> : null;

  if (!label) {
    return (
      <>
        {control}
        {hiddenInput}
      </>
    );
  }

  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="grid gap-0.5">
        <label
          htmlFor={switchId}
          className={cn("text-sm font-medium", disabled ? "cursor-not-allowed text-fg-muted" : "cursor-pointer text-fg")}
        >
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-sm text-fg-muted">
            {description}
          </p>
        )}
      </div>
      {control}
      {hiddenInput}
    </div>
  );
}
