import type { Route } from "next";
import { permanentRedirect } from "next/navigation";
import { idSchema } from "@/lib/validation/fields";

export const dynamic = "force-dynamic";

/**
 * Former per-venue announcements page. Announcements now live at /admin/announcements with a venue
 * selector (docs/REDESIGN.md §2); old links and bookmarks land on the same venue there. The target
 * page checks the admin session itself.
 */
export default async function LegacyBusinessAnnouncementsPage({ params }: PageProps<"/admin/businesses/[businessId]/announcements">) {
  const { businessId } = await params;
  const target = idSchema.safeParse(businessId).success
    ? `/admin/announcements?business=${encodeURIComponent(businessId)}`
    : "/admin/announcements";
  permanentRedirect(target as Route);
}
