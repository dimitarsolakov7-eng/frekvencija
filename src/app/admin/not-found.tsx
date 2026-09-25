import type { Metadata } from "next";
import { Building2, Music } from "lucide-react";
import { PageHeading } from "@/components/shell/PageHeading";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Not found" };

/**
 * notFound() inside the admin workspace (e.g. a venue or genre id that no longer exists). Rendered
 * inside the admin layout, so the sidebar, account menu and navigation stay available.
 */
export default function AdminNotFound() {
  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeading
        eyebrow="Error 404"
        title="This page isn’t here"
        description="The item may have been deleted, or the address is mistyped. Nothing was changed."
      />
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/admin/music" icon={<Music aria-hidden="true" />}>
          Go to the music library
        </ButtonLink>
        <ButtonLink href="/admin/businesses" variant="secondary" icon={<Building2 aria-hidden="true" />}>
          Businesses
        </ButtonLink>
      </div>
    </div>
  );
}
