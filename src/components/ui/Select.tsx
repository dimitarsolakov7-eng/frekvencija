import type { ComponentPropsWithRef, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { CONTROL_CLASSES } from "./internal/control-styles";

export interface SelectProps extends ComponentPropsWithRef<"select"> {
  /**
   * Renders a leading empty option (value ""). Combined with `required`, the browser refuses to
   * submit until a real option is chosen.
   */
  placeholder?: string;
  /**
   * Decorative element inside the control, before the value (e.g. a status dot or <GenreDot>, as
   * in the "● Active" selects of screens 05/06). Hidden from assistive technology.
   */
  leading?: ReactNode;
}

/**
 * Native <select> with the app's styling (the OS picker keeps full keyboard and screen reader
 * support). `className` applies to the wrapper so it can size the control; other props go to
 * the <select>.
 */
export function Select({ placeholder, leading, className, children, multiple, ...props }: SelectProps) {
  return (
    <div className={cn("relative w-full", className)}>
      {leading && !multiple && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 flex -translate-y-1/2 items-center [&_svg]:size-4"
        >
          {leading}
        </span>
      )}
      <select
        {...props}
        multiple={multiple}
        className={cn(
          CONTROL_CLASSES,
          "appearance-none [&>option]:bg-surface-2 [&>option]:text-fg",
          multiple ? "min-h-28 px-2 py-2" : "h-11 cursor-pointer pr-10",
          !multiple && (leading ? "pl-9" : "pl-3.5"),
        )}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {children}
      </select>
      {!multiple && (
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted"
        />
      )}
    </div>
  );
}
