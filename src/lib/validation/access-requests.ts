import { z } from "zod";
import { idSchema } from "./fields";
import { normalizeLongText } from "./settings";

/** Values of the `access_request_status` enum. */
export const ACCESS_REQUEST_STATUSES = ["new", "contacted", "approved", "declined"] as const;
export type AccessRequestStatusValue = (typeof ACCESS_REQUEST_STATUSES)[number];

export const accessRequestStatusSchema = z.enum(ACCESS_REQUEST_STATUSES, { error: "Choose a valid request status." });

/** Same limit as the `access_requests.admin_notes` column check. */
export const MAX_ADMIN_NOTES_LENGTH = 2000;

/**
 * Status change from the access-request list. `expectedStatus` is the status the admin saw: the
 * update only applies while the request still has it, so two admins can't overwrite each other.
 */
export const accessRequestStatusChangeSchema = z
  .object({
    requestId: idSchema,
    status: accessRequestStatusSchema,
    expectedStatus: accessRequestStatusSchema,
  })
  .refine((input) => input.status !== input.expectedStatus, {
    path: ["status"],
    message: "The request already has this status.",
  });
export type AccessRequestStatusChangeInput = z.output<typeof accessRequestStatusChangeSchema>;

export const accessRequestNotesSchema = z.object({
  requestId: idSchema,
  adminNotes: z.preprocess(
    normalizeLongText,
    z
      .string({ error: "Notes must be text." })
      .max(MAX_ADMIN_NOTES_LENGTH, { error: `Notes must be at most ${MAX_ADMIN_NOTES_LENGTH.toLocaleString("en-US")} characters.` })
      .nullable(),
  ),
});
export type AccessRequestNotesInput = z.output<typeof accessRequestNotesSchema>;

/** `?status=` on /admin/businesses/requests: a status, or "all" (the default). */
export type AccessRequestFilter = AccessRequestStatusValue | "all";

export function parseAccessRequestFilter(raw: string | string[] | undefined | null): AccessRequestFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = accessRequestStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "all";
}
