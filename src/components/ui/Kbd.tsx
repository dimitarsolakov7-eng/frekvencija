import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils/cn";

/** Keyboard key, e.g. in the player's shortcut list: <Kbd>Space</Kbd>. */
export function Kbd({ className, ...props }: ComponentPropsWithRef<"kbd">) {
  return (
    <kbd
      {...props}
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 border-border-strong",
        "bg-surface-2 px-1.5 font-mono text-xs font-medium text-fg",
        className,
      )}
    />
  );
}
