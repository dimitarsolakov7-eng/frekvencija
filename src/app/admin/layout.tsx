import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/shell";
import { PLATFORM_NAME } from "@/config/platform";
import { requireAdminPage } from "@/lib/auth/session";

// Per-user, auth-gated area: never prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Title templates don't chain, so the platform name is repeated here.
  title: { template: `%s · Admin · ${PLATFORM_NAME}`, default: `Admin · ${PLATFORM_NAME}` },
  robots: { index: false, follow: false },
};

/**
 * Admin workspace shell (AppShell: sidebar, account menu, mobile drawer). Signed-out visitors go
 * to /login and venue users to "/". Every admin page, action and route handler still authorises
 * itself (a layout does not protect its children on its own). Pages render only their content.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const ctx = await requireAdminPage();
  return <AdminShell email={ctx.email}>{children}</AdminShell>;
}
