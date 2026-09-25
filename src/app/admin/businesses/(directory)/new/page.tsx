import type { Metadata } from "next";
import {
  ACCESS_REQUEST_STATUS_LABELS,
  isOpenAccessRequestStatus,
  toAccessRequestPrefill,
  type AccessRequestPrefill,
} from "@/components/admin/businesses/access-request-rules";
import { NewBusinessForm } from "@/components/admin/businesses/NewBusinessForm";
import { requireAdminPage } from "@/lib/auth/session";
import { loadAccessRequest } from "@/lib/data/admin/access-requests";
import { loadGenreAccessChoices, type GenreAccessOption } from "@/lib/data/admin/businesses";
import { loadDefaultAnnouncementFrequency } from "@/lib/data/admin/settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation/fields";
import { createBusiness } from "../../actions";
import { invitesUnavailableReason } from "../../_lib/availability";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Add business" };

/**
 * /admin/businesses/new (optionally ?fromRequest=<access request id>): the add form in the detail
 * column. A request prefills name, type, contact email and "<name> Radio".
 */
export default async function NewBusinessPage({ searchParams }: PageProps<"/admin/businesses/new">) {
  await requireAdminPage("/admin/businesses/new");
  const { fromRequest } = await searchParams;
  const requestId = idSchema.safeParse(Array.isArray(fromRequest) ? fromRequest[0] : fromRequest);
  const supabase = await createSupabaseServerClient();
  const notices: string[] = [];

  const [genres, frequency, request] = await Promise.all([
    loadGenreAccessChoices(supabase).catch((error: unknown): GenreAccessOption[] => {
      console.error("[admin/businesses] genres for the add form failed to load", error);
      notices.push("The genres couldn’t be loaded, so none can be ticked here. Create the business and set its genre access afterwards.");
      return [];
    }),
    loadDefaultAnnouncementFrequency(supabase),
    requestId.success
      ? loadAccessRequest(supabase, requestId.data).catch((error: unknown) => {
          console.error("[admin/businesses] access request for the add form failed to load", error);
          notices.push("The access request couldn’t be loaded, so nothing was filled in from it.");
          return null;
        })
      : Promise.resolve(null),
  ]);

  let prefill: AccessRequestPrefill | null = null;
  if (fromRequest !== undefined && !requestId.success) {
    notices.push("The access request link is not valid, so nothing was filled in.");
  } else if (requestId.success && request === null && !notices.some((notice) => notice.includes("access request"))) {
    notices.push("That access request no longer exists, so nothing was filled in.");
  } else if (request) {
    prefill = toAccessRequestPrefill(request);
    if (!isOpenAccessRequestStatus(request.status)) {
      notices.push(
        `This request is already ${ACCESS_REQUEST_STATUS_LABELS[request.status].toLowerCase()}; creating the business won’t change its status.`,
      );
    }
  }

  return (
    <NewBusinessForm
      key={prefill?.requestId ?? "blank"}
      action={createBusiness}
      genres={genres}
      prefill={prefill}
      notices={notices}
      defaultFrequency={frequency}
      invitesUnavailableReason={invitesUnavailableReason()}
      basePath="/admin/businesses"
      settingsHref="/admin/settings"
      genresHref="/admin/genres"
    />
  );
}
