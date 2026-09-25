import type { ReactNode } from "react";
import { Building2, KeyRound, LayoutGrid, LogOut, Megaphone, Music, Settings, type LucideIcon } from "lucide-react";
import {
  AppShell,
  MobileTopBar,
  SidebarBrand,
  SidebarButton,
  SidebarNav,
  SidebarSection,
  UserMenu,
  type SidebarNavItem,
} from "@/components/shell";
import { AdminMobileMenu } from "./AdminMobileMenu";
import {
  ADMIN_HOME_PATH,
  ADMIN_NAV_ITEMS,
  ADMIN_SECONDARY_NAV_ITEMS,
  type AdminNavIcon,
  type AdminNavItem,
} from "./nav-items";
import { UnsavedChangesProvider } from "./unsaved-changes";

const ICONS: Record<AdminNavIcon, LucideIcon> = {
  music: Music,
  genres: LayoutGrid,
  businesses: Building2,
  announcements: Megaphone,
  settings: Settings,
};

/** Plain HTML POST: signs out this device only, then 303 to /login; resets all client state. */
export const ADMIN_SIGN_OUT_ACTION = "/auth/signout";
/** Signed-in password change (the invite/recovery form also serves signed-in users). */
export const ADMIN_CHANGE_PASSWORD_PATH = "/reset-password";
const ADMIN_DISPLAY_NAME = "Administrator";

function toSidebarItem(item: AdminNavItem): SidebarNavItem {
  return { href: item.href, label: item.label, icon: ICONS[item.icon], match: item.exact ? "exact" : "prefix" };
}

export interface AdminShellProps {
  /** Signed-in administrator's email, shown in the account menu. */
  email: string;
  children: ReactNode;
}

/**
 * Admin workspace frame (screens 05–08): sidebar with the logo, "Admin workspace", Music library /
 * Genres / Businesses / Announcements and, at the bottom, Settings and Sign out; an "Administrator"
 * account menu at the top right; below 1024px a top bar whose menu button opens the same navigation
 * in a drawer. Admin pages render only their own content (PageHeading + sections).
 *
 * The whole workspace sits inside one UnsavedChangesProvider: editors that report unsaved work with
 * useUnsavedChangesGuard() are protected against every link out of the page (sidebar, account menu,
 * mobile drawer, breadcrumbs, links inside pages) and against reloading or closing the tab.
 */
export function AdminShell({ email, children }: AdminShellProps) {
  const navigation = <SidebarNav label="Admin" items={ADMIN_NAV_ITEMS.map(toSidebarItem)} />;
  const secondary = ADMIN_SECONDARY_NAV_ITEMS.map((item) => (
    <SidebarButton key={item.href} href={item.href} label={item.label} icon={ICONS[item.icon]} />
  ));

  return (
    <UnsavedChangesProvider>
      <AppShell
        sidebar={
          <>
            <SidebarBrand href={ADMIN_HOME_PATH} eyebrow="Admin workspace" />
            {navigation}
            <SidebarSection>
              {secondary}
              <SidebarButton action={ADMIN_SIGN_OUT_ACTION} label="Sign out" icon={LogOut} />
            </SidebarSection>
          </>
        }
        topBar={
          <UserMenu
            name={ADMIN_DISPLAY_NAME}
            initials="A"
            email={email}
            items={[
              { label: "Settings", href: "/admin/settings", icon: Settings },
              { label: "Change password", href: ADMIN_CHANGE_PASSWORD_PATH, icon: KeyRound },
              { label: "Sign out", action: ADMIN_SIGN_OUT_ACTION, icon: LogOut },
            ]}
          />
        }
        mobileHeader={
          <MobileTopBar
            href={ADMIN_HOME_PATH}
            right={
              <AdminMobileMenu name={ADMIN_DISPLAY_NAME} email={email}>
                {navigation}
                <SidebarSection position="flow" className="mt-2 border-t border-border">
                  {secondary}
                  <SidebarButton href={ADMIN_CHANGE_PASSWORD_PATH} label="Change password" icon={KeyRound} />
                  <SidebarButton action={ADMIN_SIGN_OUT_ACTION} label="Sign out" icon={LogOut} />
                </SidebarSection>
              </AdminMobileMenu>
            }
          />
        }
      >
        {children}
      </AppShell>
    </UnsavedChangesProvider>
  );
}
