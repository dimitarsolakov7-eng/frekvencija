import type { Route } from "next";
import { ChevronDown } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { renderIcon, type IconLike } from "@/components/ui/internal/render-icon";
import { cn } from "@/lib/utils/cn";

export interface UserMenuItem {
  label: string;
  /** Link item (client-side navigation). */
  href?: Route;
  /** Handler item (Client Components only), e.g. the venue sign-out that stops the player first. */
  onSelect?: () => void;
  /** Form item: POSTs to this URL, e.g. "/auth/signout". Works from Server Components. */
  action?: string;
  /** A lucide icon component (`LogOut`) or element (`<LogOut />`). */
  icon?: IconLike;
  tone?: "default" | "danger";
}

export interface UserMenuProps {
  /** Shown next to the avatar, e.g. "Administrator" or the venue name. */
  name: string;
  /** Shown at the top of the open menu. */
  email?: string | null;
  initials?: string;
  imageUrl?: string | null;
  items: readonly UserMenuItem[];
  /** Avatar only (the name stays in the accessible label and the menu header). */
  compact?: boolean;
  className?: string;
}

/** Avatar + name + chevron that opens an account menu (screens 05–08, top right). */
export function UserMenu({ name, email, initials, imageUrl, items, compact = false, className }: UserMenuProps) {
  const menuItems: DropdownMenuItem[] = items.map((item, index) => ({
    key: `${index}-${item.label}`,
    label: item.label,
    href: item.href,
    onSelect: item.onSelect,
    action: item.action,
    tone: item.tone,
    // Rendered here so a Server Component can pass lucide component icons.
    icon: item.icon === undefined ? undefined : renderIcon(item.icon),
  }));

  return (
    <DropdownMenu
      label={`${name}, account menu`}
      className={className}
      triggerClassName={cn("h-12 gap-3 rounded-full pl-1", compact ? "pr-1" : "pr-3")}
      trigger={
        <>
          <Avatar name={name} initials={initials} imageUrl={imageUrl} size="md" decorative />
          {!compact && <span className="max-w-48 truncate text-[0.9375rem] font-medium text-fg">{name}</span>}
          {!compact && <ChevronDown aria-hidden="true" className="size-4 text-fg-muted" />}
        </>
      }
      header={
        <div className="grid min-w-0 gap-0.5">
          <p className="truncate font-semibold text-fg">{name}</p>
          {email && <p className="truncate text-fg-muted">{email}</p>}
        </div>
      }
      items={menuItems}
    />
  );
}
