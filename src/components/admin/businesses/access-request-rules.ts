/**
 * Access requests (submissions of the public /request-access form): status rules, labels and the
 * mapping that prefills "Add business". Pure and client-safe.
 *
 * Lifecycle: every request arrives as `new`. The owner marks it `contacted` while talking to the
 * venue, then `approved` (usually by creating the business from it) or `declined`. Closed requests
 * (approved/declined) can be reopened. Only one *open* request (new/contacted) may exist per email:
 * reopening a request while another open one exists for the same address is refused by the
 * database (23505 on `access_requests_open_email_key`).
 */
import type { BusinessType } from "@/lib/api/contracts";
import { isBusinessType, suggestStationName } from "./business-form";

export type AccessRequestStatus = "new" | "contacted" | "approved" | "declined";

export const ACCESS_REQUEST_STATUS_ORDER: readonly AccessRequestStatus[] = ["new", "contacted", "approved", "declined"];

export const ACCESS_REQUEST_STATUS_LABELS: Record<AccessRequestStatus, string> = {
  new: "New",
  contacted: "Contacted",
  approved: "Approved",
  declined: "Declined",
};

export const ACCESS_REQUEST_STATUS_TONES: Record<AccessRequestStatus, "info" | "warning" | "success" | "neutral"> = {
  new: "info",
  contacted: "warning",
  approved: "success",
  declined: "neutral",
};

/** Statuses covered by the one-open-request-per-email rule. */
export function isOpenAccessRequestStatus(status: AccessRequestStatus): boolean {
  return status === "new" || status === "contacted";
}

/** The status changes the owner can make from each status (never to the same status). */
export const ACCESS_REQUEST_TRANSITIONS: Record<AccessRequestStatus, readonly AccessRequestStatus[]> = {
  new: ["contacted", "approved", "declined"],
  contacted: ["new", "approved", "declined"],
  approved: ["new", "contacted", "declined"],
  declined: ["new", "contacted", "approved"],
};

export function canTransitionAccessRequest(from: AccessRequestStatus, to: AccessRequestStatus): boolean {
  return ACCESS_REQUEST_TRANSITIONS[from].includes(to);
}

/** Moving a closed request back to new/contacted: can collide with another open request (23505). */
export function isReopening(from: AccessRequestStatus, to: AccessRequestStatus): boolean {
  return !isOpenAccessRequestStatus(from) && isOpenAccessRequestStatus(to);
}

export interface AccessRequestAction {
  status: AccessRequestStatus;
  label: string;
  /** Primary = the usual next step. */
  emphasis: "primary" | "secondary" | "quiet";
}

/** The status buttons shown on a request card, most likely next step first. */
export function accessRequestActions(status: AccessRequestStatus): AccessRequestAction[] {
  switch (status) {
    case "new":
      return [
        { status: "contacted", label: "Mark contacted", emphasis: "secondary" },
        { status: "approved", label: "Mark approved", emphasis: "quiet" },
        { status: "declined", label: "Decline", emphasis: "quiet" },
      ];
    case "contacted":
      return [
        { status: "approved", label: "Mark approved", emphasis: "secondary" },
        { status: "declined", label: "Decline", emphasis: "quiet" },
        { status: "new", label: "Move back to new", emphasis: "quiet" },
      ];
    case "approved":
    case "declined":
      return [{ status: "new", label: "Reopen", emphasis: "secondary" }];
  }
}

/** Success message after a status change. */
export function describeAccessRequestChange(businessName: string, to: AccessRequestStatus): string {
  switch (to) {
    case "new":
      return `The request from ${businessName} is open again.`;
    case "contacted":
      return `The request from ${businessName} is marked as contacted.`;
    case "approved":
      return `The request from ${businessName} is marked as approved.`;
    case "declined":
      return `The request from ${businessName} is declined. Nothing is sent to them automatically.`;
  }
}

export const ACCESS_REQUEST_CONFLICT_MESSAGE =
  "There is already an open request from this email address. Handle that one instead, or close it before reopening this one.";

// ---------------------------------------------------------------------------
// "Create business from request"
// ---------------------------------------------------------------------------

export interface AccessRequestSource {
  id: string;
  businessName: string;
  businessType: string;
  contactName: string;
  email: string;
}

/** Values the "Add business" form starts with when it is opened from an access request. */
export interface AccessRequestPrefill {
  requestId: string;
  name: string;
  businessType: BusinessType;
  stationName: string;
  contactEmail: string;
  /** Shown in the banner ("Request from Ana Petrović"). */
  contactName: string;
}

/** Name, type and contact email from the request; station "<name> Radio". */
export function toAccessRequestPrefill(request: AccessRequestSource): AccessRequestPrefill {
  const name = request.businessName.replace(/\s+/g, " ").trim();
  return {
    requestId: request.id,
    name,
    businessType: isBusinessType(request.businessType) ? request.businessType : "other",
    stationName: suggestStationName(name),
    contactEmail: request.email.trim().toLowerCase(),
    contactName: request.contactName.trim(),
  };
}

/** /admin/businesses/new?fromRequest=<id> */
export function createFromRequestHref(basePath: string, requestId: string): string {
  return `${basePath}/new?fromRequest=${encodeURIComponent(requestId)}`;
}
