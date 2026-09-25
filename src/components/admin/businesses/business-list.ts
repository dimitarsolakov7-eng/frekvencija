/**
 * Search and filtering for the business list (client-side, instant). Pure and client-safe; the
 * server loader re-exports the search helpers for its own use.
 */
import type { BusinessStatus, BusinessStatusFilter } from "./business-status";

export const MAX_SEARCH_LENGTH = 100;

/** A search string as typed, cleaned: collapsed whitespace, trimmed, at most 100 characters. */
export function normalizeSearchQuery(raw: string | string[] | undefined | null): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_LENGTH);
}

/** Lower-case and strip diacritics so "cafe" finds "Café" and "zurich" finds "Zürich". */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface SearchableBusiness {
  name: string;
  stationName: string;
  contactEmail: string | null;
}

/** Every whitespace-separated term must appear in the name, station name or contact email. */
export function matchesBusinessSearch(business: SearchableBusiness, query: string): boolean {
  const terms = foldForSearch(normalizeSearchQuery(query)).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = foldForSearch(`${business.name}\n${business.stationName}\n${business.contactEmail ?? ""}`);
  return terms.every((term) => haystack.includes(term));
}

export interface FilterableBusiness extends SearchableBusiness {
  status: BusinessStatus;
}

export function filterBusinesses<T extends FilterableBusiness>(
  items: readonly T[],
  filters: { query: string; status: BusinessStatusFilter },
): T[] {
  return items.filter(
    (item) => (filters.status === "all" || item.status === filters.status) && matchesBusinessSearch(item, filters.query),
  );
}

export type BusinessStatusCounts = Record<BusinessStatus, number> & { total: number };

export function countBusinessStatuses(items: readonly { status: BusinessStatus }[]): BusinessStatusCounts {
  const counts: BusinessStatusCounts = { total: items.length, active: 0, invited: 0, inactive: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}
