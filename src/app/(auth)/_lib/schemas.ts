/** zod schemas for the auth Server Actions (kept out of the 'use server' files). */
import { z } from "zod";
import { emailSchema } from "@/lib/validation/fields";

/** Passwords are never trimmed: leading/trailing spaces are part of the secret. */
const passwordInput = z
  .string({ error: "Enter your password." })
  .min(1, { error: "Enter your password." })
  .max(1024, { error: "That password is too long." });

export const signInSchema = z.object({
  email: emailSchema,
  password: passwordInput,
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

/** The trimmed email as typed, capped, for echoing back into the form after an error. */
export function echoEmail(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().slice(0, 254) : "";
}
