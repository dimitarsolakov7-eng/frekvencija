import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { CONTAINER } from "./layout";

/** Centred page column with the website's gutters. */
export function Container({ className, ...props }: ComponentPropsWithRef<"div">) {
  return <div {...props} className={cn(CONTAINER, className)} />;
}

export interface EyebrowProps extends ComponentPropsWithRef<"p"> {
  /** Draw a short frequency tick before the text. */
  tick?: boolean;
}

/** Small uppercase label above a title ("ЗОШТО FREKVENCIJA"); cobalt on ivory. */
export function Eyebrow({ tick = true, className, children, ...props }: EyebrowProps) {
  return (
    <p {...props} className={cn("eyebrow flex items-center gap-2.5 text-accent-text", className)}>
      {tick && <span aria-hidden="true" className="h-px w-6 bg-accent-text" />}
      <span>{children}</span>
    </p>
  );
}

export interface SectionHeadingProps {
  id: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  /** `start` (default) or `center`. */
  align?: "start" | "center";
  /** Heading level; default h2. */
  as?: "h1" | "h2" | "h3";
  /** Display size of the title; default `lg`. */
  size?: "xl" | "lg" | "md";
  className?: string;
}

/** Eyebrow, editorial serif title and an optional lead paragraph. */
export function SectionHeading({ id, eyebrow, title, lead, align = "start", as: Heading = "h2", size = "lg", className }: SectionHeadingProps) {
  return (
    <div className={cn("grid gap-5", align === "center" && "justify-items-center text-center", className)}>
      {eyebrow && <Eyebrow tick={align === "start"}>{eyebrow}</Eyebrow>}
      <Heading id={id} className={cn(size === "xl" ? "display-xl" : size === "md" ? "display-md" : "display-lg", "max-w-[18ch] text-fg")}>
        {title}
      </Heading>
      {lead && <p className={cn("max-w-[56ch] text-lg leading-relaxed text-fg-muted text-pretty sm:text-xl", align === "center" && "mx-auto")}>{lead}</p>}
    </div>
  );
}

/** Thin warm rule between editorial blocks. */
export function Rule({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-border", className)} />;
}
