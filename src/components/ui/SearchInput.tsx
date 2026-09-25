"use client";

import { useEffect, useId, useState, type ComponentPropsWithRef, type MouseEvent } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { CONTROL_CLASSES } from "./internal/control-styles";

export interface SearchInputProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  /**
   * Accessible name when there is no visible <label>/<Field> (default "Search"). Ignored when
   * `aria-label` or `aria-labelledby` is passed, or when <Field> wires a label to the input.
   */
  label?: string;
  /** Receives the text on every change (controlled or uncontrolled). */
  onValueChange?: (value: string) => void;
  /** Called by the clear (×) button after the text is cleared. */
  onClear?: () => void;
  /** Wrapper classes (width). Use `inputClassName` for the input itself. */
  className?: string;
  inputClassName?: string;
}

/**
 * Search field: 44px, magnifier icon, and a clear button once there is text. Works controlled
 * (`value` + `onValueChange`) or uncontrolled (`defaultValue`, e.g. inside a GET <Form>).
 */
export function SearchInput({
  label = "Search",
  onValueChange,
  onClear,
  className,
  inputClassName,
  value,
  defaultValue,
  onChange,
  ref,
  id,
  ...props
}: SearchInputProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}search`;
  const controlled = value !== undefined;
  const initialText = defaultValue === undefined || defaultValue === null ? "" : String(defaultValue);
  const [uncontrolledText, setUncontrolledText] = useState(initialText);
  const text = controlled ? String(value ?? "") : uncontrolledText;
  const named = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined || id !== undefined;

  // An uncontrolled field returns to its default when its form resets (React resets forms after
  // every form action); keep the clear button in sync.
  useEffect(() => {
    if (controlled) return;
    const element = document.getElementById(inputId);
    const form = element instanceof HTMLInputElement ? element.form : null;
    if (!form) return;
    const handleReset = () => setUncontrolledText(initialText);
    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, [controlled, initialText, inputId]);

  function clear(event: MouseEvent<HTMLButtonElement>) {
    const input = event.currentTarget.parentElement?.querySelector("input");
    if (!controlled && input) input.value = "";
    if (!controlled) setUncontrolledText("");
    onValueChange?.("");
    onClear?.();
    input?.focus();
  }

  return (
    <div className={cn("relative w-full", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 size-[1.125rem] -translate-y-1/2 text-fg-muted"
      />
      <input
        {...props}
        id={inputId}
        ref={ref}
        type="search"
        aria-label={named ? props["aria-label"] : label}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          onChange?.(event);
          if (!controlled) setUncontrolledText(event.currentTarget.value);
          onValueChange?.(event.currentTarget.value);
        }}
        className={cn(
          CONTROL_CLASSES,
          "h-11 pr-11 pl-10 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
          inputClassName,
        )}
      />
      {text.length > 0 && !props.disabled && !props.readOnly && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
