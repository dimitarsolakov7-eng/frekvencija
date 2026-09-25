import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils/cn";

/** Text for assistive technology only (e.g. extra context for an icon-heavy row). */
export function VisuallyHidden({ className, ...props }: ComponentPropsWithRef<"span">) {
  return <span {...props} className={cn("sr-only", className)} />;
}

export interface SkipLinkProps extends Omit<ComponentPropsWithRef<"a">, "href"> {
  /** Fragment of the main landmark. Default "#main-content". */
  href?: `#${string}`;
}

/**
 * "Skip to content" link that appears on keyboard focus. Render it first in an app shell and give
 * that shell's <main> the matching id (and tabIndex={-1} so it can take focus).
 */
export function SkipLink({ href = "#main-content", className, children = "Skip to content", ...props }: SkipLinkProps) {
  return (
    <a
      {...props}
      href={href}
      className={cn(
        "sr-only rounded-control bg-accent px-4 py-2 text-sm font-medium text-accent-fg",
        "focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60]",
        className,
      )}
    >
      {children}
    </a>
  );
}
