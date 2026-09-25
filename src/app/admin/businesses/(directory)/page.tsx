import type { Metadata } from "next";
import { BusinessDetailPlaceholder } from "@/components/admin/businesses/DetailPlaceholders";
import { requireAdminPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Businesses" };

/** /admin/businesses: the list (from the layout) with an empty detail column until a venue is chosen. */
export default async function BusinessesPage() {
  await requireAdminPage("/admin/businesses");
  return <BusinessDetailPlaceholder basePath="/admin/businesses" />;
}
