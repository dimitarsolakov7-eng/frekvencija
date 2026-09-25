import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  label: ReactNode;
  /** Secondary text under the label, linked with aria-describedby. */
  description?: ReactNode;
  /**
   * `plain` (default): box + label. `tile`: the whole row is a bordered 44px tile that highlights
   * when checked, as in the genre-access grid of screen 06.
   */
  variant?: "plain" | "tile";
}

/** Native checkbox (emerald when checked) with a clickable label and optional description. */
export function Checkbox({ label, description, id, className, disabled, variant = "plain", ...props }: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}checkbox`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const describedBy = [props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined;
  const tile = variant === "tile";

  return (
    <div
      className={cn(
        "relative flex items-start gap-3",
        // Tile edge ≥ 3:1 against the card, also when checked (accent/60 ≈ 3.45:1; see globals.css).
        tile &&
          "min-h-11 rounded-control border border-border-input bg-control px-3 py-2.5 transition-colors " +
            "hover:border-border-input-hover has-checked:border-accent/60 has-checked:bg-accent/10",
        disabled && "opacity-60",
        className,
      )}
    >
      <input
        {...props}
        id={inputId}
        type="checkbox"
        disabled={disabled}
        aria-describedby={describedBy}
        className={cn(
          "size-5 shrink-0 cursor-pointer rounded accent-accent disabled:cursor-not-allowed",
          !tile && "mt-0.5",
        )}
      />
      <div className="grid min-w-0 gap-0.5">
        <label
          htmlFor={inputId}
          className={cn(
            "text-sm font-medium text-fg",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
            // In a tile the label covers the whole tile, so any click in it toggles the box.
            tile && "after:absolute after:inset-0 after:content-['']",
          )}
        >
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-sm text-fg-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
