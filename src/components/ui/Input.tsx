import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils/cn";
import { CONTROL_CLASSES, READ_ONLY_CLASSES } from "./internal/control-styles";

export type InputProps = ComponentPropsWithRef<"input">;

/**
 * Single-line text input, 44px tall with 16px text (prevents iOS zoom on focus).
 * Wrap it in <Field> to get a label, hint and error wiring.
 */
export function Input({ className, type = "text", ...props }: InputProps) {
  return <input {...props} type={type} className={cn(CONTROL_CLASSES, READ_ONLY_CLASSES, "h-11 px-3.5", className)} />;
}
