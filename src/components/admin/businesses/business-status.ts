/**
 * The venue status shown in the business list and detail (screen 06): Active, Invited or Inactive.
 * Pure and client-safe.
 *
 * Rules (docs/REDESIGN.md §6 "06"):
 * - **Inactive**: `businesses.is_active` is false. Nothing plays, whatever the accounts look like.
 * - **Active**: the venue is active and at least one of its staff accounts has accepted its
 *   invitation (email confirmed, not blocked in Supabase Auth), so someone can actually sign in.
 * - **Invited**: the venue is active but nobody can sign in yet: every staff account is still an
 *   open invitation, or it has no staff account at all. The second case is deliberately "Invited" as
 *   well (the venue is set up and waiting for its login); the detail text says "No staff account yet"
 *   so the admin knows to invite the contact.
 *
 * When the sign-in statuses could not be read (no secret key, or Supabase Auth unreachable) an active
 * venue with staff is shown as Active, flagged `verified: false`, rather than guessing "Invited".
 * "Active" never means "currently listening".
 */

export type BusinessStatus = "active" | "invited" | "inactive";
export type BusinessStatusTone = "success" | "warning" | "neutral";

export interface BusinessStatusInput {
  isActive: boolean;
  /** Staff accounts (memberships) of the venue. */
  memberCount: number;
  /** Staff accounts that accepted their invitation, or null when that could not be determined. */
  acceptedMemberCount: number | null;
}

export interface BusinessStatusView {
  status: BusinessStatus;
  label: string;
  tone: BusinessStatusTone;
  /** One honest sentence explaining the status. */
  detail: string;
  /** False when the sign-in statuses were unavailable and the status is a best guess. */
  verified: boolean;
}

export const BUSINESS_STATUS_LABELS: Record<BusinessStatus, string> = {
  active: "Active",
  invited: "Invited",
  inactive: "Inactive",
};

export const BUSINESS_STATUS_TONES: Record<BusinessStatus, BusinessStatusTone> = {
  active: "success",
  invited: "warning",
  inactive: "neutral",
};

function accounts(count: number): string {
  return count === 1 ? "1 staff account" : `${count} staff accounts`;
}

export function deriveBusinessStatus({ isActive, memberCount, acceptedMemberCount }: BusinessStatusInput): BusinessStatusView {
  const view = (status: BusinessStatus, detail: string, verified = true): BusinessStatusView => ({
    status,
    label: BUSINESS_STATUS_LABELS[status],
    tone: BUSINESS_STATUS_TONES[status],
    detail,
    verified,
  });

  if (!isActive) {
    return view("inactive", "Deactivated: staff can sign in but the radio doesn’t play.");
  }
  if (memberCount <= 0) {
    return view("invited", "No staff account yet: invite the venue’s contact from the Access tab.");
  }
  if (acceptedMemberCount === null) {
    return view("active", `${accounts(memberCount)}; sign-in statuses are unavailable right now.`, false);
  }
  if (acceptedMemberCount > 0) {
    return view(
      "active",
      acceptedMemberCount === memberCount
        ? memberCount === 1
          ? "The staff account can sign in."
          : `All ${memberCount} staff accounts can sign in.`
        : `${acceptedMemberCount} of ${memberCount} staff accounts can sign in.`,
    );
  }
  return view(
    "invited",
    memberCount === 1 ? "The invitation hasn’t been accepted yet." : `None of the ${memberCount} invitations has been accepted yet.`,
  );
}

/** Status filter of the business list ("All statuses" first). */
export type BusinessStatusFilter = BusinessStatus | "all";

export const BUSINESS_STATUS_FILTERS: readonly { value: BusinessStatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "inactive", label: "Inactive" },
];

export function isBusinessStatusFilter(value: unknown): value is BusinessStatusFilter {
  return BUSINESS_STATUS_FILTERS.some((option) => option.value === value);
}
