import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Placeholder block while content loads. Hidden from assistive technology: announce loading with
 * a <Spinner> or `aria-busy` on the region instead.
 */
export function Skeleton({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      aria-hidden="true"
      {...props}
      className={cn("animate-pulse rounded-control bg-surface-2", className)}
    />
  );
}
