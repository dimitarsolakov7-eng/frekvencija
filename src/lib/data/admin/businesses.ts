import "server-only";
import { isAuthError, isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
import { summarizeAnnouncements as summarizeStudioAnnouncements } from "@/components/admin/announcements/rules";
import { isBusinessType } from "@/components/admin/businesses/business-form";
import { deriveBusinessStatus, type BusinessStatus, type BusinessStatusView } from "@/components/admin/businesses/business-status";
import type { AnnouncementPlacement, AnnouncementStatus, BusinessType } from "@/lib/api/contracts";
import { signLogoObject, mediaTtlFor } from "@/lib/media/signing";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { formatDateTime } from "@/lib/utils/format";
import type { BusinessCreateInput, BusinessProfileInput, BusinessUpdateInput } from "@/lib/validation/businesses";
import type { InviteDeliveryMethod } from "@/lib/validation/invites";
import type { AppRole, Tables, TablesInsert, TablesUpdate } from "@/types/database";

/**
 * Admin business (venue) management: read models, loaders and the member-access flows
 * (invites, one-time links, password resets) behind /admin/businesses.
 *
 * Data access uses the admin's OWN Supabase client (RLS admin policies are the source of truth).
 * The secret-key client is only used, through the ports below, for Supabase Auth admin calls
 * (invitations, resets, sign-in statuses) and for Storage cleanup. The pure helpers are unit-tested
 * in tests/admin/businesses. Form schemas live in src/lib/validation/businesses.ts.
 */

export { matchesBusinessSearch, MAX_SEARCH_LENGTH, normalizeSearchQuery } from "@/components/admin/businesses/business-list";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A database read/write failed. `code` is the Postgres/PostgREST code when there was one. */
export class BusinessDataError extends Error {
  readonly code: string | null;

  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "BusinessDataError";
    const code = (cause as { code?: unknown } | null)?.code;
    this.code = typeof code === "string" ? code : null;
  }
}

/** A Storage listing or removal failed while cleaning up a venue's files. */
export class StorageCleanupError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "StorageCleanupError";
  }
}

export type InviteDelivery = InviteDeliveryMethod;

// ---------------------------------------------------------------------------
// Announcements summary
// ---------------------------------------------------------------------------

export interface AnnouncementSummaryRow {
  status: AnnouncementStatus;
  needsReview: boolean;
  hasAudio: boolean;
  brandingVersion: number;
  /** When the current audio was approved; kept while it is switched off (Deactivate). */
  approvedAt: string | null;
  /** The generating lock's timestamp (a lock older than 3 minutes counts as failed). */
  generationStartedAt?: string | null;
  /** Where the clip plays; omitted rows count as station (rotation) announcements. */
  placement?: AnnouncementPlacement;
}

/**
 * The business page's Announcements tab. The counts come from the announcements studio's own
 * summary (summarizeAnnouncements in components/admin/announcements/rules.ts), so both screens
 * classify every clip the same way.
 */
export interface BusinessAnnouncementSummary {
  total: number;
  /** Approved for the current branding: plays whenever the venue is active. */
  onAir: number;
  /** On-air clips that play as the welcome message (placement welcome or both). */
  onAirWelcome: number;
  /** On-air clips that play between songs (placement rotation or both). */
  onAirRotation: number;
  /** Flagged after a branding change, whatever the status: approved ones are off air until approved again. */
  needsReview: number;
  /** Audio ready and never approved (status `ready`, no approval), not flagged. */
  awaitingApproval: number;
  /** Approved, then switched off with Deactivate (status `ready` with an approval), not flagged. */
  switchedOff: number;
  /** Generation failed, or its lock stalled. */
  failed: number;
  /** No audio yet (unflagged drafts) or audio being generated. */
  inProgress: number;
  byStatus: Record<AnnouncementStatus, number>;
}

export function summarizeAnnouncements(
  rows: readonly AnnouncementSummaryRow[],
  businessBrandingVersion: number,
  now: Date | number = Date.now(),
): BusinessAnnouncementSummary {
  const byStatus: Record<AnnouncementStatus, number> = { draft: 0, generating: 0, ready: 0, failed: 0, active: 0 };
  for (const row of rows) byStatus[row.status] += 1;
  const summary = summarizeStudioAnnouncements(
    rows.map((row) => ({ ...row, placement: row.placement ?? "rotation", generationStartedAt: row.generationStartedAt ?? null })),
    { brandingVersion: businessBrandingVersion },
    now,
  );
  return {
    total: summary.total,
    onAir: summary.onAir,
    onAirWelcome: summary.onAirWelcome,
    onAirRotation: summary.onAirRotation,
    needsReview: summary.needsReview,
    awaitingApproval: summary.awaitingApproval,
    switchedOff: summary.switchedOff,
    failed: summary.failed,
    inProgress: summary.drafts + summary.generating,
    byStatus,
  };
}

function toSummaryRow(
  row: Pick<Tables<"announcements">, "status" | "needs_review" | "audio_path" | "branding_version" | "approved_at"> &
    Partial<Pick<Tables<"announcements">, "placement" | "generation_started_at">>,
): AnnouncementSummaryRow {
  return {
    status: row.status,
    needsReview: row.needs_review,
    hasAudio: row.audio_path !== null,
    brandingVersion: row.branding_version,
    approvedAt: row.approved_at,
    generationStartedAt: row.generation_started_at ?? null,
    placement: row.placement,
  };
}

// ---------------------------------------------------------------------------
// Genre access
// ---------------------------------------------------------------------------

export interface GenreAccessGenre {
  id: string;
  name: string;
  isEnabled: boolean;
  availableToAll: boolean;
}

export interface GenreAccessOption extends GenreAccessGenre {
  /** An exclusive-access row exists for this venue. */
  assigned: boolean;
  /** The venue can choose this genre (while the venue itself is active). */
  accessible: boolean;
  /** The admin can change the assignment here: enabled genres that are not available to all. */
  editable: boolean;
  /** Playable tracks in the genre, or null when the counts could not be loaded. */
  playableTrackCount: number | null;
}

export function isGenreEditable(genre: Pick<GenreAccessGenre, "isEnabled" | "availableToAll">): boolean {
  return genre.isEnabled && !genre.availableToAll;
}

export function isGenreAccessible(genre: Pick<GenreAccessGenre, "isEnabled" | "availableToAll">, assigned: boolean): boolean {
  return genre.isEnabled && (genre.availableToAll || assigned);
}

export function buildGenreAccessOptions(
  genres: readonly GenreAccessGenre[],
  assignedIds: Iterable<string>,
  playableCounts?: ReadonlyMap<string, number> | null,
): GenreAccessOption[] {
  const assigned = new Set(assignedIds);
  return genres.map((genre) => {
    const isAssigned = assigned.has(genre.id);
    return {
      ...genre,
      assigned: isAssigned,
      accessible: isGenreAccessible(genre, isAssigned),
      editable: isGenreEditable(genre),
      playableTrackCount: playableCounts ? (playableCounts.get(genre.id) ?? 0) : null,
    };
  });
}

/** Genres the venue can choose: enabled and (available to all or assigned). */
export function countAccessibleGenres(genres: readonly GenreAccessGenre[], assignedIds: Iterable<string>): number {
  const assigned = new Set(assignedIds);
  return genres.filter((genre) => isGenreAccessible(genre, assigned.has(genre.id))).length;
}

export interface GenreAccessUpdate {
  /** The complete set to store (argument for set_business_genre_access), in genre display order. */
  next: string[];
  added: string[];
  removed: string[];
  /** Submitted ids that are unknown, disabled or available to all: not editable here, ignored. */
  ignored: string[];
  changed: boolean;
}

/**
 * Turns the submitted checkbox set into the full access set. Only enabled exclusive genres are
 * editable; existing rows for other genres (disabled ones, or ones currently available to all) are
 * kept so they come back unchanged if the genre is re-enabled or made exclusive again.
 *
 * `shownIds` (optional) are the genres the form offered as checkboxes. A genre that became editable
 * after the form was loaded was not offered, so its current assignment is kept instead of being
 * cleared by its missing checkbox.
 */
export function computeGenreAccessUpdate(
  genres: readonly GenreAccessGenre[],
  currentIds: Iterable<string>,
  submittedIds: Iterable<string>,
  shownIds?: Iterable<string> | null,
): GenreAccessUpdate {
  const current = new Set(currentIds);
  const submitted = new Set(submittedIds);
  const shown = shownIds ? new Set(shownIds) : null;
  const byId = new Map(genres.map((genre) => [genre.id, genre]));

  const nextSet = new Set<string>();
  for (const genre of genres) {
    const decidedByForm = isGenreEditable(genre) && (shown === null || shown.has(genre.id));
    const keep = decidedByForm ? submitted.has(genre.id) : current.has(genre.id);
    if (keep) nextSet.add(genre.id);
  }

  const next = genres.filter((genre) => nextSet.has(genre.id)).map((genre) => genre.id);
  const added = next.filter((id) => !current.has(id));
  const removed = genres.filter((genre) => current.has(genre.id) && !nextSet.has(genre.id)).map((genre) => genre.id);
  const ignored = [...submitted].filter((id) => {
    const genre = byId.get(id);
    return !genre || !isGenreEditable(genre) || (shown !== null && !shown.has(id));
  });
  // Rows for genres that no longer exist cannot be kept (the FK cascade removes them anyway).
  const staleCurrent = [...current].filter((id) => !byId.has(id));
  return { next, added, removed, ignored, changed: added.length > 0 || removed.length > 0 || staleCurrent.length > 0 };
}

// ---------------------------------------------------------------------------
// Business rows
// ---------------------------------------------------------------------------

export interface AdminBusinessRecord {
  id: string;
  name: string;
  stationName: string;
  namePronunciation: string | null;
  stationNamePronunciation: string | null;
  contactEmail: string | null;
  announcementLanguage: string;
  businessType: BusinessType;
  isActive: boolean;
  logoPath: string | null;
  announcementEveryNTracks: number;
  /** 0.10–1.00 gain applied to announcements. */
  announcementVolume: number;
  brandingVersion: number;
  createdAt: string;
  updatedAt: string;
}

export function toAdminBusinessRecord(row: Tables<"businesses">): AdminBusinessRecord {
  return {
    id: row.id,
    name: row.name,
    stationName: row.station_name,
    namePronunciation: row.name_pronunciation,
    stationNamePronunciation: row.station_name_pronunciation,
    contactEmail: row.contact_email,
    announcementLanguage: row.announcement_language,
    businessType: toBusinessType(row.business_type),
    isActive: row.is_active,
    logoPath: row.logo_path,
    announcementEveryNTracks: row.announcement_every_n_tracks,
    announcementVolume: Number(row.announcement_volume),
    brandingVersion: row.branding_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The enum value, or "other" for anything unexpected. */
export function toBusinessType(value: unknown): BusinessType {
  return isBusinessType(value) ? value : "other";
}

/**
 * Insert payload for the "Add business" form. The announcement frequency is the platform default
 * (platform_settings.default_announcement_every_n_tracks), which the caller puts into `input`;
 * the volume keeps its database default and is managed on the Announcements page.
 */
export function toBusinessInsert(input: BusinessCreateInput): TablesInsert<"businesses"> {
  return {
    name: input.name,
    station_name: input.stationName,
    name_pronunciation: input.namePronunciation,
    station_name_pronunciation: input.stationNamePronunciation,
    contact_email: input.contactEmail,
    announcement_language: input.announcementLanguage,
    business_type: input.businessType ?? "other",
    is_active: input.isActive,
    announcement_every_n_tracks: input.announcementEveryNTracks,
  };
}

/** Update payload for the details fields (and the business type), only those present. */
export function toBusinessDetailsUpdate(input: BusinessUpdateInput): TablesUpdate<"businesses"> {
  const update: TablesUpdate<"businesses"> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.stationName !== undefined) update.station_name = input.stationName;
  if (input.namePronunciation !== undefined) update.name_pronunciation = input.namePronunciation;
  if (input.stationNamePronunciation !== undefined) update.station_name_pronunciation = input.stationNamePronunciation;
  if (input.contactEmail !== undefined) update.contact_email = input.contactEmail;
  if (input.announcementLanguage !== undefined) update.announcement_language = input.announcementLanguage;
  if (input.businessType !== undefined) update.business_type = input.businessType;
  return update;
}

/** Update payload for the profile form: details, business type and status. */
export function toBusinessProfileUpdate(input: BusinessProfileInput): TablesUpdate<"businesses"> {
  return {
    name: input.name,
    station_name: input.stationName,
    name_pronunciation: input.namePronunciation,
    station_name_pronunciation: input.stationNamePronunciation,
    contact_email: input.contactEmail,
    announcement_language: input.announcementLanguage,
    business_type: input.businessType,
    is_active: input.isActive,
  };
}

/** Confirmation for deleting a venue: the typed text must equal its name (surrounding spaces ignored). */
export function deleteConfirmationMatches(businessName: string, typed: string): boolean {
  return typed.trim().length > 0 && typed.trim() === businessName.trim();
}

// ---------------------------------------------------------------------------
// Members: status
// ---------------------------------------------------------------------------

/** The Supabase Auth fields the admin UI needs about a member. */
export interface AuthUserSnapshot {
  id: string;
  email: string | null;
  invitedAt: string | null;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  createdAt: string | null;
}

export function toAuthUserSnapshot(user: User): AuthUserSnapshot {
  return {
    id: user.id,
    email: user.email ?? null,
    invitedAt: user.invited_at ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? user.confirmed_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    bannedUntil: user.banned_until ?? null,
    createdAt: user.created_at ?? null,
  };
}

export type MemberStatusKind = "active" | "invited" | "unconfirmed" | "suspended" | "unknown";
export type MemberStatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface MemberStatus {
  kind: MemberStatusKind;
  label: string;
  tone: MemberStatusTone;
  detail: string | null;
  /**
   * How access is (re)granted: "invite" until the invitation is accepted, "recovery" (password
   * reset) afterwards, null when it cannot be decided (status unknown or sign-in blocked).
   */
  access: "invite" | "recovery" | null;
}

function isInFuture(value: string | null, now: Date): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > now.getTime();
}

export function isConfirmedUser(user: Pick<AuthUserSnapshot, "emailConfirmedAt">): boolean {
  return Boolean(user.emailConfirmedAt);
}

/** The account accepted its invitation and may sign in (confirmed and not blocked). */
export function isAcceptedAuthUser(user: Pick<AuthUserSnapshot, "emailConfirmedAt" | "bannedUntil">, now: Date): boolean {
  return isConfirmedUser(user) && !isInFuture(user.bannedUntil, now);
}

export function deriveMemberStatus(user: AuthUserSnapshot | null, now: Date): MemberStatus {
  if (!user) {
    return {
      kind: "unknown",
      label: "Status unavailable",
      tone: "neutral",
      detail: "The sign-in status could not be loaded.",
      access: null,
    };
  }
  if (isInFuture(user.bannedUntil, now)) {
    return {
      kind: "suspended",
      label: "Blocked",
      tone: "danger",
      detail: `Sign-in is blocked in Supabase Auth until ${formatDateTime(user.bannedUntil)}.`,
      access: null,
    };
  }
  if (isConfirmedUser(user)) {
    return {
      kind: "active",
      label: "Active",
      tone: "success",
      detail: user.lastSignInAt ? `Last signed in ${formatDateTime(user.lastSignInAt)}` : "Has not signed in yet",
      access: "recovery",
    };
  }
  if (user.invitedAt) {
    return {
      kind: "invited",
      label: "Invitation pending",
      tone: "warning",
      detail: `Invited ${formatDateTime(user.invitedAt)} · not accepted yet`,
      access: "invite",
    };
  }
  return {
    kind: "unconfirmed",
    label: "Not confirmed",
    tone: "neutral",
    detail: "The email address has not been confirmed yet.",
    access: "invite",
  };
}

// ---------------------------------------------------------------------------
// Auth links and errors
// ---------------------------------------------------------------------------

export type AuthLinkType = "invite" | "recovery";

/** Same rule as the /auth/confirm parser: hex digests, optionally prefixed. */
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_.-]{8,512}$/;

/** Where invite and recovery links land after /auth/confirm: the "choose your password" page. */
export const AUTH_LINK_NEXT_PATH = "/reset-password";

/**
 * The link an invite/recovery email would contain (docs/research/supabase.md §4.4). /auth/confirm is
 * a page whose button verifies the token (so link scanners cannot use it up), then /reset-password.
 */
export function buildAuthConfirmLink(siteUrl: string, hashedToken: string, type: AuthLinkType): string {
  if (!TOKEN_HASH_PATTERN.test(hashedToken)) {
    throw new Error("Supabase returned an unexpected token for the one-time link.");
  }
  const origin = siteUrl.replace(/\/+$/, "");
  return `${origin}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=${type}&next=${AUTH_LINK_NEXT_PATH}`;
}

function authErrorCode(error: unknown): string | null {
  return isAuthError(error) && typeof error.code === "string" ? error.code : null;
}

function authErrorStatus(error: unknown): number | null {
  return isAuthError(error) && typeof error.status === "number" ? error.status : null;
}

/** Supabase answers 422 `email_exists` when inviting an address that is already registered. */
export function isEmailExistsError(error: unknown): boolean {
  const code = authErrorCode(error);
  if (code === "email_exists" || code === "user_already_exists") return true;
  return authErrorStatus(error) === 422 && isAuthError(error) && /already (been )?registered/i.test(error.message);
}

export type AuthAdminOperation = "invite_email" | "reset_email" | "invite_link" | "reset_link" | "lookup";

/**
 * Honest, admin-facing explanation of a failed Supabase Auth admin call. Branches on the error code
 * and status, never on message text (except the documented email_exists wording).
 */
export function describeAuthAdminError(error: unknown, operation: AuthAdminOperation): string {
  const code = authErrorCode(error);
  const status = authErrorStatus(error);
  const sendsEmail = operation === "invite_email" || operation === "reset_email";
  const linkAlternative =
    operation === "reset_email"
      ? "create a one-time reset link instead and deliver it privately"
      : "create a one-time invite link instead and deliver it privately";

  if (isAuthRetryableFetchError(error)) {
    return "The sign-in service (Supabase Auth) could not be reached. Nothing was changed there; try again in a moment.";
  }
  switch (code) {
    case "email_address_not_authorized":
      return (
        "No email was sent: Supabase’s built-in email service only delivers to members of your Supabase " +
        `project team. Set up custom SMTP in Supabase (Authentication → Emails), or ${linkAlternative}.`
      );
    case "over_email_send_rate_limit":
      return (
        "No email was sent: the Supabase email limit was reached (the built-in service allows only about 2 emails " +
        `per hour). Wait before trying again, or ${linkAlternative}.`
      );
    case "over_request_rate_limit":
      return "Supabase Auth is receiving too many requests right now. Wait a minute and try again.";
    case "email_address_invalid":
    case "validation_failed":
      return "Supabase rejected this email address. Check it for typos.";
    case "email_exists":
    case "user_already_exists":
      return "An account with this email address already exists.";
    case "user_not_found":
      return "This account no longer exists in Supabase Auth.";
    case "user_banned":
      return "This account is blocked in Supabase Auth, so it cannot be given access.";
    case "email_provider_disabled":
      return "Email sign-in is disabled in Supabase (Authentication → Sign In / Providers). Enable the Email provider first.";
  }
  if (status !== null && status >= 500) {
    return sendsEmail
      ? `Supabase could not send the email. This usually means custom SMTP is misconfigured or the email service is down. Try again later, or ${linkAlternative}.`
      : "Supabase Auth had an internal problem. Try again in a moment.";
  }
  if (status === 401 || status === 403) {
    return "Supabase rejected the server’s secret key. Check SUPABASE_SECRET_KEY in the server configuration.";
  }
  if (isAuthError(error)) {
    return `Supabase Auth refused the request${code ? ` (${code})` : status ? ` (HTTP ${status})` : ""}.`;
  }
  return "Something went wrong while contacting the sign-in service. Try again.";
}

// ---------------------------------------------------------------------------
// Ports (so the member-access flows are testable without Supabase)
// ---------------------------------------------------------------------------

export type PortResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Supabase Auth admin operations (secret-key client). */
export interface AuthAdminPort {
  /** `value: null` when the user does not exist. */
  getUser(userId: string): Promise<PortResult<AuthUserSnapshot | null>>;
  inviteByEmail(email: string, options: { redirectTo: string; data: Record<string, string> }): Promise<PortResult<AuthUserSnapshot>>;
  generateLink(params: {
    type: AuthLinkType;
    email: string;
    redirectTo: string;
    data?: Record<string, string>;
  }): Promise<PortResult<{ user: AuthUserSnapshot; hashedToken: string }>>;
  sendPasswordReset(email: string, redirectTo: string): Promise<PortResult<null>>;
}

export function createAuthAdminPort(admin: TypedSupabaseClient): AuthAdminPort {
  return {
    async getUser(userId) {
      try {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        if (error) {
          if (error.status === 404 || error.code === "user_not_found") return { ok: true, value: null };
          return { ok: false, error };
        }
        return { ok: true, value: toAuthUserSnapshot(data.user) };
      } catch (error) {
        return { ok: false, error };
      }
    },
    async inviteByEmail(email, { redirectTo, data }) {
      try {
        const result = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data });
        if (result.error) return { ok: false, error: result.error };
        return { ok: true, value: toAuthUserSnapshot(result.data.user) };
      } catch (error) {
        return { ok: false, error };
      }
    },
    async generateLink({ type, email, redirectTo, data }) {
      try {
        const result =
          type === "invite"
            ? await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo, data } })
            : await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
        if (result.error) return { ok: false, error: result.error };
        return {
          ok: true,
          value: { user: toAuthUserSnapshot(result.data.user), hashedToken: result.data.properties.hashed_token },
        };
      } catch (error) {
        return { ok: false, error };
      }
    },
    async sendPasswordReset(email, redirectTo) {
      try {
        // The secret-key client uses the implicit flow, so the email carries a plain token hash that
        // /auth/confirm can verify in any browser (the PKCE flow would tie it to this server).
        const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) return { ok: false, error };
        return { ok: true, value: null };
      } catch (error) {
        return { ok: false, error };
      }
    },
  };
}

/** Reads every Supabase Auth account once (secret-key client), for the list's sign-in statuses. */
export interface AuthUserDirectory {
  listUsers(): Promise<PortResult<AuthUserSnapshot[]>>;
}

export const AUTH_LIST_PAGE_SIZE = 1000;
const AUTH_LIST_MAX_PAGES = 20;

export function createAuthUserDirectory(admin: TypedSupabaseClient): AuthUserDirectory {
  return {
    async listUsers() {
      try {
        const users: AuthUserSnapshot[] = [];
        for (let page = 1; page <= AUTH_LIST_MAX_PAGES; page += 1) {
          const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_LIST_PAGE_SIZE });
          if (error) return { ok: false, error };
          users.push(...data.users.map(toAuthUserSnapshot));
          if (data.users.length < AUTH_LIST_PAGE_SIZE) return { ok: true, value: users };
        }
        return { ok: false, error: new Error("There are too many accounts to read their sign-in statuses.") };
      } catch (error) {
        return { ok: false, error };
      }
    },
  };
}

export interface ProfileSummary {
  id: string;
  email: string;
  role: AppRole;
}

export interface MembershipSummary {
  businessId: string;
  businessName: string | null;
}

export type AddMembershipResult =
  | { ok: true; added: boolean }
  | { ok: false; reason: "member_elsewhere"; businessName: string | null }
  | { ok: false; reason: "not_found" };

/** Profile/membership reads and writes with the admin's own (RLS) client. Throws BusinessDataError. */
export interface MemberDirectoryPort {
  getBusiness(businessId: string): Promise<{ id: string; name: string } | null>;
  findProfileByEmail(email: string): Promise<ProfileSummary | null>;
  getProfile(userId: string): Promise<ProfileSummary | null>;
  getMembership(userId: string): Promise<MembershipSummary | null>;
  addMembership(businessId: string, userId: string): Promise<AddMembershipResult>;
}

/** Escapes LIKE wildcards so an address is matched literally (case-insensitively). */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function createMemberDirectory(supabase: TypedSupabaseClient): MemberDirectoryPort {
  async function getMembership(userId: string): Promise<MembershipSummary | null> {
    const { data, error } = await supabase
      .from("business_members")
      .select("business_id, businesses ( name )")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new BusinessDataError("Could not load the account’s venue membership.", error);
    if (!data) return null;
    return { businessId: data.business_id, businessName: data.businesses?.name ?? null };
  }

  return {
    async getBusiness(businessId) {
      const { data, error } = await supabase.from("businesses").select("id, name").eq("id", businessId).maybeSingle();
      if (error) throw new BusinessDataError("Could not load the business.", error);
      return data;
    },

    async findProfileByEmail(email) {
      const normalized = email.trim().toLowerCase();
      // Supabase Auth stores addresses in lower case, so an exact match is the normal path.
      const exact = await supabase.from("profiles").select("id, email, role").eq("email", normalized).limit(1);
      if (exact.error) throw new BusinessDataError("Could not look up the account.", exact.error);
      if (exact.data.length > 0) return exact.data[0];
      // Fallback for rows stored with different casing. PostgREST treats `*` as a wildcard in
      // (i)like patterns and it cannot be escaped, so such addresses rely on the exact match only.
      if (normalized.includes("*")) return null;
      const fuzzy = await supabase
        .from("profiles")
        .select("id, email, role")
        .ilike("email", escapeLikePattern(normalized))
        .limit(5);
      if (fuzzy.error) throw new BusinessDataError("Could not look up the account.", fuzzy.error);
      return fuzzy.data.find((profile) => profile.email.toLowerCase() === normalized) ?? null;
    },

    async getProfile(userId) {
      const { data, error } = await supabase.from("profiles").select("id, email, role").eq("id", userId).maybeSingle();
      if (error) throw new BusinessDataError("Could not load the account.", error);
      return data;
    },

    getMembership,

    async addMembership(businessId, userId) {
      const { error } = await supabase.from("business_members").insert({ business_id: businessId, user_id: userId });
      if (!error) return { ok: true, added: true };
      if (error.code === "23505") {
        // Either already a member here (primary key) or of another venue (unique user_id).
        const membership = await getMembership(userId);
        if (membership?.businessId === businessId) return { ok: true, added: false };
        return { ok: false, reason: "member_elsewhere", businessName: membership?.businessName ?? null };
      }
      if (error.code === "23503") return { ok: false, reason: "not_found" };
      throw new BusinessDataError("Could not add the account to the venue.", error);
    },
  };
}

// ---------------------------------------------------------------------------
// Member access flows: invite, resend, one-time links, password reset
// ---------------------------------------------------------------------------

export interface AccessLink {
  url: string;
  type: AuthLinkType;
  email: string;
}

export type MemberAccessResult =
  | { ok: true; message: string; link: AccessLink | null }
  | { ok: false; message: string; field?: "email" };

export interface MemberAccessDeps {
  directory: MemberDirectoryPort;
  auth: AuthAdminPort;
  /** Origin the auth emails and links return to (NEXT_PUBLIC_SITE_URL). */
  siteUrl: string;
  now?: () => Date;
}

const LINK_EXPIRY_NOTE = "It works once and expires after a while (1 hour unless your Supabase settings say otherwise).";

function fail(message: string, field?: "email"): MemberAccessResult {
  return field ? { ok: false, message, field } : { ok: false, message };
}

function describeMembershipFailure(result: Exclude<AddMembershipResult, { ok: true }>, email: string): string {
  if (result.reason === "member_elsewhere") {
    const venue = result.businessName ? `“${result.businessName}”` : "another venue";
    return `${email} already belongs to ${venue}. Each account can belong to only one venue — remove them there first.`;
  }
  return "the business or the account no longer exists. Refresh the page and try again.";
}

interface BusinessRef {
  id: string;
  name: string;
}

type AccessContext = "invite_form" | "member_row";

async function sendInvite(deps: MemberAccessDeps, business: BusinessRef, email: string): Promise<PortResult<AuthUserSnapshot>> {
  return deps.auth.inviteByEmail(email, { redirectTo: deps.siteUrl, data: { business_name: business.name } });
}

async function createLink(
  deps: MemberAccessDeps,
  business: BusinessRef,
  email: string,
  type: AuthLinkType,
): Promise<PortResult<{ user: AuthUserSnapshot; link: AccessLink }>> {
  const generated = await deps.auth.generateLink(
    type === "invite"
      ? { type, email, redirectTo: deps.siteUrl, data: { business_name: business.name } }
      : { type, email, redirectTo: deps.siteUrl },
  );
  if (!generated.ok) return generated;
  return {
    ok: true,
    value: {
      user: generated.value.user,
      link: { url: buildAuthConfirmLink(deps.siteUrl, generated.value.hashedToken, type), type, email },
    },
  };
}

function linkCreatedMessage(link: AccessLink, prefix: string): string {
  return link.type === "invite"
    ? `${prefix}One-time invite link created for ${link.email}. Any earlier invitation link for this address no longer works.`
    : `${prefix}One-time password reset link created for ${link.email}.`;
}

/**
 * Gives an existing account access to `business`: checks it is a venue account that belongs to no
 * other venue, adds the membership when allowed, then sends/creates what fits its state — an
 * invitation until it has been accepted, a password reset afterwards.
 */
async function grantAccessToExistingUser(
  deps: MemberAccessDeps,
  business: BusinessRef,
  profile: ProfileSummary,
  delivery: InviteDelivery,
  context: AccessContext,
): Promise<MemberAccessResult> {
  const email = profile.email;
  if (profile.role === "platform_admin") {
    return fail(`${email} is a platform admin account. Admin accounts can’t be venue staff — use a different email address.`, "email");
  }

  const membership = await deps.directory.getMembership(profile.id);
  if (membership && membership.businessId !== business.id) {
    return fail(describeMembershipFailure({ ok: false, reason: "member_elsewhere", businessName: membership.businessName }, email), "email");
  }
  if (!membership && context === "member_row") {
    return fail(`${email} is no longer a member of ${business.name}. Refresh the page.`);
  }

  const lookup = await deps.auth.getUser(profile.id);
  if (!lookup.ok) return fail(describeAuthAdminError(lookup.error, "lookup"));
  const user = lookup.value;
  if (!user) return fail(`${email} no longer has a sign-in account. Refresh the page.`);
  const now = deps.now?.() ?? new Date();
  if (isInFuture(user.bannedUntil, now)) {
    return fail(`${email} is blocked in Supabase Auth, so access can’t be granted. Unblock the account in the Supabase dashboard first.`);
  }
  const confirmed = isConfirmedUser(user);

  let added = false;
  if (!membership) {
    const result = await deps.directory.addMembership(business.id, profile.id);
    if (!result.ok) {
      return result.reason === "member_elsewhere"
        ? fail(describeMembershipFailure(result, email), "email")
        : fail(`Could not add ${email}: ${describeMembershipFailure(result, email)}`);
    }
    added = result.added;
  }
  const addedPrefix = added ? `${email} was added to ${business.name}. ` : "";

  if (confirmed) {
    if (delivery === "email") {
      if (context === "invite_form") {
        return added
          ? {
              ok: true,
              message: `${email} already has an account and was added to ${business.name}. They can sign in with their existing password — send a password reset from the staff list if they’ve forgotten it.`,
              link: null,
            }
          : fail(`${email} is already a member of ${business.name}. Use “Send password reset” in the staff list if they can’t sign in.`, "email");
      }
      const reset = await deps.auth.sendPasswordReset(email, deps.siteUrl);
      if (!reset.ok) return fail(`${addedPrefix}${describeAuthAdminError(reset.error, "reset_email")}`);
      return { ok: true, message: `${addedPrefix}Password reset email sent to ${email}. The link in it works once and expires after a while.`, link: null };
    }
    const created = await createLink(deps, business, email, "recovery");
    if (!created.ok) return fail(`${addedPrefix}${describeAuthAdminError(created.error, "reset_link")}`);
    return { ok: true, message: linkCreatedMessage(created.value.link, addedPrefix), link: created.value.link };
  }

  // Invitation not accepted yet: (re)send the invitation.
  if (delivery === "email") {
    const invited = await sendInvite(deps, business, email);
    if (!invited.ok) return fail(`${addedPrefix}${describeAuthAdminError(invited.error, "invite_email")}`);
    const verb = added ? "Invitation sent" : "Invitation sent again";
    return {
      ok: true,
      message: `${addedPrefix}${verb} to ${email}. Any earlier invitation link for this address no longer works.`,
      link: null,
    };
  }
  let created = await createLink(deps, business, email, "invite");
  if (!created.ok && isEmailExistsError(created.error)) {
    // The invitation was accepted in the meantime: a password reset link does the same job.
    created = await createLink(deps, business, email, "recovery");
  }
  if (!created.ok) return fail(`${addedPrefix}${describeAuthAdminError(created.error, "invite_link")}`);
  return { ok: true, message: linkCreatedMessage(created.value.link, addedPrefix), link: created.value.link };
}

async function addNewAccount(
  deps: MemberAccessDeps,
  business: BusinessRef,
  userId: string,
  email: string,
  whatHappened: string,
): Promise<MemberAccessResult | null> {
  const result = await deps.directory.addMembership(business.id, userId);
  if (result.ok) return null;
  const reason =
    result.reason === "member_elsewhere"
      ? `it already belongs to ${result.businessName ? `“${result.businessName}”` : "another venue"}`
      : "the business no longer exists";
  return fail(`${whatHappened}, but ${email} could not be added to ${business.name} because ${reason}.`);
}

/**
 * "Invite" form on the venue page. New addresses get a Supabase invitation (email or one-time link)
 * and a membership; existing venue accounts that belong to no venue are added directly.
 */
export async function inviteMemberToBusiness(
  deps: MemberAccessDeps,
  input: { businessId: string; email: string; delivery: InviteDelivery },
): Promise<MemberAccessResult> {
  const business = await deps.directory.getBusiness(input.businessId);
  if (!business) return fail("This business no longer exists. Go back to the list of businesses.");
  const email = input.email.trim().toLowerCase();

  const profile = await deps.directory.findProfileByEmail(email);
  if (profile) return grantAccessToExistingUser(deps, business, profile, input.delivery, "invite_form");

  const onAuthFailure = async (error: unknown, operation: AuthAdminOperation): Promise<MemberAccessResult> => {
    if (isEmailExistsError(error)) {
      // Registered after our lookup (or stored with different casing): continue as an existing account.
      const existing = await deps.directory.findProfileByEmail(email);
      if (existing) return grantAccessToExistingUser(deps, business, existing, input.delivery, "invite_form");
      return fail(
        `Supabase reports that ${email} is already registered, but no matching account profile was found. Check the user in the Supabase dashboard.`,
        "email",
      );
    }
    return fail(describeAuthAdminError(error, operation));
  };

  if (input.delivery === "email") {
    const invited = await sendInvite(deps, business, email);
    if (!invited.ok) return onAuthFailure(invited.error, "invite_email");
    const failure = await addNewAccount(deps, business, invited.value.id, email, `The invitation email was sent to ${email}`);
    if (failure) return failure;
    return {
      ok: true,
      message: `Invitation sent to ${email}. They choose their own password from the email. ${LINK_EXPIRY_NOTE}`,
      link: null,
    };
  }

  const created = await createLink(deps, business, email, "invite");
  if (!created.ok) return onAuthFailure(created.error, "invite_link");
  const failure = await addNewAccount(deps, business, created.value.user.id, email, `An account was created for ${email}`);
  if (failure) return failure;
  return { ok: true, message: linkCreatedMessage(created.value.link, ""), link: created.value.link };
}

/**
 * Staff list actions: "Resend invitation" / "Send password reset" (email) and "Create invite/reset
 * link" (link). The server decides between invitation and reset from the account's real state.
 */
export async function sendAccessToMember(
  deps: MemberAccessDeps,
  input: { businessId: string; userId: string; delivery: InviteDelivery },
): Promise<MemberAccessResult> {
  const business = await deps.directory.getBusiness(input.businessId);
  if (!business) return fail("This business no longer exists. Go back to the list of businesses.");
  const profile = await deps.directory.getProfile(input.userId);
  if (!profile) return fail("This account no longer exists. Refresh the page.");
  if (!profile.email) return fail("This account has no email address, so no invitation or reset can be sent.");
  return grantAccessToExistingUser(deps, business, profile, input.delivery, "member_row");
}

// ---------------------------------------------------------------------------
// Storage cleanup (secret-key client)
// ---------------------------------------------------------------------------

interface StorageEntry {
  name: string;
  /** null for folders. */
  id: string | null;
}

/** The part of a Storage bucket API used for cleanup (any supabase-js client satisfies it). */
export interface StorageBucketApi {
  list(
    path?: string,
    options?: { limit?: number; offset?: number; sortBy?: { column?: string; order?: string } },
  ): Promise<{ data: StorageEntry[] | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface StorageClientLike {
  storage: { from(bucket: string): StorageBucketApi };
}

export const STORAGE_LIST_PAGE_SIZE = 1000;
const STORAGE_LIST_MAX_PAGES = 200;
export const STORAGE_REMOVE_BATCH_SIZE = 100;

/** All object paths under `prefix` (folders are followed `depth` levels deep). */
export async function listObjectsUnder(bucket: StorageBucketApi, prefix: string, depth: number): Promise<string[]> {
  const files: string[] = [];
  for (let page = 0; page < STORAGE_LIST_MAX_PAGES; page += 1) {
    const { data, error } = await bucket.list(prefix, {
      limit: STORAGE_LIST_PAGE_SIZE,
      offset: page * STORAGE_LIST_PAGE_SIZE,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new StorageCleanupError(`Could not list the files in "${prefix}".`, error);
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null) {
        if (depth > 0) files.push(...(await listObjectsUnder(bucket, path, depth - 1)));
      } else {
        files.push(path);
      }
    }
    if (entries.length < STORAGE_LIST_PAGE_SIZE) return files;
  }
  throw new StorageCleanupError(`Too many files in "${prefix}" to list.`, null);
}

/** Removes objects in batches. Missing objects are ignored by Storage. Returns how many were requested. */
export async function removeObjects(bucket: StorageBucketApi, paths: readonly string[]): Promise<number> {
  const unique = [...new Set(paths)];
  for (let index = 0; index < unique.length; index += STORAGE_REMOVE_BATCH_SIZE) {
    const batch = unique.slice(index, index + STORAGE_REMOVE_BATCH_SIZE);
    const { error } = await bucket.remove(batch);
    if (error) throw new StorageCleanupError(`Could not delete ${batch.length} file(s).`, error);
  }
  return unique.length;
}

export interface BusinessStoragePaths {
  logos: string[];
  announcements: string[];
}

/**
 * Every object a venue owns: listed under the `{businessId}/` prefixes of the `logos` and
 * `announcements` buckets, plus the paths the database knows about. Only paths inside the venue's
 * own prefix are ever returned, so a bad database value can never delete another venue's files.
 */
export async function collectBusinessStoragePaths(
  storage: StorageClientLike,
  businessId: string,
  known: BusinessStoragePaths,
): Promise<BusinessStoragePaths> {
  const prefix = `${businessId}/`;
  const inPrefix = (path: string) => path.startsWith(prefix) && !path.slice(prefix.length).split("/").includes("..");
  const [logos, announcements] = await Promise.all([
    listObjectsUnder(storage.storage.from("logos"), businessId, 0),
    // {businessId}/{announcementId}/{file}.mp3
    listObjectsUnder(storage.storage.from("announcements"), businessId, 1),
  ]);
  return {
    logos: [...new Set([...logos, ...known.logos])].filter(inPrefix),
    announcements: [...new Set([...announcements, ...known.announcements])].filter(inPrefix),
  };
}

export async function removeBusinessStorage(storage: StorageClientLike, paths: BusinessStoragePaths): Promise<number> {
  const logos = await removeObjects(storage.storage.from("logos"), paths.logos);
  const announcements = await removeObjects(storage.storage.from("announcements"), paths.announcements);
  return logos + announcements;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export interface AdminBusinessListItem {
  id: string;
  name: string;
  stationName: string;
  businessType: BusinessType;
  isActive: boolean;
  contactEmail: string | null;
  logoUrl: string | null;
  /** Staff accounts (memberships). */
  memberCount: number;
  /** Staff accounts that accepted their invitation, or null when the sign-in statuses are unavailable. */
  acceptedMemberCount: number | null;
  /** Email addresses of the staff accounts (recipients of "Send password reset"). */
  memberEmails: string[];
  status: BusinessStatus;
  statusDetail: string;
  /** False when the status could not be confirmed from Supabase Auth. */
  statusVerified: boolean;
}

export interface AdminBusinessList {
  items: AdminBusinessListItem[];
  /** Why Active/Invited could not be verified (no secret key, Auth unreachable), or null. */
  statusNote: string | null;
}

/** Signed logo URLs in one request; failures fall back to the artwork (null). */
async function signLogoUrls(supabase: TypedSupabaseClient, paths: readonly string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  try {
    const { data, error } = await supabase.storage.from("logos").createSignedUrls([...paths], mediaTtlFor(null));
    if (error) {
      console.warn("[admin/businesses] could not sign logo URLs", error.message);
      return urls;
    }
    for (const entry of data) {
      if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl);
    }
  } catch (error) {
    console.warn("[admin/businesses] could not sign logo URLs", error);
  }
  return urls;
}

function toGenreAccessGenre(
  row: Pick<Tables<"genres">, "id" | "name" | "is_enabled" | "available_to_all"> & Partial<Pick<Tables<"genres">, "slug">>,
): GenreAccessGenre {
  return { id: row.id, name: row.name, isEnabled: row.is_enabled, availableToAll: row.available_to_all };
}

export interface LoadBusinessListOptions {
  /** Reads the sign-in statuses; null when the secret key is not configured. */
  authUsers: AuthUserDirectory | null;
  /** Shown as the status note when `authUsers` is null. */
  authUnavailableReason?: string;
  now?: Date;
}

const STATUS_LOOKUP_FAILED =
  "Supabase Auth didn’t return the staff sign-in statuses, so “Active” couldn’t be confirmed. Reload the page to try again.";

/**
 * /admin/businesses: every venue with its status (Active / Invited / Inactive), ordered by name.
 * Filtering happens in the browser. Sign-in statuses come from ONE Supabase Auth listing.
 */
export async function loadAdminBusinessList(
  supabase: TypedSupabaseClient,
  options: LoadBusinessListOptions,
): Promise<AdminBusinessList> {
  const [businessesResult, usersResult] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, station_name, business_type, is_active, contact_email, logo_path, business_members ( user_id, profiles ( email ) )")
      .order("name", { ascending: true }),
    options.authUsers ? options.authUsers.listUsers() : Promise.resolve(null),
  ]);
  if (businessesResult.error) throw new BusinessDataError("Could not load the businesses.", businessesResult.error);

  const now = options.now ?? new Date();
  let accounts: Map<string, AuthUserSnapshot> | null = null;
  let statusNote: string | null = null;
  if (usersResult === null) {
    statusNote = options.authUnavailableReason ?? "Staff sign-in statuses are unavailable.";
  } else if (usersResult.ok) {
    accounts = new Map(usersResult.value.map((user) => [user.id, user]));
  } else {
    console.warn("[admin/businesses] listing auth users failed", usersResult.error);
    statusNote = STATUS_LOOKUP_FAILED;
  }

  const rows = businessesResult.data ?? [];
  const logoUrls = await signLogoUrls(
    supabase,
    rows.map((row) => row.logo_path).filter((path): path is string => path !== null),
  );

  return {
    statusNote,
    items: rows.map((row): AdminBusinessListItem => {
      const members = row.business_members ?? [];
      const acceptedMemberCount = accounts
        ? members.filter((member) => {
            const account = accounts.get(member.user_id);
            return account ? isAcceptedAuthUser(account, now) : false;
          }).length
        : null;
      const status = deriveBusinessStatus({ isActive: row.is_active, memberCount: members.length, acceptedMemberCount });
      return {
        id: row.id,
        name: row.name,
        stationName: row.station_name,
        businessType: toBusinessType(row.business_type),
        isActive: row.is_active,
        contactEmail: row.contact_email,
        logoUrl: row.logo_path ? (logoUrls.get(row.logo_path) ?? null) : null,
        memberCount: members.length,
        acceptedMemberCount,
        memberEmails: members.map((member) => member.profiles?.email ?? "").filter((email) => email.length > 0),
        status: status.status,
        statusDetail: status.detail,
        statusVerified: status.verified,
      };
    }),
  };
}

export interface BusinessMember {
  userId: string;
  email: string;
  fullName: string | null;
  /** When the membership was created (ISO). */
  addedAt: string;
  status: MemberStatus;
}

export interface AdminBusinessDetail {
  business: AdminBusinessRecord;
  logoUrl: string | null;
  genres: GenreAccessOption[];
  accessibleGenreCount: number;
  announcements: BusinessAnnouncementSummary;
  members: BusinessMember[];
  /** Why member sign-in statuses are missing (e.g. the secret key is not configured), or null. */
  memberStatusNote: string | null;
  status: BusinessStatusView;
}

const AUTH_LOOKUP_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Accepted staff accounts from the members' statuses: a count when it is known, null when no
 * account is known to be accepted but some statuses could not be read.
 */
export function countAcceptedMembers(members: readonly Pick<BusinessMember, "status">[]): number | null {
  const accepted = members.filter((member) => member.status.kind === "active").length;
  if (accepted > 0) return accepted;
  return members.some((member) => member.status.kind === "unknown") ? null : 0;
}

export interface LoadBusinessDetailOptions {
  /** Auth admin access for member statuses; null when the secret key is not configured. */
  auth: AuthAdminPort | null;
  /** Shown instead of statuses when `auth` is null. */
  authUnavailableReason?: string;
  now?: Date;
}

/** /admin/businesses/[id]. Returns null when the business does not exist. */
export async function loadAdminBusinessDetail(
  supabase: TypedSupabaseClient,
  businessId: string,
  options: LoadBusinessDetailOptions,
): Promise<AdminBusinessDetail | null> {
  const [businessResult, genresResult, accessResult, countsResult, membersResult, announcementsResult] = await Promise.all([
    supabase.from("businesses").select("*").eq("id", businessId).maybeSingle(),
    supabase
      .from("genres")
      .select("id, name, slug, is_enabled, available_to_all, sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("business_genre_access").select("genre_id").eq("business_id", businessId),
    supabase.rpc("genre_track_counts"),
    supabase
      .from("business_members")
      .select("user_id, created_at, profiles ( email, full_name )")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
    supabase
      .from("announcements")
      .select("status, needs_review, audio_path, branding_version, placement, approved_at, generation_started_at")
      .eq("business_id", businessId),
  ]);

  if (businessResult.error) throw new BusinessDataError("Could not load the business.", businessResult.error);
  if (!businessResult.data) return null;
  if (genresResult.error) throw new BusinessDataError("Could not load the genres.", genresResult.error);
  if (accessResult.error) throw new BusinessDataError("Could not load the genre access.", accessResult.error);
  if (membersResult.error) throw new BusinessDataError("Could not load the staff accounts.", membersResult.error);
  if (announcementsResult.error) throw new BusinessDataError("Could not load the announcements.", announcementsResult.error);
  if (countsResult.error) console.warn("[admin/businesses] genre track counts unavailable", countsResult.error.message);

  const business = toAdminBusinessRecord(businessResult.data);
  const genres = (genresResult.data ?? []).map(toGenreAccessGenre);
  const assignedIds = (accessResult.data ?? []).map((row) => row.genre_id);
  const playableCounts = countsResult.error
    ? null
    : new Map((countsResult.data ?? []).map((row) => [row.genre_id, row.playable_count]));

  let logoUrl: string | null = null;
  if (business.logoPath) {
    try {
      logoUrl = (await signLogoObject(supabase, business.logoPath)).url;
    } catch (error) {
      console.warn("[admin/businesses] could not sign the logo URL", error);
    }
  }

  const now = options.now ?? new Date();
  const memberRows = membersResult.data ?? [];
  const auth = options.auth;
  let lookupFailures = 0;
  const members = await mapWithConcurrency(memberRows, AUTH_LOOKUP_CONCURRENCY, async (row): Promise<BusinessMember> => {
    let snapshot: AuthUserSnapshot | null = null;
    if (auth) {
      const result = await auth.getUser(row.user_id);
      if (result.ok) snapshot = result.value;
      else {
        lookupFailures += 1;
        console.warn("[admin/businesses] member status lookup failed", row.user_id, result.error);
      }
    }
    return {
      userId: row.user_id,
      email: row.profiles?.email || snapshot?.email || "(no email address)",
      fullName: row.profiles?.full_name ?? null,
      addedAt: row.created_at,
      status: deriveMemberStatus(snapshot, now),
    };
  });

  let memberStatusNote: string | null = null;
  if (!auth && memberRows.length > 0) {
    memberStatusNote = options.authUnavailableReason ?? "Sign-in statuses are unavailable.";
  } else if (lookupFailures > 0) {
    memberStatusNote = `The sign-in status of ${lookupFailures === 1 ? "one account" : `${lookupFailures} accounts`} could not be loaded from Supabase Auth. Reload the page to try again.`;
  }

  return {
    business,
    logoUrl,
    genres: buildGenreAccessOptions(genres, assignedIds, playableCounts),
    accessibleGenreCount: countAccessibleGenres(genres, assignedIds),
    announcements: summarizeAnnouncements((announcementsResult.data ?? []).map(toSummaryRow), business.brandingVersion, now),
    members,
    memberStatusNote,
    status: deriveBusinessStatus({
      isActive: business.isActive,
      memberCount: members.length,
      acceptedMemberCount: countAcceptedMembers(members),
    }),
  };
}

/**
 * The genres offered on the "Add business" form: enabled genres in display order. Exclusive ones are
 * tickable; genres available to all are shown as included.
 */
export async function loadGenreAccessChoices(supabase: TypedSupabaseClient): Promise<GenreAccessOption[]> {
  const { data, error } = await supabase
    .from("genres")
    .select("id, name, is_enabled, available_to_all, sort_order")
    .eq("is_enabled", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new BusinessDataError("Could not load the genres.", error);
  return buildGenreAccessOptions((data ?? []).map(toGenreAccessGenre), []);
}

/** The storage paths the database knows for a venue (read before the row is deleted). */
export async function loadKnownBusinessStoragePaths(
  supabase: TypedSupabaseClient,
  businessId: string,
): Promise<{ business: { id: string; name: string; isActive: boolean } | null; paths: BusinessStoragePaths }> {
  const [businessResult, announcementsResult] = await Promise.all([
    supabase.from("businesses").select("id, name, is_active, logo_path").eq("id", businessId).maybeSingle(),
    supabase.from("announcements").select("audio_path").eq("business_id", businessId).not("audio_path", "is", null),
  ]);
  if (businessResult.error) throw new BusinessDataError("Could not load the business.", businessResult.error);
  if (announcementsResult.error) throw new BusinessDataError("Could not load the announcements.", announcementsResult.error);
  const row = businessResult.data;
  return {
    business: row ? { id: row.id, name: row.name, isActive: row.is_active } : null,
    paths: {
      logos: row?.logo_path ? [row.logo_path] : [],
      announcements: (announcementsResult.data ?? [])
        .map((announcement) => announcement.audio_path)
        .filter((path): path is string => path !== null),
    },
  };
}
