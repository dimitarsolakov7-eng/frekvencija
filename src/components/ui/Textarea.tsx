import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils/cn";
import { CONTROL_CLASSES, READ_ONLY_CLASSES } from "./internal/control-styles";

export type TextareaProps = ComponentPropsWithRef<"textarea">;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      rows={rows}
      className={cn(CONTROL_CLASSES, READ_ONLY_CLASSES, "min-h-24 resize-y px-3.5 py-3 leading-relaxed", className)}
    />
  );
}
