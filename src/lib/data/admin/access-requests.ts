import "server-only";
import {
  ACCESS_REQUEST_STATUS_ORDER,
  type AccessRequestStatus,
} from "@/components/admin/businesses/access-request-rules";
import type { BusinessType } from "@/lib/api/contracts";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { AccessRequestFilter } from "@/lib/validation/access-requests";
import type { Tables, TablesUpdate } from "@/types/database";
import { toBusinessType } from "./businesses";

/**
 * Access requests submitted through the public /request-access form, for the owner's list at
 * /admin/businesses/requests. Everything here uses the admin's OWN client: RLS lets only platform
 * admins select/update access_requests (inserts happen server-side with the secret key).
 */

export class AccessRequestDataError extends Error {
  readonly code: string | null;

  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "AccessRequestDataError";
    const code = (cause as { code?: unknown } | null)?.code;
    this.code = typeof code === "string" ? code : null;
  }
}

export interface AccessRequestItem {
  id: string;
  businessName: string;
  businessType: BusinessType;
  contactName: string;
  email: string;
  phone: string | null;
  message: string | null;
  status: AccessRequestStatus;
  adminNotes: string | null;
  /** Who last changed the status or notes (email), when known. */
  handledByEmail: string | null;
  handledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type AccessRequestRow = Tables<"access_requests"> & { handler?: { email: string } | null };

export function toAccessRequestItem(row: AccessRequestRow): AccessRequestItem {
  return {
    id: row.id,
    businessName: row.business_name,
    businessType: toBusinessType(row.business_type),
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    status: row.status,
    adminNotes: row.admin_notes,
    handledByEmail: row.handler?.email ?? null,
    handledAt: row.handled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type AccessRequestCounts = Record<AccessRequestStatus, number> & { all: number };

export interface AccessRequestList {
  filter: AccessRequestFilter;
  items: AccessRequestItem[];
  /** Per-status totals (null when the counts could not be read; the list itself still loaded). */
  counts: AccessRequestCounts | null;
  /** True when more requests match than are shown (newest first). */
  truncated: boolean;
}

/** Newest requests shown per filter. */
export const ACCESS_REQUEST_LIST_LIMIT = 200;

const REQUEST_COLUMNS = "*, handler:profiles!access_requests_handled_by_fkey ( email )";

async function countByStatus(supabase: TypedSupabaseClient): Promise<AccessRequestCounts | null> {
  const results = await Promise.all(
    ACCESS_REQUEST_STATUS_ORDER.map((status) =>
      supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("status", status),
    ),
  );
  const counts = { new: 0, contacted: 0, approved: 0, declined: 0, all: 0 } as AccessRequestCounts;
  for (const [index, result] of results.entries()) {
    if (result.error) {
      console.warn("[admin/access-requests] counting requests failed", result.error.message);
      return null;
    }
    const status = ACCESS_REQUEST_STATUS_ORDER[index];
    counts[status] = result.count ?? 0;
    counts.all += counts[status];
  }
  return counts;
}

/** The request list, newest first, optionally filtered by status. Throws AccessRequestDataError. */
export async function loadAccessRequests(supabase: TypedSupabaseClient, filter: AccessRequestFilter): Promise<AccessRequestList> {
  let query = supabase
    .from("access_requests")
    .select(REQUEST_COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(ACCESS_REQUEST_LIST_LIMIT + 1);
  if (filter !== "all") query = query.eq("status", filter);

  const [listResult, counts] = await Promise.all([query, countByStatus(supabase)]);
  if (listResult.error) throw new AccessRequestDataError("Could not load the access requests.", listResult.error);
  const rows = (listResult.data ?? []) as AccessRequestRow[];
  return {
    filter,
    items: rows.slice(0, ACCESS_REQUEST_LIST_LIMIT).map(toAccessRequestItem),
    counts,
    truncated: rows.length > ACCESS_REQUEST_LIST_LIMIT,
  };
}

/** One request (for "Create business from request"), or null when it does not exist. */
export async function loadAccessRequest(supabase: TypedSupabaseClient, requestId: string): Promise<AccessRequestItem | null> {
  const { data, error } = await supabase.from("access_requests").select(REQUEST_COLUMNS).eq("id", requestId).maybeSingle();
  if (error) throw new AccessRequestDataError("Could not load the access request.", error);
  return data ? toAccessRequestItem(data as AccessRequestRow) : null;
}

/** Requests waiting for a first reply (status `new`), or null when the count can't be read. */
export async function countNewAccessRequests(supabase: TypedSupabaseClient): Promise<number | null> {
  const { count, error } = await supabase
    .from("access_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  if (error) {
    console.warn("[admin/access-requests] counting new requests failed", error.message);
    return null;
  }
  return count ?? 0;
}

/** Every status or notes change is stamped with the admin who made it. */
export function buildAccessRequestStatusUpdate(
  status: AccessRequestStatus,
  adminId: string,
  now: Date,
): TablesUpdate<"access_requests"> {
  return { status, handled_by: adminId, handled_at: now.toISOString() };
}

export function buildAccessRequestNotesUpdate(
  adminNotes: string | null,
  adminId: string,
  now: Date,
): TablesUpdate<"access_requests"> {
  return { admin_notes: adminNotes, handled_by: adminId, handled_at: now.toISOString() };
}

/** 23505 on the one-open-request-per-email index: another open request exists for the address. */
export function isOpenRequestConflict(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return error?.code === "23505";
}

export type MarkApprovedResult = "approved" | "already_closed" | "missing" | "failed";

/**
 * After a business was created from a request: mark it approved, but only while it is still open
 * (a request someone already closed is left as it is).
 */
export async function markAccessRequestApproved(
  supabase: TypedSupabaseClient,
  requestId: string,
  adminId: string,
  now: Date,
): Promise<MarkApprovedResult> {
  const { data, error } = await supabase
    .from("access_requests")
    .update(buildAccessRequestStatusUpdate("approved", adminId, now))
    .eq("id", requestId)
    .in("status", ["new", "contacted"])
    .select("id");
  if (error) {
    console.error("[admin/access-requests] marking a request approved failed", error);
    return "failed";
  }
  if (data && data.length > 0) return "approved";
  const existing = await supabase.from("access_requests").select("id").eq("id", requestId).maybeSingle();
  if (existing.error) return "failed";
  return existing.data ? "already_closed" : "missing";
}
