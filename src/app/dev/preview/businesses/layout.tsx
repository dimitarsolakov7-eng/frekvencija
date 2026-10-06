import { AdminShell } from "@/components/admin/shell";
import { BusinessesPreviewFrame } from "./BusinessesPreview";
import { PreviewVariants } from "./PreviewVariants";

// Reads the view from the URL on every request.
export const dynamic = "force-dynamic";

/**
 * Development-only preview of screen 06 (/dev/preview/businesses[/<id>|/new|/requests]): the real
 * business list, detail panel, add form and access-request list inside the admin shell, with the
 * design's example venues and no-op actions, so it can be reviewed at 1440/768/390 px without
 * Supabase. `?list=empty|error|nokey` picks a list state. The /dev layout returns 404 in production.
 * Like the app's (directory) layout, this layout holds the business list, so it stays mounted while
 * the page (the detail column) changes.
 */
export default function BusinessesPreviewLayout({ children }: LayoutProps<"/dev/preview/businesses">) {
  return (
    <AdminShell email="admin@frekvencija.online">
      <PreviewVariants />
      <BusinessesPreviewFrame>{children}</BusinessesPreviewFrame>
    </AdminShell>
  );
}
