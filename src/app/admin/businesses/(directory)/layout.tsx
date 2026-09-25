import type { ReactNode } from "react";
import { BusinessesDirectory } from "@/components/admin/businesses/BusinessesDirectory";
import { requireAdminPage } from "@/lib/auth/session";
import { countNewAccessRequests } from "@/lib/data/admin/access-requests";
import { loadAdminBusinessList, type AdminBusinessList } from "@/lib/data/admin/businesses";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteBusiness, sendBusinessPasswordReset, setBusinessActive } from "../actions";
import { authUserDirectoryOrNull, invitesUnavailableReason, SECRET_KEY_MISSING_REASON } from "../_lib/availability";

export const dynamic = "force-dynamic";

/**
 * Screen 06 frame shared by /admin/businesses, /admin/businesses/[businessId] and
 * /admin/businesses/new: heading and business list on the left, the page (detail, add form or
 * placeholder) in the detail column. As a layout it keeps the list — and its search and filter —
 * while the admin moves between venues; mutations revalidate it.
 */
export default async function BusinessesDirectoryLayout({ children }: { children: ReactNode }) {
  await requireAdminPage("/admin/businesses");
  const supabase = await createSupabaseServerClient();
  const authUsers = await authUserDirectoryOrNull();

  const [list, newRequestCount] = await Promise.all([
    loadAdminBusinessList(supabase, { authUsers, authUnavailableReason: SECRET_KEY_MISSING_REASON }).catch(
      (error: unknown): AdminBusinessList | null => {
        console.error("[admin/businesses] list failed to load", error);
        return null;
      },
    ),
    countNewAccessRequests(supabase),
  ]);

  return (
    <BusinessesDirectory
      list={list}
      newRequestCount={newRequestCount}
      basePath="/admin/businesses"
      announcementsPath="/admin/announcements"
      actions={{ setBusinessActive, sendBusinessPasswordReset, deleteBusiness }}
      accessUnavailableReason={invitesUnavailableReason()}
    >
      {children}
    </BusinessesDirectory>
  );
}
