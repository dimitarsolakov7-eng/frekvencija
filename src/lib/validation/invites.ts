import { z } from "zod";
import { emailSchema, idSchema } from "./fields";

export const INVITE_DELIVERY_METHODS = ["email", "link"] as const;
export type InviteDeliveryMethod = (typeof INVITE_DELIVERY_METHODS)[number];

/** How an invitation or password reset reaches the person: Supabase's email, or a one-time link. */
export const inviteDeliverySchema = z.enum(INVITE_DELIVERY_METHODS, { error: 'Choose "email" or "link".' });

/**
 * Invite a venue user. "email" sends Supabase's invite email; "link" creates a one-time invite link
 * that the admin delivers privately (docs/ARCHITECTURE.md §13, Supabase notes).
 */
export const inviteUserSchema = z.object({
  email: emailSchema,
  businessId: idSchema,
  delivery: inviteDeliverySchema.default("email"),
});
export type InviteUserInput = z.output<typeof inviteUserSchema>;
