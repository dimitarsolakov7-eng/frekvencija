import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils/cn";

export interface SidebarIdentityProps {
  /** Venue (or person) name. */
  name: string;
  /** Override the computed initials. */
  initials?: string;
  /** Logo / photo URL; falls back to the initials when missing or broken. */
  imageUrl?: string | null;
  /** Second line, e.g. the station name. */
  subtitle?: ReactNode;
  className?: string;
}

/** Venue identity row under the sidebar logo (screen 03: "E" circle + "EmeraldBar"). */
export function SidebarIdentity({ name, initials, imageUrl, subtitle, className }: SidebarIdentityProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 px-6 pb-6", className)}>
      <Avatar name={name} initials={initials} imageUrl={imageUrl} size="lg" decorative />
      <div className="grid min-w-0">
        <p className="truncate text-base font-semibold text-fg">{name}</p>
        {subtitle && <p className="truncate text-sm text-fg-muted">{subtitle}</p>}
      </div>
    </div>
  );
}
