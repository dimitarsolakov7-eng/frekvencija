import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { AnnouncementStudio } from "@/components/admin/announcements/AnnouncementStudio";
import { PageHeading } from "@/components/shell";
import { ButtonLink, EmptyState } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth/session";
import { loadAnnouncementsPage, loadAnnouncementVenues } from "@/lib/data/admin/announcements";
import { isTtsConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation/fields";
import {
  activateAnnouncementAction,
  approveAnnouncementAction,
  createAnnouncementDraftAction,
  deactivateAnnouncementAction,
  deleteAnnouncementAction,
  duplicateAnnouncementAction,
  markAnnouncementFailedAction,
  updateAnnouncementSettingsAction,
  updateAnnouncementWordingAction,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Announcements" };

const PAGE_PATH = "/admin/announcements";

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

function venueHref(businessId: string): Route {
  return `${PAGE_PATH}?business=${encodeURIComponent(businessId)}` as Route;
}

/**
 * /admin/announcements?business=<id>[&announcement=<id>] — the venue's announcement studio
 * (screen 07). Without a venue the first one (by name) opens; the optional `announcement` opens that
 * recording in the editor. Admin only: the admin layout checks the session and every action and
 * route handler checks it again.
 */
export default async function AnnouncementsPage({ searchParams }: PageProps<"/admin/announcements">) {
  const params = await searchParams;
  const requested = firstParam(params.business);
  const requestedValid = requested !== null && idSchema.safeParse(requested).success;
  await requireAdminPage(requestedValid ? venueHref(requested) : PAGE_PATH);

  const supabase = await createSupabaseServerClient();
  const venues = await loadAnnouncementVenues(supabase);

  if (venues.length === 0) {
    return (
      <>
        <PageHeading title="Announcements" description="Your music. Their name." />
        <EmptyState
          icon={<Building2 />}
          title="Add a business first"
          description="Announcements belong to a venue. Add a business, then create its welcome message and station identity here."
          action={
            <ButtonLink href={"/admin/businesses/new" as Route} icon={<Plus aria-hidden="true" />}>
              Add business
            </ButtonLink>
          }
        />
      </>
    );
  }

  if (requested === null) redirect(venueHref(venues[0].id));

  const venue = requestedValid ? venues.find((candidate) => candidate.id === requested) : undefined;
  const data = venue ? await loadAnnouncementsPage(supabase, venue.id) : null;
  if (!data) {
    return (
      <>
        <PageHeading
          breadcrumbs={[{ label: "Businesses", href: "/admin/businesses" as Route }, { label: "Announcements" }]}
          title="Announcements"
          description="Your music. Their name."
        />
        <EmptyState
          icon={<Building2 />}
          title="This venue could not be found"
          description="It may have been deleted, or the link is incomplete. Choose a venue to manage its announcements."
          action={
            <>
              <ButtonLink href={venueHref(venues[0].id)}>Open {venues[0].name}</ButtonLink>
              <ButtonLink href={"/admin/businesses" as Route} variant="secondary">
                All businesses
              </ButtonLink>
            </>
          }
        />
      </>
    );
  }

  const { business, announcements, now, suggestedVoiceId } = data;
  const requestedRecording = firstParam(params.announcement);
  const initialDraft = requestedRecording ? announcements.find((item) => item.id === requestedRecording) : undefined;

  return (
    <AnnouncementStudio
      // A different venue starts with a fresh editor.
      key={business.id}
      business={business}
      announcements={announcements}
      venues={venues}
      serverNow={now}
      suggestedVoiceId={suggestedVoiceId}
      ttsConfigured={isTtsConfigured()}
      // An on-air recording opens as a new version; it keeps playing until the new one is approved.
      initialDraftId={initialDraft?.id ?? null}
      actions={{
        updateSettings: updateAnnouncementSettingsAction.bind(null, business.id),
        createDraft: createAnnouncementDraftAction.bind(null, business.id),
        updateWording: updateAnnouncementWordingAction,
        approve: approveAnnouncementAction,
        activate: activateAnnouncementAction,
        deactivate: deactivateAnnouncementAction,
        duplicate: duplicateAnnouncementAction,
        remove: deleteAnnouncementAction,
        markFailed: markAnnouncementFailedAction,
      }}
    />
  );
}
