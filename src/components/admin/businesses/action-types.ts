/**
 * Result states and the Server Action signatures the business, access-request and settings
 * components receive as props. The pages pass the real Server Actions; the development previews
 * pass no-op functions, so the components never import actions themselves.
 */
import type { ActionState } from "@/lib/actions/state";
import type { AccessLink } from "@/lib/data/admin/businesses";
import type { AccessRequestStatus } from "./access-request-rules";
import type { BusinessFormValues } from "./business-form";

export type { AccessLink };

/** Profile form values echoed back after a failed save (genreIds comma-joined). */
export type BusinessProfileValues = BusinessFormValues & { genreIds: string };
export type BusinessProfileState = ActionState<BusinessProfileValues> & {
  /** True when the venue row was saved even though the result is not ok (genre access failed). */
  saved?: boolean;
};

export type MemberAccessState = ActionState<{ email: string }> & {
  /** A one-time invite/reset link to show once, when one was created. */
  link: AccessLink | null;
};

export type NewBusinessValues = BusinessFormValues & {
  genreIds: string;
  inviteContact: string;
  inviteDelivery: string;
  fromRequest: string;
};

export type NewBusinessState = ActionState<NewBusinessValues> & {
  /** Set once the business exists (even when a later step, like the invitation, failed). */
  created: { id: string; name: string } | null;
  /** A one-time invite link, when "Create a one-time link" was chosen. */
  link: AccessLink | null;
  /** Steps after creation that did not complete, each an honest sentence. */
  warnings: string[];
};

export type AccessRequestNotesState = ActionState<{ adminNotes: string }>;

/** Row-menu actions of the business list (also used by the detail panel's menu). */
export interface BusinessDirectoryActions {
  setBusinessActive: (businessId: string, isActive: boolean) => Promise<ActionState>;
  sendBusinessPasswordReset: (businessId: string) => Promise<ActionState>;
  deleteBusiness: (businessId: string, confirmation: string) => Promise<ActionState>;
}

/** Actions of the business detail panel (Profile and Access tabs). */
export interface BusinessDetailActions {
  saveBusinessProfile: (previous: BusinessProfileState, formData: FormData) => Promise<BusinessProfileState>;
  removeBusinessLogo: (businessId: string) => Promise<ActionState>;
  inviteMember: (previous: MemberAccessState, formData: FormData) => Promise<MemberAccessState>;
  sendMemberAccess: (businessId: string, userId: string, delivery: "email" | "link") => Promise<MemberAccessState>;
  removeMember: (businessId: string, userId: string) => Promise<ActionState>;
}

export type CreateBusinessAction = (previous: NewBusinessState, formData: FormData) => Promise<NewBusinessState>;

export interface AccessRequestActions {
  updateAccessRequestStatus: (requestId: string, expectedStatus: AccessRequestStatus, status: AccessRequestStatus) => Promise<ActionState>;
  saveAccessRequestNotes: (previous: AccessRequestNotesState, formData: FormData) => Promise<AccessRequestNotesState>;
}

/** Initial state for useActionState. */
export const IDLE_STATE = { ok: false, message: null, fieldErrors: {} } as const;
