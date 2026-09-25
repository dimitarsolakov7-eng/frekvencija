"use server";

import type { AccessRequestNotesState } from "@/components/admin/businesses/action-types";
import {
  ACCESS_REQUEST_CONFLICT_MESSAGE,
  canTransitionAccessRequest,
  describeAccessRequestChange,
  type AccessRequestStatus,
} from "@/components/admin/businesses/access-request-rules";
import { lastFormString } from "@/components/admin/businesses/business-form";
import { describeDbError, type ActionState } from "@/lib/actions/state";
import { requireAdminAction } from "@/lib/auth/session";
import {
  buildAccessRequestNotesUpdate,
  buildAccessRequestStatusUpdate,
  isOpenRequestConflict,
} from "@/lib/data/admin/access-requests";
import { accessRequestNotesSchema, accessRequestStatusChangeSchema } from "@/lib/validation/access-requests";
import { formDataToObject, summarizeValidationError, toFieldErrors } from "@/lib/validation/forms";
import { done, failed, revalidateBusinesses } from "../_lib/action-helpers";

/*
 * Access-request actions (/admin/businesses/requests). RLS: only platform admins can update
 * access_requests, and these actions use the admin's own client. Every change is stamped with
 * handled_by / handled_at.
 */

/**
 * Changes a request's status, only while it still has the status the admin saw. Reopening a closed
 * request can collide with another open request from the same email (23505).
 */
export async function updateAccessRequestStatus(
  requestId: string,
  expectedStatus: AccessRequestStatus,
  status: AccessRequestStatus,
): Promise<ActionState> {
  const { ctx, supabase } = await requireAdminAction();
  const parsed = accessRequestStatusChangeSchema.safeParse({ requestId, expectedStatus, status });
  if (!parsed.success) return failed(summarizeValidationError(parsed.error));
  const input = parsed.data;
  if (!canTransitionAccessRequest(input.expectedStatus, input.status)) {
    return failed("That status change isn’t possible for this request.");
  }

  const { data, error } = await supabase
    .from("access_requests")
    .update(buildAccessRequestStatusUpdate(input.status, ctx.userId, new Date()))
    .eq("id", input.requestId)
    .eq("status", input.expectedStatus)
    .select("business_name")
    .maybeSingle();
  if (error) {
    if (isOpenRequestConflict(error)) return failed(ACCESS_REQUEST_CONFLICT_MESSAGE);
    console.error("[admin/access-requests] status update failed", error);
    return failed(describeDbError(error, "The request could not be updated. Please try again."));
  }
  if (!data) {
    const exists = await supabase.from("access_requests").select("status").eq("id", input.requestId).maybeSingle();
    revalidateBusinesses();
    if (!exists.error && !exists.data) return failed("This request no longer exists.");
    return failed("Someone changed this request in the meantime. The list has been refreshed; check it and try again.");
  }

  revalidateBusinesses();
  return done(describeAccessRequestChange(data.business_name, input.status));
}

/** Saves the owner's private notes on a request (≤ 2000 characters; blank clears them). */
export async function saveAccessRequestNotes(
  _previous: AccessRequestNotesState,
  formData: FormData,
): Promise<AccessRequestNotesState> {
  const { ctx, supabase } = await requireAdminAction();
  const values = { adminNotes: lastFormString(formData, "adminNotes") };
  const parsed = accessRequestNotesSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return failed(summarizeValidationError(parsed.error), values, toFieldErrors(parsed.error));

  const { data, error } = await supabase
    .from("access_requests")
    .update(buildAccessRequestNotesUpdate(parsed.data.adminNotes, ctx.userId, new Date()))
    .eq("id", parsed.data.requestId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[admin/access-requests] notes update failed", error);
    return failed(describeDbError(error, "The notes could not be saved. Please try again."), values);
  }
  if (!data) return failed("This request no longer exists.", values);

  revalidateBusinesses();
  return done(parsed.data.adminNotes ? "Notes saved." : "Notes cleared.");
}
