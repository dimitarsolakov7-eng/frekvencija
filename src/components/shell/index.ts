/**
 * App-shell building blocks shared by the venue area and the admin workspace (docs/REDESIGN.md §5).
 * They render on the server; only the current-link logic (ShellNavLink), the menu (UserMenu's
 * DropdownMenu) and the metrics observer run on the client, so icons may be passed as lucide
 * components even from Server Components.
 */
export { AppShell, type AppShellProps } from "./AppShell";
export { MobileTabBar, type MobileTabBarItem, type MobileTabBarProps } from "./MobileTabBar";
export { MobileTopBar, type MobileTopBarProps } from "./MobileTopBar";
export { ariaCurrentFor, navItemState, normalizePath, type NavItemState, type NavMatch } from "./nav-state";
export { PageHeading, type PageHeadingProps } from "./PageHeading";
export { ShellNavLink, type ShellNavLinkProps } from "./ShellNavLink";
export { SidebarBrand, type SidebarBrandProps } from "./SidebarBrand";
export { SidebarButton, type SidebarButtonProps } from "./SidebarButton";
export { SidebarIdentity, type SidebarIdentityProps } from "./SidebarIdentity";
export { SidebarNav, type SidebarNavItem, type SidebarNavProps } from "./SidebarNav";
export { SidebarSection, type SidebarSectionProps } from "./SidebarSection";
export { UserMenu, type UserMenuItem, type UserMenuProps } from "./UserMenu";
