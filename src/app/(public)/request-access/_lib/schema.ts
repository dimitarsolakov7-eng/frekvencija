/** zod schema for the public request-access form (kept out of the 'use server' file). */
import { z } from "zod";
import {
  ACCESS_REQUEST_LIMITS,
  BUSINESS_TYPE_VALUES,
  EMPTY_REQUEST_ACCESS_VALUES,
  type RequestAccessValues,
} from "@/components/public/request-access-options";
import { emailSchema, nullableText, requiredText } from "@/lib/validation/fields";

/** Digits, spaces and + ( ) . / - only, with at least five digits. */
const PHONE_CHARACTERS = /^[0-9+().\s/-]+$/;

const phoneSchema = nullableText("Phone", ACCESS_REQUEST_LIMITS.phone).refine(
  (value) => value === null || (PHONE_CHARACTERS.test(value) && (value.match(/\d/g)?.length ?? 0) >= 5),
  { error: "Enter a phone number using digits, spaces and + ( ) - only." },
);

export const accessRequestSchema = z.object({
  businessName: requiredText("Business name", ACCESS_REQUEST_LIMITS.businessName),
  businessType: z.enum(BUSINESS_TYPE_VALUES, { error: "Choose the type of business." }),
  contactName: requiredText("Contact name", ACCESS_REQUEST_LIMITS.contactName),
  email: emailSchema,
  phone: phoneSchema,
  message: nullableText("Message", ACCESS_REQUEST_LIMITS.message),
});

export type AccessRequestFormInput = z.output<typeof accessRequestSchema>;

/** The submitted values as typed (trimmed and capped) for echoing back into the form after an error. */
export function echoRequestAccessValues(formData: FormData): RequestAccessValues {
  const read = (key: keyof RequestAccessValues, max: number): string => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  };
  return {
    ...EMPTY_REQUEST_ACCESS_VALUES,
    businessName: read("businessName", ACCESS_REQUEST_LIMITS.businessName * 2),
    businessType: read("businessType", 20),
    contactName: read("contactName", ACCESS_REQUEST_LIMITS.contactName * 2),
    email: read("email", ACCESS_REQUEST_LIMITS.email),
    phone: read("phone", ACCESS_REQUEST_LIMITS.phone * 2),
    message: read("message", ACCESS_REQUEST_LIMITS.message * 2),
  };
}
