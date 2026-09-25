import type { BusinessType } from "@/lib/api/contracts";

/** Business types offered on the request-access form (values match the `business_type` enum). */
export const BUSINESS_TYPE_OPTIONS: readonly { value: BusinessType; label: string }[] = [
  { value: "cafe", label: "Café" },
  { value: "restaurant", label: "Restaurant" },
  { value: "hotel", label: "Hotel" },
  { value: "bar", label: "Bar" },
  { value: "other", label: "Other" },
];

export const BUSINESS_TYPE_VALUES = ["cafe", "restaurant", "hotel", "bar", "other"] as const satisfies readonly BusinessType[];

/** Length limits, identical to the `access_requests` column checks. */
export const ACCESS_REQUEST_LIMITS = {
  businessName: 120,
  contactName: 120,
  email: 254,
  phone: 40,
  message: 1000,
} as const;

/**
 * Hidden anti-spam field: people never see or fill it, simple bots do. A filled value is answered like a
 * normal submission but nothing is stored. The name avoids anything browsers autofill.
 */
export const HONEYPOT_FIELD = "frk_hp";

export type AccessRequestField = keyof typeof ACCESS_REQUEST_LIMITS | "businessType";

/** Form values echoed back after a failed submission (React resets uncontrolled fields after an action). */
export type RequestAccessValues = {
  businessName: string;
  businessType: string;
  contactName: string;
  email: string;
  phone: string;
  message: string;
};

export const EMPTY_REQUEST_ACCESS_VALUES: RequestAccessValues = Object.freeze({
  businessName: "",
  businessType: "",
  contactName: "",
  email: "",
  phone: "",
  message: "",
});
