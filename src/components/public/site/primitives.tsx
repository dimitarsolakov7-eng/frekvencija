import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { CONTAINER } from "./layout";

/** Centred page column with the website's gutters. */
export function Container({ className, ...props }: ComponentPropsWithRef<"div">) {
  return <div {...props} className={cn(CONTAINER, className)} />;
}

export interface SectionLabelProps {
  /** Two-digit chapter number, e.g. "01". */
  index?: string;
  children: ReactNode;
  /** Render as the section's heading (when the section has no other one). */
  as?: "p" | "h2";
  id?: string;
  className?: string;
}

/** "(01) —— MANIFESTO": the small monospaced label that opens a chapter of the page. */
export function SectionLabel({ index, children, as: Tag = "p", id, className }: SectionLabelProps) {
  return (
    <Tag id={id} className={cn("label-mono flex items-center gap-3 text-fg-muted", className)}>
      {index && <span className="text-accent-text">({index})</span>}
      <span aria-hidden="true" className="h-px w-8 bg-fg-subtle/60" />
      <span>{children}</span>
    </Tag>
  );
}

/** A live dot: the signal colour with a soft halo that pings a few times. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative flex size-2.5 shrink-0", className)}>
      <span className="absolute inline-flex size-full rounded-full bg-accent opacity-70 motion-safe:animate-ping motion-safe:[animation-iteration-count:4]" />
      <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
    </span>
  );
}

/** Four-point star used as a separator (decorative). */
export function Spark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={cn("shrink-0", className)}>
      <path d="M12 0c.6 6.2 5.8 11.4 12 12-6.2.6-11.4 5.8-12 12C11.4 17.8 6.2 12.6 0 12 6.2 11.4 11.4 6.2 12 0Z" />
    </svg>
  );
}
