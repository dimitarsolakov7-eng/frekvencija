import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface AccordionItemProps {
  /** The always-visible question / heading. */
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Items sharing a `name` behave exclusively (opening one closes the others) in current browsers. */
  name?: string;
  id?: string;
  className?: string;
}

/**
 * One disclosure row built on native <details>/<summary>: keyboard (Enter/Space) and screen
 * reader support come from the browser, it works without JavaScript and in Server Components.
 */
export function AccordionItem({ title, children, defaultOpen = false, name, id, className }: AccordionItemProps) {
  return (
    <details id={id} name={name} open={defaultOpen || undefined} className={cn("group border-b border-border", className)}>
      <summary
        className={cn(
          "flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-control py-4 text-left",
          "text-base font-semibold text-fg transition-colors hover:text-accent-text sm:text-lg",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="min-w-0 text-pretty">{title}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 text-fg-muted transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="pr-8 pb-5 text-base text-fg-muted text-pretty">{children}</div>
    </details>
  );
}

export interface AccordionEntry {
  /** Stable key (and element id). */
  id?: string;
  title: ReactNode;
  content: ReactNode;
  defaultOpen?: boolean;
}

export interface AccordionProps {
  /** Rows to render; alternatively pass <AccordionItem> children. */
  items?: readonly AccordionEntry[];
  children?: ReactNode;
  /** Only one row open at a time (native `details[name]`). Default false. */
  exclusive?: boolean;
  className?: string;
}

/** A stack of disclosure rows (e.g. the homepage FAQ). */
export function Accordion({ items, children, exclusive = false, className }: AccordionProps) {
  const groupName = useId();
  return (
    <div className={cn("border-t border-border", className)}>
      {items?.map((item, index) => (
        <AccordionItem
          key={item.id ?? index}
          id={item.id}
          title={item.title}
          defaultOpen={item.defaultOpen}
          name={exclusive ? groupName : undefined}
        >
          {item.content}
        </AccordionItem>
      ))}
      {children}
    </div>
  );
}
