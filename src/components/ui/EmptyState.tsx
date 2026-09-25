import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface EmptyStateProps {
  /** Decorative icon element, e.g. `<Music />`. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary next step, e.g. a "Upload music" button. */
  action?: ReactNode;
  /** Heading level for the title. Default h2. */
  headingLevel?: "h2" | "h3";
  className?: string;
}

/** Friendly "nothing here yet" block that explains why and offers the next step. */
export function EmptyState({ icon, title, description, action, headingLevel = "h2", className }: EmptyStateProps) {
  const Heading = headingLevel;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border-strong",
        "px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-fg-muted [&_svg]:size-6"
        >
          {icon}
        </div>
      )}
      <Heading className="text-base font-semibold text-fg text-balance">{title}</Heading>
      {description && <div className="max-w-md text-sm text-fg-muted text-pretty">{description}</div>}
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
