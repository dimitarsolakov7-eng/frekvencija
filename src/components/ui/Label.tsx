import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils/cn";

export interface LabelProps extends ComponentPropsWithRef<"label"> {
  /**
   * Shows a visual "required" marker. The control itself must carry the `required` attribute,
   * which is what assistive technology announces (the marker is hidden from it).
   */
  required?: boolean;
  /** Shows a muted "(optional)" suffix instead. */
  optional?: boolean;
}

export function Label({ required = false, optional = false, className, children, ...props }: LabelProps) {
  return (
    <label {...props} className={cn("text-sm font-medium text-fg", className)}>
      {children}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-danger">
          *
        </span>
      )}
      {optional && !required && <span className="ml-1.5 font-normal text-fg-subtle">(optional)</span>}
    </label>
  );
}
