"use server";

import { connection } from "next/server";
import type {
  BusinessProfileState,
  MemberAccessState,
  NewBusinessState,
  NewBusinessValues,
} from "@/components/admin/businesses/action-types";
import {
  lastFormString,
  readBusinessFormValues,
  stationNameOrSuggestion,
} from "@/components/admin/businesses/business-form";
import { describeDbError, type ActionState } from "@/lib/actions/state";
import { requireAdminAction } from "@/lib/auth/session";
import { markAccessRequestApproved } from "@/lib/data/admin/access-requests";
import {
  collectBusinessStoragePaths,
  computeGenreAccessUpdate,
  countAccessibleGenres,
  deleteConfirmationMatches,
  inviteMemberToBusiness,
  loadKnownBusinessStoragePaths,
  removeBusinessStorage,
  sendAccessToMember,
  toBusinessInsert,
  toBusinessProfileUpdate,
  type AccessLink,
  type GenreAccessGenre,
  type MemberAccessResult,
} from "@/lib/data/admin/businesses";
import { loadDefaultAnnouncementFrequency } from "@/lib/data/admin/settings";
import { EnvError } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import {
  businessActivationSchema,
  businessProfileSchema,
  deleteBusinessSchema,
  MAX_GENRES_PER_BUSINESS,
  memberAccessSchema,
  memberRefSchema,
  newBusinessSchema,
} from "@/lib/validation/businesses";
import { idArray, idSchema } from "@/lib/validation/fields";
import { formDataToObject, summarizeValidationError, toFieldErrors } from "@/lib/validation/forms";
import { inviteUserSchema } from "@/lib/validation/invites";
import {
  checkInviteRateLimit,
  dataFailureMessage,
  done,
  failed,
  memberAccessDeps,
  plural,
  revalidateBusinesses,
  submittedStrings,
} from "./_lib/action-helpers";

/*
 * Server Actions of /admin/businesses. Every action authorises itself with requireAdminAction()
 * and writes with the admin's own Supabase client (RLS). The secret-key client is only used for
 * Supabase Auth admin calls (invitations, resets) and for deleting Storage files.
 */

const genreIdList = idArray("Genres", MAX_GENRES_PER_BUSINESS);

function toGenreList(rows: readonly { id: string; name: string; is_enabled: boolean; available_to_all: boolean }[]): GenreAccessGenre[] {
  return rows.map((row) => ({ id: row.id, name: row.name, isEnabled: row.is_enabled, availableToAll: row.available_to_all }));
}

async function loadGenreList(supabase: TypedSupabaseClient) {
  return supabase
    .from("genres")
    .select("id, name, is_enabled, available_to_all")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

// ---------------------------------------------------------------------------
// Add business
// ---------------------------------------------------------------------------

function readNewBusinessValues(formData: FormData): NewBusinessValues {
  return {
    ...readBusinessFormValues(formData),
    genreIds: submittedStrings(formData.getAll("genreIds")).join(","),
    inviteContact: lastFormString(formData, "inviteContact"),
    inviteDelivery: lastFormString(formData, "inviteDelivery"),
    fromRequest: lastFormString(formData, "fromRequest"),
  };
}

function newBusinessFailure(message: string, values: NewBusinessValues, fieldErrors: Record<string, string> = {}): NewBusinessState {
  return { ok: false, message, fieldErrors, values, created: null, link: null, warnings: [], nonce: Date.now() };
}

/**
 * "Add business": creates the venue (announcement frequency from the platform default), gives it the
 * ticked exclusive genres, marks the access request it came from approved, and invites the contact
 * with the usual invitation flow. Once the row exists the result is `ok` with `created` set; any
 * later step that did not complete is listed in `warnings` so nothing is created twice.
 */
export async function createBusiness(_previous: NewBusinessState, formData: FormData): Promise<NewBusinessState> {
  const { ctx, supabase } = await requireAdminAction();
  const values = readNewBusinessValues(formData);
  const raw = formDataToObject(formData, { arrays: ["genreIds"] });

  const parsed = newBusinessSchema.safeParse({
    name: raw.name,
    stationName: stationNameOrSuggestion(values.stationName, values.name),
    namePronunciation: raw.namePronunciation,
    stationNamePronunciation: raw.stationNamePronunciation,
    contactEmail: raw.contactEmail,
    announcementLanguage: raw.announcementLanguage,
    businessType: raw.businessType,
    isActive: raw.isActive,
    genreIds: raw.genreIds,
    inviteContact: raw.inviteContact,
    inviteDelivery: raw.inviteDelivery,
    fromRequest: raw.fromRequest,
  });
  if (!parsed.success) {
    return newBusinessFailure(summarizeValidationError(parsed.error), values, toFieldErrors(parsed.error));
  }
  const input = parsed.data;

  const frequency = await loadDefaultAnnouncementFrequency(supabase);
  const { data, error } = await supabase
    .from("businesses")
    .insert(toBusinessInsert({ ...input, announcementEveryNTracks: frequency.everyNTracks }))
    .select("id, name")
    .single();
  if (error || !data) {
    console.error("[admin/businesses] create failed", error);
    return newBusinessFailure(describeDbError(error, "The business could not be created. Nothing was saved; please try again."), values);
  }

  const created = { id: data.id, name: data.name };
  const notes: string[] = [];
  const warnings: string[] = [];

  if (input.genreIds.length > 0) {
    const genres = await loadGenreList(supabase);
    if (genres.error) {
      console.error("[admin/businesses] create: genres lookup failed", genres.error);
      warnings.push("Its exclusive genres could not be saved. Tick them again on its Profile tab.");
    } else {
      const update = computeGenreAccessUpdate(toGenreList(genres.data ?? []), [], input.genreIds);
      if (update.next.length > 0) {
        const rpc = await supabase.rpc("set_business_genre_access", { p_business_id: created.id, p_genre_ids: update.next });
        if (rpc.error) {
          console.error("[admin/businesses] create: genre access failed", rpc.error);
          warnings.push("Its exclusive genres could not be saved. Tick them again on its Profile tab.");
        } else {
          notes.push(`${plural(update.next.length, "exclusive genre was", "exclusive genres were")} assigned.`);
        }
      }
    }
  }

  if (input.fromRequest) {
    const marked = await markAccessRequestApproved(supabase, input.fromRequest, ctx.userId, new Date());
    if (marked === "approved") notes.push("The access request is marked approved.");
    else if (marked === "already_closed") notes.push("The access request was already closed, so its status was left as it is.");
    else if (marked === "missing") warnings.push("The access request it came from no longer exists.");
    else warnings.push("The access request could not be marked approved. Update it on the Access requests page.");
  }

  let link: AccessLink | null = null;
  if (input.inviteContact && input.contactEmail) {
    const limited = await checkInviteRateLimit(ctx.userId);
    if (limited) {
      warnings.push(`The contact was not invited: ${limited} You can invite them later from the Access tab.`);
    } else {
      const deps = await memberAccessDeps(supabase);
      if (!deps.ok) {
        warnings.push(`The contact was not invited. ${deps.message}`);
      } else {
        try {
          const result = await inviteMemberToBusiness(deps.deps, {
            businessId: created.id,
            email: input.contactEmail,
            delivery: input.inviteDelivery,
          });
          if (result.ok) {
            notes.push(result.message);
            link = result.link;
          } else {
            warnings.push(`The contact was not invited: ${result.message} You can try again from the Access tab.`);
          }
        } catch (caught) {
          warnings.push(
            `The contact was not invited: ${dataFailureMessage("create: invite failed", caught, "the invitation could not be completed.")} You can try again from the Access tab.`,
          );
        }
      }
    }
  }

  revalidateBusinesses();
  return {
    ok: true,
    message: [`${created.name} was created.`, ...notes].join(" "),
    fieldErrors: {},
    created,
    link,
    warnings,
    nonce: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Profile (details, type, status and genre access in one save)
// ---------------------------------------------------------------------------

/**
 * The Profile tab's single "Save changes": details, business type, status and exclusive genre access.
 * Changing the branding marks the venue's announcements for review (database trigger); the message
 * says how many.
 */
export async function saveBusinessProfile(_previous: BusinessProfileState, formData: FormData): Promise<BusinessProfileState> {
  const { supabase } = await requireAdminAction();
  const values = { ...readBusinessFormValues(formData), genreIds: submittedStrings(formData.getAll("genreIds")).join(",") };

  const businessId = idSchema.safeParse(formData.get("businessId"));
  if (!businessId.success) return failed("This business could not be identified. Reload the page and try again.", values);
  const id = businessId.data;

  const raw = formDataToObject(formData, { arrays: ["genreIds", "shownGenreIds"] });
  const parsed = businessProfileSchema.safeParse({
    name: raw.name,
    stationName: raw.stationName,
    namePronunciation: raw.namePronunciation,
    stationNamePronunciation: raw.stationNamePronunciation,
    contactEmail: raw.contactEmail,
    announcementLanguage: raw.announcementLanguage,
    businessType: raw.businessType,
    isActive: raw.isActive,
  });
  const genreIds = genreIdList.safeParse(raw.genreIds);
  const shownGenreIds = genreIdList.safeParse(raw.shownGenreIds);
  if (!parsed.success) return failed(summarizeValidationError(parsed.error), values, toFieldErrors(parsed.error));
  if (!genreIds.success || !shownGenreIds.success) {
    return failed("The genre selection could not be read. Reload the page and try again.", values);
  }

  const [current, genres, access] = await Promise.all([
    supabase.from("businesses").select("branding_version, is_active").eq("id", id).maybeSingle(),
    loadGenreList(supabase),
    supabase.from("business_genre_access").select("genre_id").eq("business_id", id),
  ]);
  if (current.error) {
    return failed(dataFailureMessage("profile: lookup failed", current.error, "The business could not be loaded. Nothing was saved."), values);
  }
  if (!current.data) return failed("This business no longer exists.", values);

  const updated = await supabase
    .from("businesses")
    .update(toBusinessProfileUpdate(parsed.data))
    .eq("id", id)
    .select("name, branding_version, is_active")
    .maybeSingle();
  if (updated.error) {
    console.error("[admin/businesses] profile: update failed", updated.error);
    return failed(describeDbError(updated.error, "The changes could not be saved. Please try again."), values);
  }
  if (!updated.data) return failed("This business no longer exists.", values);

  const messages = ["Changes saved."];
  const brandingChanged = updated.data.branding_version !== current.data.branding_version;
  if (brandingChanged) {
    const { count, error } = await supabase
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .eq("business_id", id);
    if (error) {
      console.warn("[admin/businesses] profile: announcement count failed", error);
      messages.push("The branding changed, so this venue’s announcements are marked for review.");
    } else if (count) {
      messages.push(
        `The branding changed, so ${plural(count, "announcement is", "announcements are")} marked for review. Approved ones stay off air until you approve them again.`,
      );
    }
  }
  if (updated.data.is_active !== current.data.is_active) {
    messages.push(
      updated.data.is_active
        ? `${updated.data.name} is active again: its staff can start the radio.`
        : `${updated.data.name} is now inactive: its players stop when the current song ends.`,
    );
  }

  let genreProblem: string | null = null;
  if (genres.error || access.error) {
    console.error("[admin/businesses] profile: genre lookup failed", genres.error ?? access.error);
    genreProblem = "genre access could not be loaded, so it was not changed.";
  } else {
    const genreList = toGenreList(genres.data ?? []);
    const update = computeGenreAccessUpdate(
      genreList,
      (access.data ?? []).map((row) => row.genre_id),
      genreIds.data,
      shownGenreIds.data,
    );
    if (update.changed) {
      const rpc = await supabase.rpc("set_business_genre_access", { p_business_id: id, p_genre_ids: update.next });
      if (rpc.error) {
        console.error("[admin/businesses] profile: genre access failed", rpc.error);
        genreProblem =
          rpc.error.code === "23503"
            ? "one of the genres no longer exists, so genre access was not changed. Reload the page and try again."
            : "genre access could not be saved. Please try again.";
      } else {
        messages.push(`${updated.data.name} can now choose ${plural(countAccessibleGenres(genreList, update.next), "genre", "genres")}.`);
      }
    }
  }

  revalidateBusinesses({ announcements: brandingChanged });
  if (genreProblem) return { ...failed(`The profile was saved, but ${genreProblem}`, values), saved: true };
  return done(messages.join(" "));
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export async function setBusinessActive(businessId: string, isActive: boolean): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const parsed = businessActivationSchema.safeParse({ businessId, isActive });
  if (!parsed.success) return failed(summarizeValidationError(parsed.error));

  const { data, error } = await supabase
    .from("businesses")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.businessId)
    .select("name, is_active")
    .maybeSingle();
  if (error) {
    console.error("[admin/businesses] activation failed", error);
    return failed(describeDbError(error, "The venue’s status could not be changed. Please try again."));
  }
  if (!data) return failed("This business no longer exists.");

  revalidateBusinesses();
  return done(
    data.is_active
      ? `${data.name} is active. Its staff can start the radio.`
      : `${data.name} is inactive. Its players stop when the current song ends, and staff see that the venue is not active.`,
  );
}

// ---------------------------------------------------------------------------
// Logo (the upload itself goes through /api/admin/uploads)
// ---------------------------------------------------------------------------

export async function removeBusinessLogo(businessId: string): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const parsed = idSchema.safeParse(businessId);
  if (!parsed.success) return failed("This business could not be identified. Reload the page and try again.");
  const id = parsed.data;

  const current = await supabase.from("businesses").select("logo_path").eq("id", id).maybeSingle();
  if (current.error) {
    return failed(dataFailureMessage("logo: lookup failed", current.error, "The business could not be loaded. Please try again."));
  }
  if (!current.data) return failed("This business no longer exists.");
  const path = current.data.logo_path;
  if (!path) {
    revalidateBusinesses();
    return done("This venue has no logo to remove.");
  }

  const cleared = await supabase
    .from("businesses")
    .update({ logo_path: null })
    .eq("id", id)
    .eq("logo_path", path)
    .select("id")
    .maybeSingle();
  if (cleared.error) {
    console.error("[admin/businesses] logo: clear failed", cleared.error);
    return failed(describeDbError(cleared.error, "The logo could not be removed. Please try again."));
  }
  if (!cleared.data) {
    revalidateBusinesses();
    return failed("The logo changed while you were removing it. Check the new logo and try again if needed.");
  }

  // The venue no longer points at the file, so it is unused: delete it (secret-key client).
  let fileRemoved = false;
  try {
    await connection();
    const { error } = await createSupabaseAdminClient().storage.from("logos").remove([path]);
    if (error) throw error;
    fileRemoved = true;
  } catch (error) {
    console.error(`[admin/businesses] logo: could not delete logos/${path}`, error);
  }

  revalidateBusinesses();
  return done(
    fileRemoved
      ? "Logo removed. The venue’s player shows its initials instead."
      : "Logo removed from the venue. The old image file could not be deleted from storage; it is private and no longer used.",
  );
}

// ---------------------------------------------------------------------------
// Members: invitations, links, password resets, removal
// ---------------------------------------------------------------------------

function toMemberAccessState(result: MemberAccessResult, values?: { email: string }): MemberAccessState {
  if (result.ok) return { ok: true, message: result.message, fieldErrors: {}, link: result.link, nonce: Date.now() };
  return {
    ok: false,
    message: result.message,
    fieldErrors: result.field ? { [result.field]: result.message } : {},
    values,
    link: null,
    nonce: Date.now(),
  };
}

function memberFailure(message: string, values?: { email: string }, fieldErrors: Record<string, string> = {}): MemberAccessState {
  return { ok: false, message, fieldErrors, values, link: null, nonce: Date.now() };
}

/** "Invite staff" form: `delivery` comes from the pressed button ("email" or "link"). */
export async function inviteMember(_previous: MemberAccessState, formData: FormData): Promise<MemberAccessState> {
  const { ctx, supabase } = await requireAdminAction();
  const emailValue = formData.get("email");
  const values = { email: typeof emailValue === "string" ? emailValue : "" };

  const parsed = inviteUserSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return memberFailure(summarizeValidationError(parsed.error), values, toFieldErrors(parsed.error));
  }

  const limited = await checkInviteRateLimit(ctx.userId);
  if (limited) return memberFailure(limited, values);

  const deps = await memberAccessDeps(supabase);
  if (!deps.ok) return memberFailure(deps.message, values);

  let result: MemberAccessResult;
  try {
    result = await inviteMemberToBusiness(deps.deps, parsed.data);
  } catch (error) {
    return memberFailure(dataFailureMessage("invite failed", error, "The invitation could not be completed. Please try again."), values);
  }
  revalidateBusinesses();
  return toMemberAccessState(result, values);
}

/**
 * Staff list: send an email (invitation until accepted, then a password reset) or create the
 * matching one-time link. The server decides which from the account's real state.
 */
export async function sendMemberAccess(businessId: string, userId: string, delivery: "email" | "link"): Promise<MemberAccessState> {
  const { ctx, supabase } = await requireAdminAction();
  const parsed = memberAccessSchema.safeParse({ businessId, userId, delivery });
  if (!parsed.success) return memberFailure(summarizeValidationError(parsed.error));

  const limited = await checkInviteRateLimit(ctx.userId);
  if (limited) return memberFailure(limited);

  const deps = await memberAccessDeps(supabase);
  if (!deps.ok) return memberFailure(deps.message);

  let result: MemberAccessResult;
  try {
    result = await sendAccessToMember(deps.deps, parsed.data);
  } catch (error) {
    return memberFailure(dataFailureMessage("member access failed", error, "That could not be completed. Please try again."));
  }
  revalidateBusinesses();
  return toMemberAccessState(result);
}

/** Most staff accounts reached by one "Send password reset" of a venue ("use server" files export only functions). */
const MAX_RESET_RECIPIENTS = 10;

/**
 * "Send password reset" for a venue: emails every staff account the right thing for its state (a
 * password reset once the invitation was accepted, the invitation again before that). Passwords are
 * never seen or set by the admin.
 */
export async function sendBusinessPasswordReset(businessId: string): Promise<ActionState> {
  const { ctx, supabase } = await requireAdminAction();
  const parsed = idSchema.safeParse(businessId);
  if (!parsed.success) return failed("This business could not be identified. Reload the page and try again.");
  const id = parsed.data;

  const [business, members] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", id).maybeSingle(),
    supabase
      .from("business_members")
      .select("user_id")
      .eq("business_id", id)
      .order("created_at", { ascending: true })
      .limit(MAX_RESET_RECIPIENTS),
  ]);
  const loadError = business.error ?? members.error;
  if (loadError) return failed(dataFailureMessage("reset: lookup failed", loadError, "The venue could not be loaded. Nothing was sent."));
  if (!business.data) return failed("This business no longer exists.");
  const userIds = (members.data ?? []).map((member) => member.user_id);
  if (userIds.length === 0) {
    return failed(`${business.data.name} has no staff account yet, so there is nobody to send a reset to. Invite the contact from the Access tab.`);
  }

  const limited = await checkInviteRateLimit(ctx.userId);
  if (limited) return failed(limited);
  const deps = await memberAccessDeps(supabase);
  if (!deps.ok) return failed(deps.message);

  const outcomes: MemberAccessResult[] = [];
  for (const userId of userIds) {
    try {
      outcomes.push(await sendAccessToMember(deps.deps, { businessId: id, userId, delivery: "email" }));
    } catch (error) {
      outcomes.push({ ok: false, message: dataFailureMessage("reset failed", error, "One email could not be sent. Please try again.") });
    }
  }
  revalidateBusinesses();
  const message = outcomes.map((outcome) => outcome.message).join(" ");
  return outcomes.every((outcome) => outcome.ok) ? done(message) : failed(message);
}

/** Removes the membership only; the Supabase Auth account is kept. */
export async function removeMember(businessId: string, userId: string): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const parsed = memberRefSchema.safeParse({ businessId, userId });
  if (!parsed.success) return failed(summarizeValidationError(parsed.error));

  const profile = await supabase.from("profiles").select("email").eq("id", parsed.data.userId).maybeSingle();
  const who = profile.data?.email || "The account";

  const { data, error } = await supabase
    .from("business_members")
    .delete()
    .eq("business_id", parsed.data.businessId)
    .eq("user_id", parsed.data.userId)
    .select("user_id");
  if (error) {
    console.error("[admin/businesses] remove member failed", error);
    return failed(describeDbError(error, "The account could not be removed from the venue. Please try again."));
  }

  revalidateBusinesses();
  if (!data || data.length === 0) return done(`${who} was already not a member of this venue.`);
  return done(`${who} was removed from the venue. Their account still exists, so you can invite them again later.`);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Deletes a business: deactivates it (players stop cleanly), deletes its logo and announcement files
 * from Storage, then deletes the row (members, genre access and announcements cascade). Staff
 * accounts are not deleted. On a partial failure nothing further happens and the admin can retry.
 */
export async function deleteBusiness(businessId: string, confirmation: string): Promise<ActionState> {
  const { supabase } = await requireAdminAction();
  const parsed = deleteBusinessSchema.safeParse({ businessId, confirmation });
  if (!parsed.success) return failed(summarizeValidationError(parsed.error));
  const id = parsed.data.businessId;

  let known: Awaited<ReturnType<typeof loadKnownBusinessStoragePaths>>;
  try {
    known = await loadKnownBusinessStoragePaths(supabase, id);
  } catch (error) {
    return failed(dataFailureMessage("delete: lookup failed", error, "The business could not be loaded. Nothing was deleted."));
  }
  if (!known.business) return failed("This business no longer exists. Go back to the list of businesses.");
  if (!deleteConfirmationMatches(known.business.name, parsed.data.confirmation)) {
    return failed(`Type the business name exactly (“${known.business.name}”) to confirm. Nothing was deleted.`);
  }

  await connection();
  let admin: TypedSupabaseClient;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    return failed("Deleting a business also deletes its files, which needs SUPABASE_SECRET_KEY on the server. Nothing was deleted.");
  }

  if (known.business.isActive) {
    const { error } = await supabase.from("businesses").update({ is_active: false }).eq("id", id);
    if (error) {
      console.error("[admin/businesses] delete: deactivate failed", error);
      return failed(describeDbError(error, "The business could not be deactivated before deleting it. Nothing was deleted."));
    }
  }

  try {
    const paths = await collectBusinessStoragePaths(admin, id, known.paths);
    await removeBusinessStorage(admin, paths);
  } catch (error) {
    console.error("[admin/businesses] delete: storage cleanup failed", error);
    revalidateBusinesses();
    return failed(
      "The venue’s files could not all be deleted from storage, so the business was not deleted" +
        `${known.business.isActive ? " (it has been deactivated)" : ""}. Try again in a moment.`,
    );
  }

  const partialFailure =
    "The venue’s files were deleted and it is inactive, but the business itself could not be deleted. Try again.";
  const { data: deleted, error } = await supabase.from("businesses").delete().eq("id", id).select("id");
  if (error) {
    console.error("[admin/businesses] delete: row delete failed", error);
    revalidateBusinesses({ announcements: true });
    return failed(describeDbError(error, partialFailure));
  }
  if (!deleted || deleted.length === 0) {
    // Nothing deleted: either it is already gone (fine) or the delete was not permitted.
    const stillThere = await supabase.from("businesses").select("id").eq("id", id).maybeSingle();
    if (stillThere.error || stillThere.data) {
      console.error("[admin/businesses] delete: row still present after delete", stillThere.error);
      revalidateBusinesses({ announcements: true });
      return failed(partialFailure);
    }
  }

  revalidateBusinesses({ announcements: true });
  return done(
    `${known.business.name} was deleted with its announcements, logo, genre access and staff memberships. Staff accounts still exist and can be invited to another venue.`,
  );
}
