import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface CardProps extends ComponentPropsWithRef<"div"> {
  /**
   * `default`: surface card with a hairline border. `selected`: emerald hairline outline, e.g. the
   * selected genre or business. `inset`: a quieter well inside another card (upload queue rows,
   * audio preview).
   */
  variant?: "default" | "selected" | "inset";
}

const VARIANT_CLASSES: Record<NonNullable<CardProps["variant"]>, string> = {
  default: "border-border bg-surface shadow-card",
  selected: "border-accent bg-surface shadow-card ring-1 ring-inset ring-accent/40",
  inset: "border-border bg-control",
};

/** 12px-radius surface with a hairline border (screens 03–08). */
export function Card({ variant = "default", className, ...props }: CardProps) {
  return <div {...props} className={cn("rounded-card border", VARIANT_CLASSES[variant], className)} />;
}

export interface CardHeaderProps extends ComponentPropsWithRef<"div"> {
  /** Buttons or links aligned to the right of the title block. */
  actions?: ReactNode;
}

export function CardHeader({ actions, className, children, ...props }: CardHeaderProps) {
  return (
    <div {...props} className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6", className)}>
      <div className="grid min-w-0 flex-1 gap-1">{children}</div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface CardTitleProps extends ComponentPropsWithRef<"h2"> {
  /** Heading level to keep the document outline correct. Default h2. */
  as?: "h2" | "h3" | "h4";
}

export function CardTitle({ as: Heading = "h2", className, ...props }: CardTitleProps) {
  return (
    <Heading {...props} className={cn("text-lg font-bold tracking-tight text-fg text-balance sm:text-xl", className)} />
  );
}

export function CardDescription({ className, ...props }: ComponentPropsWithRef<"p">) {
  return <p {...props} className={cn("text-sm text-fg-muted text-pretty", className)} />;
}

export function CardContent({ className, ...props }: ComponentPropsWithRef<"div">) {
  return <div {...props} className={cn("px-5 py-5 sm:px-6", className)} />;
}

export function CardFooter({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      {...props}
      className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4 sm:px-6", className)}
    />
  );
}
