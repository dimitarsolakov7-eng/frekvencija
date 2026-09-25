import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface FormHeadingProps {
  /** Small uppercase label above the title, e.g. "WELCOME BACK". */
  eyebrow?: ReactNode;
  /** The page's single <h1>. */
  title: ReactNode;
  description?: ReactNode;
  /** Id for the heading (e.g. to label the form with aria-labelledby). */
  id?: string;
  className?: string;
}

/**
 * Heading block of the login form system (screen 02): eyebrow, large title, short supporting line.
 * Shared by the auth pages and the public request-access form.
 */
export function FormHeading({ eyebrow, title, description, id, className }: FormHeadingProps) {
  return (
    <div className={cn("grid gap-2", className)}>
      {eyebrow && <p className="text-xs font-medium tracking-[0.14em] text-fg-muted uppercase">{eyebrow}</p>}
      <h1 id={id} className="text-3xl font-bold tracking-tight text-fg text-balance sm:text-[2.125rem] sm:leading-tight">
        {title}
      </h1>
      {description && <div className="text-base text-fg-muted text-pretty">{description}</div>}
    </div>
  );
}

/** Consistent inline text link for the form system (emerald, underlined on hover/focus). */
export const FORM_LINK_CLASSES =
  "rounded-sm font-medium text-accent-text underline underline-offset-4 decoration-accent-text/40 hover:decoration-accent-text focus-visible:decoration-accent-text";

/** Horizontal hairline divider used between a form and its secondary links. */
export function FormDivider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-border", className)} />;
}
