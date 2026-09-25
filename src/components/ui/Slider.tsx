"use client";

import { useEffect, useId, useState, type ComponentPropsWithRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";

export interface SliderProps
  extends Omit<
    ComponentPropsWithRef<"input">,
    "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step" | "children"
  > {
  /** Visible label; also the accessible name of the range input. */
  label: string;
  /** Keep the label for assistive technology only (e.g. a volume slider beside a speaker icon). */
  hideLabel?: boolean;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Formats the visible value and `aria-valuetext`, e.g. `(v) => \`${v}%\``. */
  formatValue?: (value: number) => string;
  /** Show the formatted value next to the label. Default true. */
  showValue?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Labelled native range input (arrow keys, Page Up/Down, Home/End work out of the box). */
export function Slider({
  label,
  hideLabel = false,
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  formatValue = String,
  showValue = true,
  id,
  className,
  style,
  ref,
  ...props
}: SliderProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}slider`;
  const initialValue = clamp(defaultValue ?? min, min, max);
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue);
  const isControlled = value !== undefined;
  const current = clamp(isControlled ? value : uncontrolledValue, min, max);
  const progress = max > min ? ((current - min) / (max - min)) * 100 : 0;
  const text = formatValue(current);

  // Uncontrolled sliders return to their default when the owning form resets (React resets forms
  // after every form action). Looked up by id so the caller's `ref` goes straight to the input.
  useEffect(() => {
    if (isControlled) return;
    const element = document.getElementById(inputId);
    const form = element instanceof HTMLInputElement ? element.form : null;
    if (!form) return;
    const handleReset = () => setUncontrolledValue(initialValue);
    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, [isControlled, initialValue, inputId]);

  return (
    <div className={cn("grid gap-1", className)}>
      <div className={cn("flex items-baseline justify-between gap-3", hideLabel && !showValue && "sr-only")}>
        <label htmlFor={inputId} className={cn("text-sm font-medium text-fg", hideLabel && "sr-only")}>
          {label}
        </label>
        {showValue && (
          <span aria-hidden="true" className="ml-auto text-sm text-fg-muted tabular-nums">
            {text}
          </span>
        )}
      </div>
      <input
        {...props}
        ref={ref}
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        aria-valuetext={text}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (!isControlled) setUncontrolledValue(next);
          onValueChange?.(next);
        }}
        className="ui-range"
        style={{ ...style, "--range-progress": `${progress}%` } as CSSProperties}
      />
    </div>
  );
}
