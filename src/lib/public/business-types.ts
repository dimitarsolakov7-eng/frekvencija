import type { BusinessType } from "@/lib/api/contracts";

/** Every value of the `business_type` enum, in display order. */
export const BUSINESS_TYPE_VALUES = ["cafe", "restaurant", "hotel", "bar", "other"] as const satisfies readonly BusinessType[];

/** English labels of the venue categories (the app's own language; the public website translates them itself). */
export const BUSINESS_TYPE_OPTIONS: readonly { value: BusinessType; label: string }[] = [
  { value: "cafe", label: "Café" },
  { value: "restaurant", label: "Restaurant" },
  { value: "hotel", label: "Hotel" },
  { value: "bar", label: "Bar" },
  { value: "other", label: "Other" },
];
