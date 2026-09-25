/** Tabs of the business detail panel; `?tab=` on /admin/businesses/[businessId] selects one. */
export type BusinessDetailTab = "profile" | "access" | "announcements";

export const BUSINESS_DETAIL_TABS: readonly BusinessDetailTab[] = ["profile", "access", "announcements"];

export function isBusinessDetailTab(value: unknown): value is BusinessDetailTab {
  return typeof value === "string" && (BUSINESS_DETAIL_TABS as readonly string[]).includes(value);
}
