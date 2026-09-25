import { BedDouble, Coffee, Martini, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { PUBLIC_CONTAINER } from "./layout";

const AUDIENCES: readonly { label: string; icon: LucideIcon }[] = [
  { label: "For cafés.", icon: Coffee },
  { label: "For restaurants.", icon: UtensilsCrossed },
  { label: "For hotels.", icon: BedDouble },
  { label: "For bars.", icon: Martini },
];

/** The low-key "For cafés. For restaurants. For hotels. For bars." row under the hero. */
export function AudienceRow() {
  return (
    <section aria-label="Who it’s for" className="border-y border-border bg-sidebar/60">
      <ul className={cn(PUBLIC_CONTAINER, "grid grid-cols-2 gap-y-1 py-4 sm:py-5 lg:grid-cols-4")}>
        {AUDIENCES.map(({ label, icon: Icon }, index) => (
          <li
            key={label}
            className={cn(
              "flex items-center gap-3 px-2 py-2 text-sm text-fg sm:justify-center sm:text-base",
              index > 0 && "lg:border-l lg:border-border",
            )}
          >
            <Icon aria-hidden="true" strokeWidth={1.5} className="size-6 shrink-0 text-fg-muted" />
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
