"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Drawer } from "@/components/ui/Drawer";
import { IconButton } from "@/components/ui/IconButton";

export interface AdminMobileMenuProps {
  /** Display name, e.g. "Administrator". */
  name: string;
  email: string;
  /** Drawer body: the same navigation as the sidebar plus the account actions (server-rendered). */
  children: ReactNode;
}

/**
 * Menu button for the admin top bar below 1024px. Opens a left drawer holding the sidebar
 * navigation; it closes when a link is followed (or the route changes) and returns focus to the
 * menu button.
 */
export function AdminMobileMenu({ name, email, children }: AdminMobileMenuProps) {
  const pathname = usePathname();
  // Remembering the path it was opened on closes the drawer automatically after navigation.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  // After a navigation (including browser Back) forget the old path, so returning to it later does
  // not reopen the drawer. Adjusting state during render is React's documented pattern for this.
  if (openedOn !== null && openedOn !== pathname) setOpenedOn(null);
  const open = openedOn !== null && openedOn === pathname;

  function closeOnLink(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("a[href]")) setOpenedOn(null);
  }

  return (
    <>
      <IconButton
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        icon={<Menu />}
        variant="ghost"
        onClick={() => setOpenedOn(pathname)}
        className="-mr-2"
      />
      <Drawer open={open} onClose={() => setOpenedOn(null)} title="Menu" hideTitle side="left" size="sm">
        <div onClickCapture={closeOnLink} className="-mx-5 grid gap-2 sm:-mx-6">
          <div className="flex min-w-0 items-center gap-3 px-6 pb-4">
            <Avatar name={name} initials={name.slice(0, 1)} size="lg" decorative />
            <div className="grid min-w-0">
              <p className="truncate font-semibold text-fg">{name}</p>
              <p className="truncate text-sm text-fg-muted">{email}</p>
            </div>
          </div>
          {children}
        </div>
      </Drawer>
    </>
  );
}
