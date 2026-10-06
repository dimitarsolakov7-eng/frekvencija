"use client";

import type { ReactNode } from "react";
import type { Route } from "next";
import { usePathname, useSearchParams } from "next/navigation";
import { AccessRequestsView } from "@/components/admin/businesses/AccessRequestsView";
import { toAccessRequestPrefill } from "@/components/admin/businesses/access-request-rules";
import type {
  AccessRequestActions,
  BusinessDetailActions,
  BusinessDirectoryActions,
  CreateBusinessAction,
  MemberAccessState,
  NewBusinessState,
} from "@/components/admin/businesses/action-types";
import { BusinessDetailPanel } from "@/components/admin/businesses/BusinessDetailPanel";
import { BusinessesDirectory } from "@/components/admin/businesses/BusinessesDirectory";
import { BusinessDetailPlaceholder, BusinessNotFound } from "@/components/admin/businesses/DetailPlaceholders";
import type { BusinessDetailTab } from "@/components/admin/businesses/detail-tabs";
import type { LogoUploader } from "@/components/admin/businesses/logo-upload";
import { NewBusinessForm } from "@/components/admin/businesses/NewBusinessForm";
import { PageHeading } from "@/components/shell/PageHeading";
import type { ActionState } from "@/lib/actions/state";
import { UploadError } from "@/lib/uploads/client";
import {
  EMERALDBAR_ID,
  FIXTURE_REQUEST_ID,
  FIXTURE_REQUEST_PROBLEMS,
  FIXTURE_REQUESTS,
  fixtureDetail,
  fixtureGenres,
  fixtureListItems,
  fixtureRequestCounts,
  parseListState,
  PREVIEW_BASE_PATH,
  type PreviewListState,
} from "./fixtures";

const NOTE = "(Preview only: nothing was saved.)";
const NO_KEY_REASON =
  "SUPABASE_SECRET_KEY is not set on the server, so staff sign-in statuses can’t be read and invitations and password resets can’t be sent.";

function ok<V extends Record<string, string> = Record<string, string>>(message: string): ActionState<V> {
  return { ok: true, message: `${message} ${NOTE}`, fieldErrors: {}, nonce: Date.now() };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const handle = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(handle);
      reject(new UploadError("aborted", "Upload cancelled."));
    });
  });
}

const directoryActions: BusinessDirectoryActions = {
  setBusinessActive: async (_id, isActive) => ok(isActive ? "The venue is active." : "The venue is inactive."),
  sendBusinessPasswordReset: async () => ok("Password reset email sent."),
  deleteBusiness: async () => ok("The business was deleted."),
};

function previewLink(email: string, type: "invite" | "recovery") {
  return { url: `https://frekvencija.online/auth/confirm?token_hash=preview-only&type=${type}&next=/reset-password`, type, email };
}

const detailActions: BusinessDetailActions = {
  saveBusinessProfile: async () => {
    await wait(500);
    return ok("Changes saved.");
  },
  removeBusinessLogo: async () => ok("Logo removed."),
  inviteMember: async (_previous, formData): Promise<MemberAccessState> => {
    const email = String(formData.get("email") ?? "");
    const link = formData.get("delivery") === "link" ? previewLink(email, "invite") : null;
    return { ...ok(link ? `One-time invite link created for ${email}.` : `Invitation sent to ${email}.`), link };
  },
  sendMemberAccess: async (_businessId, _userId, delivery): Promise<MemberAccessState> => ({
    ...ok(delivery === "link" ? "One-time link created." : "Email sent."),
    link: delivery === "link" ? previewLink("manager@emeraldbar.example", "recovery") : null,
  }),
  removeMember: async () => ok("The account was removed from the venue."),
};

const createBusiness: CreateBusinessAction = async (_previous, formData): Promise<NewBusinessState> => {
  await wait(600);
  const name = String(formData.get("name") ?? "").trim() || "New venue";
  return {
    ok: true,
    message: `${name} was created. ${NOTE} The preview opens EmeraldBar instead.`,
    fieldErrors: {},
    created: { id: EMERALDBAR_ID, name },
    link: null,
    warnings: [],
    nonce: Date.now(),
  };
};

const requestActions: AccessRequestActions = {
  updateAccessRequestStatus: async () => ok("The request was updated."),
  saveAccessRequestNotes: async () => ok("Notes saved."),
};

/** Simulated logo upload: progress without a server; the picture stays local to this page. */
const previewUploadLogo: LogoUploader = async ({ file, signal, onPhase, onProgress }) => {
  onPhase("signing");
  await wait(300, signal);
  onPhase("uploading");
  for (let step = 1; step <= 5; step += 1) {
    await wait(200, signal);
    onProgress(step / 5);
  }
  onPhase("validating");
  await wait(400, signal);
  return { logoPath: `preview/${file.name}`, logoUrl: URL.createObjectURL(file) };
};

/** The detail column of screen 06 for a URL segment: the placeholder, the add form or a venue. */
function DetailColumn({ segment, tab, fromRequest, created, listState }: BusinessesPreviewDetailProps) {
  if (segment === "") return <BusinessDetailPlaceholder basePath={PREVIEW_BASE_PATH} />;
  if (segment === "new") {
    const request = fromRequest ? FIXTURE_REQUESTS.find((item) => item.id === FIXTURE_REQUEST_ID) : undefined;
    return (
      <NewBusinessForm
        key={request ? "from-request" : "blank"}
        action={createBusiness}
        genres={fixtureGenres()}
        prefill={request ? toAccessRequestPrefill(request) : null}
        notices={[]}
        defaultFrequency={{ everyNTracks: 4, fromSettings: true }}
        invitesUnavailableReason={listState === "nokey" ? NO_KEY_REASON : null}
        basePath={PREVIEW_BASE_PATH}
        settingsHref="/dev/preview/settings"
        genresHref="/dev/preview/businesses"
      />
    );
  }
  const detail = fixtureDetail(segment);
  if (!detail) return <BusinessNotFound basePath={PREVIEW_BASE_PATH} />;
  return (
    <BusinessDetailPanel
      key={segment}
      detail={listState === "nokey" ? { ...detail, memberStatusNote: NO_KEY_REASON } : detail}
      actions={detailActions}
      invitesUnavailableReason={listState === "nokey" ? NO_KEY_REASON : null}
      genresHref="/dev/preview/businesses"
      initialTab={tab}
      justCreated={created}
      uploadLogo={previewUploadLogo}
    />
  );
}

/** The segment after /dev/preview/businesses/: "" (list), a venue id, "new" or "requests". */
function segmentOf(pathname: string | null): string {
  if (!pathname?.startsWith(`${PREVIEW_BASE_PATH}/`)) return "";
  return decodeURIComponent(pathname.slice(PREVIEW_BASE_PATH.length + 1).split("/")[0] ?? "");
}

/**
 * The list half of screen 06, rendered by the preview's layout. As in the app
 * (src/app/admin/businesses/(directory)/layout.tsx) it stays mounted while the admin moves between
 * venues, so the list keeps its search and focus can follow the switch. The access requests have
 * their own page (children only).
 */
export function BusinessesPreviewFrame({ children }: { children: ReactNode }) {
  const segment = segmentOf(usePathname());
  const listState = parseListState(useSearchParams()?.get("list"));
  if (segment === "requests") return children;

  const items = fixtureListItems({ statusesKnown: listState !== "nokey" });
  const list =
    listState === "error"
      ? null
      : {
          items: listState === "empty" ? [] : items,
          statusNote: listState === "nokey" ? NO_KEY_REASON : null,
        };

  return (
    <BusinessesDirectory
      key={listState}
      list={list}
      newRequestCount={listState === "empty" ? 0 : fixtureRequestCounts().new}
      basePath={PREVIEW_BASE_PATH}
      announcementsPath="/dev/preview/announcements"
      actions={directoryActions}
      accessUnavailableReason={listState === "nokey" ? NO_KEY_REASON : null}
    >
      {children}
    </BusinessesDirectory>
  );
}

export interface BusinessesPreviewDetailProps {
  /** "" (list), a venue id, "new" or "requests". */
  segment: string;
  listState: PreviewListState;
  tab: BusinessDetailTab;
  fromRequest: boolean;
  created: boolean;
  /** Access requests only: start with failed status changes (one on a card, one that left the list). */
  conflict: boolean;
}

/** The page half: the access-request list, or the directory's detail column. */
export function BusinessesPreviewDetail(props: BusinessesPreviewDetailProps) {
  if (props.segment === "requests") {
    return (
      <>
        <PageHeading
          breadcrumbs={[{ label: "Businesses", href: PREVIEW_BASE_PATH as Route }, { label: "Access requests" }]}
          title="Access requests"
          description="Venues asking for their own station. Nothing is approved automatically."
        />
        <AccessRequestsView
          key={props.conflict ? "conflict" : "default"}
          requests={FIXTURE_REQUESTS}
          counts={fixtureRequestCounts()}
          filter="all"
          truncated={false}
          basePath={PREVIEW_BASE_PATH}
          requestsPath={`${PREVIEW_BASE_PATH}/requests`}
          actions={requestActions}
          initialProblems={props.conflict ? FIXTURE_REQUEST_PROBLEMS : undefined}
        />
      </>
    );
  }
  return <DetailColumn {...props} />;
}
