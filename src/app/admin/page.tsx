import { redirect } from "next/navigation";
import { ADMIN_HOME_PATH } from "@/components/admin/shell/nav-items";

// Never prerender: the admin layout authorises every request first.
export const dynamic = "force-dynamic";

/** /admin has no page of its own: the workspace starts in the music library. */
export default function AdminIndexPage(): never {
  redirect(ADMIN_HOME_PATH);
}
