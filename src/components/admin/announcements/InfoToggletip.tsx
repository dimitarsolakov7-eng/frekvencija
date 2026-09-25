"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface InfoToggletipProps {
  /** Accessible name of the button, e.g. "About pronunciation spelling". */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * Small "ⓘ" button that shows a short explanation under the label row (a toggletip: works with
 * touch, keyboard and screen readers, unlike a hover-only tooltip). Escape closes it.
 */
export function InfoToggletip({ label, children, className }: InfoToggletipProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors",
          "hover:bg-surface-2 hover:text-fg aria-expanded:text-accent-text [&_svg]:size-4",
          className,
        )}
      >
        <Info aria-hidden="true" />
      </button>
      <span
        id={id}
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            buttonRef.current?.focus();
          }
        }}
        className="basis-full rounded-control border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-fg-muted text-pretty"
      >
        {children}
      </span>
    </>
  );
}
