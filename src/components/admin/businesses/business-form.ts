/**
 * Pure, client-safe helpers shared by the business forms (browser) and their Server Actions
 * (server). No React, no server-only imports.
 */
import type { BusinessType } from "@/lib/api/contracts";

/** Text fields of the business profile form, in display order. */
export const BUSINESS_TEXT_FIELDS = [
  "name",
  "stationName",
  "namePronunciation",
  "stationNamePronunciation",
  "contactEmail",
  "announcementLanguage",
] as const;

export type BusinessTextField = (typeof BUSINESS_TEXT_FIELDS)[number];

/** Fields that make up the venue's branding: changing any of them pauses its announcements. */
export const BRANDING_FIELDS = ["name", "stationName", "namePronunciation", "stationNamePronunciation"] as const;
export type BrandingField = (typeof BRANDING_FIELDS)[number];

/**
 * Raw submitted values, echoed back after a failed submit so the form can show what was typed.
 * `isActive` is "true"/"false"; `businessType` is an enum value (or whatever was submitted).
 */
export type BusinessFormValues = Record<BusinessTextField, string> & { businessType: string; isActive: string };

export const EMPTY_BUSINESS_FORM_VALUES: BusinessFormValues = {
  name: "",
  stationName: "",
  namePronunciation: "",
  stationNamePronunciation: "",
  contactEmail: "",
  announcementLanguage: "en",
  businessType: "other",
  isActive: "false",
};

/** Maximum lengths enforced by the database (and the zod schemas); used for `maxLength`. */
export const BUSINESS_FIELD_MAX_LENGTH: Record<BusinessTextField, number> = {
  name: 120,
  stationName: 120,
  namePronunciation: 200,
  stationNamePronunciation: 200,
  contactEmail: 254,
  announcementLanguage: 16,
};

const STATION_SUFFIX = "Radio";

/**
 * Suggested station name for a venue: "EmeraldBar" → "EmeraldBar Radio". A name that already ends
 * in "Radio" is kept as is. Returns "" when there is no name or the suggestion would be too long.
 */
export function suggestStationName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const suggestion = new RegExp(`(^|\\s)${STATION_SUFFIX}$`, "i").test(trimmed) ? trimmed : `${trimmed} ${STATION_SUFFIX}`;
  return suggestion.length <= BUSINESS_FIELD_MAX_LENGTH.stationName ? suggestion : "";
}

/** The last submitted string for `key` ("" when absent), so "hidden false + checkbox true" reads as "true". */
export function lastFormString(formData: FormData, key: string): string {
  const all = formData.getAll(key);
  const last = all[all.length - 1];
  return typeof last === "string" ? last : "";
}

/** Reads the submitted form values as strings (missing fields become ""), for echoing back. */
export function readBusinessFormValues(formData: FormData): BusinessFormValues {
  const values: BusinessFormValues = { ...EMPTY_BUSINESS_FORM_VALUES, announcementLanguage: "", businessType: "", isActive: "" };
  for (const field of BUSINESS_TEXT_FIELDS) values[field] = lastFormString(formData, field);
  values.businessType = lastFormString(formData, "businessType");
  values.isActive = lastFormString(formData, "isActive");
  return values;
}

/**
 * Create form: a blank station name means "use the suggestion", so the admin can accept
 * "<name> Radio" without typing it. Returns the value to validate.
 */
export function stationNameOrSuggestion(stationName: string, name: string): string {
  return stationName.trim() === "" ? suggestStationName(name) : stationName;
}

/** Same normalisation the zod schemas apply before saving: trimmed, blank = null. */
function normalizeBranding(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export type BrandingValues = Record<BrandingField, string | null>;

/**
 * Whether saving these values would change the venue's branding (and therefore mark every
 * announcement for review). Mirrors the database trigger: compares trimmed values, blank = null.
 */
export function brandingDiffers(current: BrandingValues, next: Partial<Record<BrandingField, string | null>>): boolean {
  return BRANDING_FIELDS.some((field) => {
    const value = next[field];
    if (value === undefined) return false;
    return normalizeBranding(value) !== normalizeBranding(current[field]);
  });
}

// ---------------------------------------------------------------------------
// Business type
// ---------------------------------------------------------------------------

/** Business types in display order, with the labels shown in the admin (same wording as the public form). */
export const BUSINESS_TYPE_OPTIONS: readonly { value: BusinessType; label: string }[] = [
  { value: "cafe", label: "Café" },
  { value: "restaurant", label: "Restaurant" },
  { value: "hotel", label: "Hotel" },
  { value: "bar", label: "Bar" },
  { value: "other", label: "Other" },
];

export function isBusinessType(value: unknown): value is BusinessType {
  return BUSINESS_TYPE_OPTIONS.some((option) => option.value === value);
}

/** "Bar", "Hotel", "Café"… ("Other" for anything unknown). */
export function businessTypeLabel(type: string | null | undefined): string {
  return BUSINESS_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? "Other";
}

// ---------------------------------------------------------------------------
// Announcement language
// ---------------------------------------------------------------------------

export interface LanguageOption {
  code: string;
  label: string;
}

/**
 * Common announcement languages for the select. Fixed English labels (not Intl.DisplayNames) so the
 * server and browser render identical text. Anything else can be typed as a code.
 */
export const COMMON_ANNOUNCEMENT_LANGUAGES: readonly LanguageOption[] = [
  { code: "en", label: "English" },
  { code: "bg", label: "Bulgarian" },
  { code: "sr", label: "Serbian" },
  { code: "hr", label: "Croatian" },
  { code: "el", label: "Greek" },
  { code: "ro", label: "Romanian" },
  { code: "tr", label: "Turkish" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "it", label: "Italian" },
  { code: "es", label: "Spanish" },
  { code: "bs", label: "Bosnian" },
  { code: "mk", label: "Macedonian" },
  { code: "sl", label: "Slovenian" },
  { code: "sq", label: "Albanian" },
  { code: "hu", label: "Hungarian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "cs", label: "Czech" },
  { code: "uk", label: "Ukrainian" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
];

/** Select value that reveals the free-text language code input. */
export const OTHER_LANGUAGE_VALUE = "__other";

export function isCommonLanguage(code: string): boolean {
  return COMMON_ANNOUNCEMENT_LANGUAGES.some((option) => option.code === code);
}

/** "Bulgarian (bg)" for a common code, otherwise the code itself. */
export function languageLabel(code: string): string {
  const option = COMMON_ANNOUNCEMENT_LANGUAGES.find((candidate) => candidate.code === code);
  return option ? `${option.label} (${option.code})` : code;
}
