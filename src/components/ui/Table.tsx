import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface TableProps extends ComponentPropsWithRef<"table"> {
  /** Describes the table for screen readers (visually hidden unless `showCaption`). */
  caption?: ReactNode;
  showCaption?: boolean;
  /** Classes for the scrolling wrapper (the table itself gets `className`). */
  wrapperClassName?: string;
}

/**
 * Data table in a bordered card frame (screen 05): quiet sentence-case header, hairline row
 * separators, roomy rows. On narrow screens the frame scrolls horizontally instead of squeezing
 * columns, so the column labels stay attached to their data; header cells never wrap.
 */
export function Table({ caption, showCaption = false, wrapperClassName, className, children, ...props }: TableProps) {
  return (
    <div className={cn("w-full overflow-x-auto rounded-card border border-border bg-surface", wrapperClassName)}>
      <table {...props} className={cn("w-full border-collapse text-left text-sm", className)}>
        {caption && (
          <caption
            className={cn(showCaption ? "px-4 pt-4 pb-2 text-left text-sm font-medium text-fg" : "sr-only")}
          >
            {caption}
          </caption>
        )}
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...props }: ComponentPropsWithRef<"thead">) {
  return <thead {...props} className={cn("border-b border-border text-sm text-fg-muted", className)} />;
}

export function TBody({ className, ...props }: ComponentPropsWithRef<"tbody">) {
  return (
    <tbody
      {...props}
      className={cn(
        "[&>tr]:border-b [&>tr]:border-border [&>tr:last-child]:border-0 [&>tr:hover]:bg-surface-2/60",
        className,
      )}
    />
  );
}

export interface TRProps extends ComponentPropsWithRef<"tr"> {
  /**
   * Highlights the row (emerald tint), e.g. the track open in the editor. Visual only: convey the
   * selection with a checkbox, `aria-current` on the row's link, or text.
   */
  selected?: boolean;
}

export function TR({ selected = false, className, ...props }: TRProps) {
  return (
    <tr
      {...props}
      data-selected={selected || undefined}
      className={cn("transition-colors data-selected:bg-accent/10 data-selected:hover:bg-accent/15", className)}
    />
  );
}

interface CellAlignment {
  /** Right-align with tabular figures (durations, sizes, counts). */
  numeric?: boolean;
}

export function TH({ numeric = false, scope = "col", className, ...props }: ComponentPropsWithRef<"th"> & CellAlignment) {
  return (
    <th
      {...props}
      scope={scope}
      className={cn("h-12 px-4 font-medium whitespace-nowrap", numeric ? "text-right" : "text-left", className)}
    />
  );
}

export function TD({ numeric = false, className, ...props }: ComponentPropsWithRef<"td"> & CellAlignment) {
  return (
    <td {...props} className={cn("px-4 py-3.5 align-middle", numeric && "text-right tabular-nums", className)} />
  );
}
