import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { AccessRequestsView } from "@/components/admin/businesses/AccessRequestsView";
import { LoadErrorAlert } from "@/components/admin/businesses/LoadErrorAlert";
import { PageHeading } from "@/components/shell/PageHeading";
import { ButtonLink } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth/session";
import { loadAccessRequests, type AccessRequestList } from "@/lib/data/admin/access-requests";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseAccessRequestFilter } from "@/lib/validation/access-requests";
import { saveAccessRequestNotes, updateAccessRequestStatus } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Access requests" };

/** /admin/businesses/requests?status=…: submissions of the public "Request access" form. */
export default async function AccessRequestsPage({ searchParams }: PageProps<"/admin/businesses/requests">) {
  await requireAdminPage("/admin/businesses/requests");
  const { status } = await searchParams;
  const filter = parseAccessRequestFilter(status);

  let list: AccessRequestList | null = null;
  try {
    list = await loadAccessRequests(await createSupabaseServerClient(), filter);
  } catch (error) {
    console.error("[admin/access-requests] list failed to load", error);
  }

  return (
    <>
      <PageHeading
        breadcrumbs={[{ label: "Businesses", href: "/admin/businesses" }, { label: "Access requests" }]}
        title="Access requests"
        description="Venues asking for their own station. Nothing is approved automatically."
        actions={
          <ButtonLink href="/admin/businesses/new" variant="secondary" icon={<Plus aria-hidden="true" />}>
            Add business
          </ButtonLink>
        }
      />
      {list ? (
        <AccessRequestsView
          requests={list.items}
          counts={list.counts}
          filter={list.filter}
          truncated={list.truncated}
          basePath="/admin/businesses"
          requestsPath="/admin/businesses/requests"
          actions={{ updateAccessRequestStatus, saveAccessRequestNotes }}
        />
      ) : (
        <LoadErrorAlert title="The access requests couldn’t be loaded" />
      )}
    </>
  );
}
