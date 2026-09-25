"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { Alert, Card, Tabs } from "@/components/ui";
import type { AdminBusinessDetail } from "@/lib/data/admin/businesses";
import type { BusinessDetailActions } from "./action-types";
import { useBusinessDialogs } from "./BusinessActionDialogs";
import { BusinessAccessPanel } from "./BusinessAccessPanel";
import { BusinessAnnouncementsSummary } from "./BusinessAnnouncementsSummary";
import { BusinessIdentity } from "./BusinessIdentity";
import { BusinessProfileForm } from "./BusinessProfileForm";
import { isBusinessDetailTab, type BusinessDetailTab } from "./detail-tabs";
import { uploadLogoToStorage, type LogoUploader } from "./logo-upload";

export interface BusinessDetailPanelProps {
  detail: AdminBusinessDetail;
  actions: BusinessDetailActions;
  /** Why invitations and resets can't be sent (no secret key), or null. */
  invitesUnavailableReason: string | null;
  /** "/admin/genres" */
  genresHref: string;
  initialTab?: BusinessDetailTab;
  /** Just created: show the "what next" notice. */
  justCreated?: boolean;
  /** Logo upload implementation (the development preview passes a simulated one). */
  uploadLogo?: LogoUploader;
}

/**
 * The detail panel of screen 06: tabs Profile / Access / Announcements for one venue. Tab panels stay
 * mounted, so switching tabs never loses unsaved profile edits.
 */
export function BusinessDetailPanel({
  detail,
  actions,
  invitesUnavailableReason,
  genresHref,
  initialTab = "profile",
  justCreated = false,
  uploadLogo = uploadLogoToStorage,
}: BusinessDetailPanelProps) {
  const dialogs = useBusinessDialogs();
  const [tab, setTab] = useState<BusinessDetailTab>(initialTab);
  const { business } = detail;
  const announcementsHref = dialogs.announcementsHref(business.id);
  const memberEmails = detail.members.map((member) => member.email);

  return (
    <Card aria-label={`${business.name} details`} className="@container overflow-hidden">
      {justCreated && (
        <div className="px-5 pt-5 sm:px-6">
          <Alert
            tone="success"
            title={`${business.name} was created`}
            description={
              detail.members.length === 0
                ? "Next: invite the venue’s contact on the Access tab, and add a welcome message and station identity."
                : "Next: add a welcome message and station identity on the Announcements page."
            }
            action={
              <Link href={dialogs.detailHref(business.id) as Route} scroll={false} className="text-sm font-medium text-fg underline underline-offset-4">
                Dismiss
              </Link>
            }
          />
        </div>
      )}
      <Tabs
        label={`${business.name} sections`}
        value={tab}
        onValueChange={(value) => {
          if (isBusinessDetailTab(value)) setTab(value);
        }}
        listClassName="px-4 pt-2 sm:px-5 [&>[role=tab]]:px-3"
        panelClassName="px-5 pb-6 sm:px-6"
        items={[
          {
            value: "profile",
            label: "Profile",
            content: (
              <div className="grid gap-6">
                <BusinessIdentity
                  business={business}
                  logoUrl={detail.logoUrl}
                  status={detail.status}
                  memberCount={detail.members.length}
                  memberEmails={memberEmails}
                  removeBusinessLogo={actions.removeBusinessLogo}
                  uploadLogo={uploadLogo}
                />
                <BusinessProfileForm
                  // One form per venue: newer saved data is merged into it (BIZ-01), never re-mounted over edits.
                  key={business.id}
                  business={business}
                  genres={detail.genres}
                  status={detail.status}
                  announcementCount={detail.announcements.total}
                  memberCount={detail.members.length}
                  memberEmails={memberEmails}
                  saveBusinessProfile={actions.saveBusinessProfile}
                  genresHref={genresHref}
                  announcementsHref={announcementsHref}
                />
              </div>
            ),
          },
          {
            value: "access",
            label: "Access",
            content: (
              <BusinessAccessPanel
                businessId={business.id}
                businessName={business.name}
                contactEmail={business.contactEmail}
                status={detail.status}
                members={detail.members}
                statusNote={detail.memberStatusNote}
                invitesUnavailableReason={invitesUnavailableReason}
                actions={actions}
              />
            ),
          },
          {
            value: "announcements",
            label: "Announcements",
            content: (
              <BusinessAnnouncementsSummary
                stationName={business.stationName}
                isActive={business.isActive}
                summary={detail.announcements}
                everyNTracks={business.announcementEveryNTracks}
                volume={business.announcementVolume}
                announcementsHref={announcementsHref}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
