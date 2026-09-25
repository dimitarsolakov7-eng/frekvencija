import "server-only";
import { z } from "zod";
import { actionError, actionSuccess, describeDbError, type ActionState } from "@/lib/actions/state";
import {
  CLEARED_AUDIO_FIELDS,
  checkActivate,
  checkApprove,
  checkDeactivate,
  checkEditWording,
  isGenerationInProgress,
  isGenerationStale,
  statusAfterWordingEdit,
  toAnnouncementState,
} from "@/lib/announcements/state";
import {
  getAnnouncementTemplate,
  renderAnnouncementWording,
  TemplateError,
  validateTemplateText,
  type BrandingNames,
} from "@/lib/announcements/templates";
import { removeStorageObjects } from "@/lib/data/admin/uploads";
import { toAdminAnnouncement } from "@/lib/data/mappers";
import { EnvError } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { announcementCreateSchema, announcementUpdateSchema } from "@/lib/validation/announcements";
import { businessUpdateSchema } from "@/lib/validation/businesses";
import { formInteger, idSchema } from "@/lib/validation/fields";
import { formDataToObject, toFieldErrors, type FieldErrors } from "@/lib/validation/forms";
import type { Tables, TablesInsert, TablesUpdate } from "@/types/database";
import {
  generationFailureStatus,
  MAX_VOLUME_PERCENT,
  MIN_VOLUME_PERCENT,
  withEffectiveReview,
  type AnnouncementBusiness,
  type AnnouncementItem,
} from "@/components/admin/announcements/rules";

/**
 * Server-side data access for /admin/announcements (screen 07): the page loaders and the mutations
 * behind its Server Actions. Everything goes through the ADMIN'S OWN Supabase client (RLS
 * admin policies); the secret-key client is only used to delete Storage objects that no row
 * references any more.
 *
 * Mutations are written as plain functions (deps in, ActionState out) so they can be unit-tested;
 * the Server Actions add authentication and cache revalidation around them.
 */

type AnnouncementRow = Tables<"announcements">;

const BUSINESS_COLUMNS =
  "id, name, station_name, name_pronunciation, station_name_pronunciation, announcement_language, is_active, announcement_every_n_tracks, announcement_volume, branding_version";

type BusinessRow = Pick<
  Tables<"businesses">,
  | "id"
  | "name"
  | "station_name"
  | "name_pronunciation"
  | "station_name_pronunciation"
  | "announcement_language"
  | "is_active"
  | "announcement_every_n_tracks"
  | "announcement_volume"
  | "branding_version"
>;

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export function toAnnouncementBusiness(row: BusinessRow): AnnouncementBusiness {
  return {
    id: row.id,
    name: row.name,
    stationName: row.station_name,
    namePronunciation: row.name_pronunciation,
    stationNamePronunciation: row.station_name_pronunciation,
    language: row.announcement_language,
    isActive: row.is_active,
    everyNTracks: row.announcement_every_n_tracks,
    volume: Number(row.announcement_volume),
    brandingVersion: row.branding_version,
  };
}

export function toAnnouncementItem(row: AnnouncementRow, approvedByEmail: string | null = null): AnnouncementItem {
  return {
    ...toAdminAnnouncement(row),
    brandingVersion: row.branding_version,
    generationAttempts: row.generation_attempts,
    audioSizeBytes: row.audio_size_bytes === null ? null : Number(row.audio_size_bytes),
    approvedByEmail,
  };
}

function brandingNames(business: Pick<BusinessRow, "name" | "station_name" | "name_pronunciation" | "station_name_pronunciation">): BrandingNames {
  return {
    name: business.name,
    stationName: business.station_name,
    namePronunciation: business.name_pronunciation,
    stationNamePronunciation: business.station_name_pronunciation,
  };
}

// ---------------------------------------------------------------------------
// Page loader
// ---------------------------------------------------------------------------

export interface AnnouncementsPageData {
  business: AnnouncementBusiness;
  /** Oldest first, so cards keep their place when their status changes. */
  announcements: AnnouncementItem[];
  /** Server clock (epoch ms) at load time: pass it to client components for lock-staleness checks. */
  now: number;
  /** Voice most recently used for this venue, suggested as the default in the generate dialog. */
  suggestedVoiceId: string | null;
}

/** Thrown when the page data cannot be read (shown by the error boundary; details are logged). */
export class AnnouncementsDataError extends Error {
  constructor(context: string, cause: unknown) {
    super(`Could not load announcements data (${context}).`, { cause });
    this.name = "AnnouncementsDataError";
  }
}

/** A venue in the announcements page's venue selector. */
export interface AnnouncementVenueOption {
  id: string;
  name: string;
  stationName: string;
  isActive: boolean;
}

/** Every venue, by name, for the venue selector (admin's own client; RLS admin policy). */
export async function loadAnnouncementVenues(supabase: TypedSupabaseClient): Promise<AnnouncementVenueOption[]> {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, name, station_name, is_active")
    .order("name", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new AnnouncementsDataError("venues", error);
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, stationName: row.station_name, isActive: row.is_active }));
}

/** Loads the venue and its announcements with the admin's client, or null when the venue does not exist. */
export async function loadAnnouncementsPage(supabase: TypedSupabaseClient, businessId: string): Promise<AnnouncementsPageData | null> {
  const [businessResult, announcementsResult] = await Promise.all([
    supabase.from("businesses").select(BUSINESS_COLUMNS).eq("id", businessId).maybeSingle(),
    supabase.from("announcements").select("*").eq("business_id", businessId).order("created_at", { ascending: true }).order("id"),
  ]);
  if (businessResult.error) throw new AnnouncementsDataError("business", businessResult.error);
  if (!businessResult.data) return null;
  if (announcementsResult.error) throw new AnnouncementsDataError("announcements", announcementsResult.error);
  const rows = announcementsResult.data ?? [];

  const approverIds = [...new Set(rows.map((row) => row.approved_by).filter((id): id is string => id !== null))];
  const approverEmails = new Map<string, string>();
  if (approverIds.length > 0) {
    const approvers = await supabase.from("profiles").select("id, email").in("id", approverIds);
    // Only a nicety: without it the page still shows when the audio was approved.
    if (approvers.error) console.error("[announcements] could not load approver emails", approvers.error);
    for (const profile of approvers.data ?? []) approverEmails.set(profile.id, profile.email);
  }

  const suggested = [...rows]
    .filter((row) => row.source === "tts" && row.voice_id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  return {
    business: toAnnouncementBusiness(businessResult.data),
    announcements: rows.map((row) => toAnnouncementItem(row, row.approved_by ? (approverEmails.get(row.approved_by) ?? null) : null)),
    now: Date.now(),
    suggestedVoiceId: suggested?.voice_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface AnnouncementMutationDeps {
  /** The admin's own client (RLS). */
  supabase: TypedSupabaseClient;
  userId: string;
  /** Secret-key client, created lazily and used only to remove Storage objects. */
  storageAdmin: () => TypedSupabaseClient;
  now: Date;
}

export interface MutationOutcome {
  state: ActionState;
  /** Venue whose pages must be revalidated; null when nothing was written. */
  businessId: string | null;
  /** Row created by the mutation (create and duplicate), so the editor can continue with it. */
  announcementId?: string;
}

export function createAnnouncementMutationDeps(userId: string, supabase: TypedSupabaseClient): AnnouncementMutationDeps {
  return { supabase, userId, storageAdmin: createSupabaseAdminClient, now: new Date() };
}

const NOT_FOUND = "This announcement no longer exists. Refresh the page.";
const VENUE_NOT_FOUND = "This venue no longer exists.";
const CHANGED_MEANWHILE = "This announcement changed in the meantime (for example, new audio was attached). Refresh the page and try again.";
export const STALLED_GENERATION_MESSAGE =
  "Generating the audio did not finish: the request was interrupted before ElevenLabs answered. Try again.";

const failed = (message: string, fieldErrors: FieldErrors = {}, values?: Record<string, string>): MutationOutcome => ({
  state: actionError(message, fieldErrors, values),
  businessId: null,
});
const done = (businessId: string, message: string): MutationOutcome => ({ state: actionSuccess(message), businessId });

function text(raw: Record<string, FormDataEntryValue | FormDataEntryValue[]>, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value : "";
}

async function loadRow(deps: AnnouncementMutationDeps, id: string): Promise<{ row: AnnouncementRow } | { outcome: MutationOutcome }> {
  if (!idSchema.safeParse(id).success) return { outcome: failed(NOT_FOUND) };
  const { data, error } = await deps.supabase.from("announcements").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("[announcements] lookup failed", error);
    return { outcome: failed(describeDbError(error)) };
  }
  return data ? { row: data } : { outcome: failed(NOT_FOUND) };
}

async function loadBusiness(deps: AnnouncementMutationDeps, id: string): Promise<{ business: BusinessRow } | { outcome: MutationOutcome }> {
  if (!idSchema.safeParse(id).success) return { outcome: failed(VENUE_NOT_FOUND) };
  const { data, error } = await deps.supabase.from("businesses").select(BUSINESS_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[announcements] venue lookup failed", error);
    return { outcome: failed(describeDbError(error)) };
  }
  return data ? { business: data } : { outcome: failed(VENUE_NOT_FOUND) };
}

/** Removes audio that no row references any more. Best effort: a failure only leaves an orphan (logged). */
async function removeAudioObject(deps: AnnouncementMutationDeps, path: string | null, context: string): Promise<void> {
  if (!path) return;
  try {
    await removeStorageObjects(deps.storageAdmin(), "announcements", [path], `announcements: ${context}`);
  } catch (error) {
    const reason = error instanceof EnvError ? "the secret key is not configured" : "unexpected error";
    console.error(`[announcements] ${context}: could not remove announcements/${path} (${reason})`, error);
  }
}

// Playback settings -----------------------------------------------------------

const playbackSettingsFormSchema = z.object({
  announcementEveryNTracks: formInteger("Announcement interval", 1, 50),
  announcementVolumePercent: formInteger("Announcement volume", MIN_VOLUME_PERCENT, MAX_VOLUME_PERCENT),
});

/** Saves announcement_every_n_tracks (1–50) and announcement_volume (10–100 % ⇒ 0.10–1.00). */
export async function updatePlaybackSettings(deps: AnnouncementMutationDeps, businessId: string, formData: FormData): Promise<MutationOutcome> {
  const raw = formDataToObject(formData);
  const values = {
    announcementEveryNTracks: text(raw, "announcementEveryNTracks"),
    announcementVolumePercent: text(raw, "announcementVolumePercent"),
  };
  if (!idSchema.safeParse(businessId).success) return failed(VENUE_NOT_FOUND, {}, values);

  const form = playbackSettingsFormSchema.safeParse(values);
  if (!form.success) return failed("Check the highlighted settings.", toFieldErrors(form.error), values);
  const settings = businessUpdateSchema.safeParse({
    announcementEveryNTracks: form.data.announcementEveryNTracks,
    announcementVolume: form.data.announcementVolumePercent / 100,
  });
  if (!settings.success) {
    const { announcementVolume, ...errors } = toFieldErrors(settings.error);
    const fieldErrors = announcementVolume ? { ...errors, announcementVolumePercent: announcementVolume } : errors;
    return failed("Check the highlighted settings.", fieldErrors, values);
  }

  const patch: TablesUpdate<"businesses"> = {
    announcement_every_n_tracks: settings.data.announcementEveryNTracks,
    announcement_volume: settings.data.announcementVolume,
  };
  const { data, error } = await deps.supabase.from("businesses").update(patch).eq("id", businessId).select("id").maybeSingle();
  if (error) {
    console.error("[announcements] playback settings update failed", error);
    return failed(describeDbError(error), {}, values);
  }
  if (!data) return failed(VENUE_NOT_FOUND, {}, values);
  return done(businessId, "Playback settings saved.");
}

// Create ------------------------------------------------------------------------

/**
 * Creates a draft from a template or custom wording. The display and spoken wording are rendered
 * here from the venue's CURRENT branding (the browser preview is only a preview).
 * Form fields: mode ("template" | "custom"), templateKey, customText, placement, language, spokenText.
 */
export async function createAnnouncement(deps: AnnouncementMutationDeps, businessId: string, formData: FormData): Promise<MutationOutcome> {
  const raw = formDataToObject(formData);
  const values = {
    mode: text(raw, "mode") === "custom" ? "custom" : "template",
    templateKey: text(raw, "templateKey"),
    customText: text(raw, "customText"),
    placement: text(raw, "placement"),
    language: text(raw, "language"),
    spokenText: text(raw, "spokenText"),
  };

  const loaded = await loadBusiness(deps, businessId);
  if ("outcome" in loaded) return { ...loaded.outcome, state: { ...loaded.outcome.state, values } };
  const { business } = loaded;

  const sourceField = values.mode === "custom" ? "customText" : "templateKey";
  let source: string;
  if (values.mode === "custom") {
    const check = validateTemplateText(values.customText);
    if (!check.ok) return failed(check.reason, { customText: check.reason }, values);
    source = values.customText;
  } else {
    const template = getAnnouncementTemplate(values.templateKey);
    if (!template) return failed("Choose a template.", { templateKey: "Choose a template." }, values);
    source = template.text;
  }

  let wording: { text: string; spokenText: string | null };
  try {
    wording = renderAnnouncementWording(source, brandingNames(business));
  } catch (error) {
    const message = error instanceof TemplateError ? error.message : "The wording could not be rendered.";
    return failed(message, { [sourceField]: message }, values);
  }
  // A spoken-wording override wins; one identical to the display text means "speak the text".
  const override = values.spokenText.trim();
  const spokenText = !override ? wording.spokenText : override === wording.text ? null : override;

  const parsed = announcementCreateSchema.safeParse({
    templateKey: values.mode === "template" ? values.templateKey : null,
    placement: values.placement || undefined,
    text: wording.text,
    spokenText,
    language: values.language.trim() || undefined,
  });
  if (!parsed.success) {
    const errors = toFieldErrors(parsed.error);
    // The stored text is derived from the chosen source, so report its errors there.
    if (errors.text) errors[sourceField] = errors.text;
    return failed("Check the highlighted fields.", errors, values);
  }

  const insert: TablesInsert<"announcements"> = {
    business_id: business.id,
    template_key: parsed.data.templateKey,
    placement: parsed.data.placement,
    text: parsed.data.text,
    spoken_text: parsed.data.spokenText,
    language: parsed.data.language ?? business.announcement_language,
    status: "draft",
    branding_version: business.branding_version,
    created_by: deps.userId,
  };
  const { data: created, error } = await deps.supabase.from("announcements").insert(insert).select("id").single();
  if (error) {
    console.error("[announcements] create failed", error);
    return failed(describeDbError(error), {}, values);
  }
  return {
    ...done(business.id, "Announcement created. Generate its audio with AI or upload an MP3, then approve it."),
    announcementId: created.id,
  };
}

// Edit wording ------------------------------------------------------------------

const PLACEHOLDER_IN_EDIT = "Write the names out here. Use “Use current venue names” to fill them in from the venue's details.";

/**
 * Updates text, spoken wording, placement and language. Fields the form does not send are left
 * unchanged (announcementUpdateSchema): a save without `spokenText` keeps the stored spoken wording,
 * such as a respelling for the voice, and therefore the audio generated from it. Generated audio
 * whose spoken input changed is discarded (⇒ draft) and its object removed; uploaded audio is kept
 * (statusAfterWordingEdit).
 */
export async function updateAnnouncementWording(deps: AnnouncementMutationDeps, announcementId: string, formData: FormData): Promise<MutationOutcome> {
  const raw = formDataToObject(formData);
  // Echoed back as typed; "" for fields that were not sent.
  const values = {
    text: text(raw, "text"),
    spokenText: text(raw, "spokenText"),
    placement: text(raw, "placement"),
    language: text(raw, "language"),
  };
  // Only the fields present in the form are validated and written; the others stay undefined.
  const sent = (key: keyof typeof values): string | undefined => (key in raw ? values[key] : undefined);

  const parsed = announcementUpdateSchema.safeParse({
    text: sent("text"),
    spokenText: sent("spokenText"),
    placement: sent("placement"),
    language: sent("language"),
  });
  if (!parsed.success) return failed("Check the highlighted fields.", toFieldErrors(parsed.error), values);
  const input = parsed.data;
  const braces: FieldErrors = {};
  if (input.text !== undefined && /[{}]/.test(input.text)) braces.text = PLACEHOLDER_IN_EDIT;
  if (input.spokenText && /[{}]/.test(input.spokenText)) braces.spokenText = PLACEHOLDER_IN_EDIT;
  if (Object.keys(braces).length > 0) return failed("Check the highlighted fields.", braces, values);

  const loaded = await loadRow(deps, announcementId);
  if ("outcome" in loaded) return { ...loaded.outcome, state: { ...loaded.outcome.state, values } };
  const { row } = loaded;
  const state = toAnnouncementState(row);

  const gate = checkEditWording(state, deps.now);
  if (!gate.ok) return failed(gate.reason, {}, values);

  const next = {
    text: input.text ?? row.text,
    spokenText: input.spokenText === undefined ? row.spoken_text : input.spokenText,
    placement: input.placement ?? row.placement,
    language: input.language ?? row.language,
  };
  if (
    next.text === row.text &&
    next.spokenText === row.spoken_text &&
    next.placement === row.placement &&
    next.language === row.language
  ) {
    return { state: actionSuccess("Nothing changed."), businessId: null };
  }

  const outcome = statusAfterWordingEdit(state, { text: next.text, spokenText: next.spokenText, language: next.language });
  const reviewResolved = row.needs_review && (outcome.audioInvalidated || row.audio_path === null);
  const patch: TablesUpdate<"announcements"> = {
    text: next.text,
    spoken_text: next.spokenText,
    placement: next.placement,
    language: next.language,
    status: outcome.status,
    ...(outcome.audioInvalidated ? CLEARED_AUDIO_FIELDS : {}),
    ...(outcome.clearLastError ? { last_error: null } : {}),
    ...(row.status === "generating" && outcome.status !== "generating" ? { generation_started_at: null } : {}),
    // No audio left to review: the flag only asked for the old recording to be checked.
    ...(reviewResolved ? { needs_review: false, review_reason: null } : {}),
  };

  // Guarded on what the rules were evaluated against (a generation starting meanwhile bumps attempts).
  let update = deps.supabase
    .from("announcements")
    .update(patch)
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("generation_attempts", row.generation_attempts);
  update = row.audio_path === null ? update.is("audio_path", null) : update.eq("audio_path", row.audio_path);
  const { data, error } = await update.select("id").maybeSingle();
  if (error) {
    console.error("[announcements] wording update failed", error);
    return failed(describeDbError(error), {}, values);
  }
  if (!data) return failed(CHANGED_MEANWHILE, {}, values);

  if (outcome.audioInvalidated) await removeAudioObject(deps, row.audio_path, "wording edit discarded generated audio");
  return done(row.business_id, outcome.message ?? "Announcement updated.");
}

// Approve / activate / deactivate ----------------------------------------------------

async function loadWithBusiness(
  deps: AnnouncementMutationDeps,
  announcementId: string,
): Promise<{ row: AnnouncementRow; business: BusinessRow; item: AnnouncementItem } | { outcome: MutationOutcome }> {
  const loaded = await loadRow(deps, announcementId);
  if ("outcome" in loaded) return loaded;
  const venue = await loadBusiness(deps, loaded.row.business_id);
  if ("outcome" in venue) return venue;
  return { row: loaded.row, business: venue.business, item: toAnnouncementItem(loaded.row) };
}

const STALE_VERSION = "This announcement changed since the page was loaded. Listen to it again before approving.";

/**
 * Approve & activate: puts `ready` audio (or flagged active audio) on air and records who approved
 * it under the venue's current branding version. `version` is the `updatedAt` the admin saw, so the
 * audio approved is the audio that was reviewed.
 */
export async function approveAnnouncement(deps: AnnouncementMutationDeps, announcementId: string, version: string | null): Promise<MutationOutcome> {
  const loaded = await loadWithBusiness(deps, announcementId);
  if ("outcome" in loaded) return loaded.outcome;
  const { row, business, item } = loaded;
  if (version !== null && version !== row.updated_at) return failed(STALE_VERSION);

  const effective = withEffectiveReview(item, toAnnouncementBusiness(business));
  const gate = checkApprove(effective);
  if (!gate.ok) return failed(gate.reason);
  const audioPath = row.audio_path;
  if (audioPath === null) return failed("There is no audio to approve yet. Generate it or upload an MP3.");

  const patch: TablesUpdate<"announcements"> = {
    status: "active",
    needs_review: false,
    review_reason: null,
    approved_at: deps.now.toISOString(),
    approved_by: deps.userId,
    branding_version: business.branding_version,
    last_error: null,
  };
  const { data, error } = await deps.supabase
    .from("announcements")
    .update(patch)
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("audio_path", audioPath)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[announcements] approve failed", error);
    return failed(describeDbError(error));
  }
  if (!data) return failed(CHANGED_MEANWHILE);
  return done(
    row.business_id,
    business.is_active ? "Approved. It is on air now." : "Approved. It will play once the venue is activated.",
  );
}

/** Re-activates previously approved audio that was deactivated (no new approval needed). */
export async function activateAnnouncement(deps: AnnouncementMutationDeps, announcementId: string, version: string | null): Promise<MutationOutcome> {
  const loaded = await loadWithBusiness(deps, announcementId);
  if ("outcome" in loaded) return loaded.outcome;
  const { row, business, item } = loaded;
  if (version !== null && version !== row.updated_at) return failed(CHANGED_MEANWHILE);

  const gate = checkActivate(withEffectiveReview(item, toAnnouncementBusiness(business)));
  if (!gate.ok) return failed(gate.reason);
  const { audio_path: audioPath, approved_at: approvedAt } = row;
  if (audioPath === null || approvedAt === null) return failed("Approve this announcement first.");

  const { data, error } = await deps.supabase
    .from("announcements")
    .update({ status: "active" })
    .eq("id", row.id)
    .eq("status", "ready")
    .eq("audio_path", audioPath)
    .eq("approved_at", approvedAt)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[announcements] activate failed", error);
    return failed(describeDbError(error));
  }
  if (!data) return failed(CHANGED_MEANWHILE);
  return done(row.business_id, business.is_active ? "Activated. It is on air again." : "Activated. It will play once the venue is activated.");
}

/** Takes an active announcement off air (→ ready). Its approval is kept so it can be re-activated. */
export async function deactivateAnnouncement(deps: AnnouncementMutationDeps, announcementId: string): Promise<MutationOutcome> {
  const loaded = await loadRow(deps, announcementId);
  if ("outcome" in loaded) return loaded.outcome;
  const { row } = loaded;
  const gate = checkDeactivate(toAnnouncementState(row));
  if (!gate.ok) return failed(gate.reason);

  const { data, error } = await deps.supabase
    .from("announcements")
    .update({ status: "ready" })
    .eq("id", row.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[announcements] deactivate failed", error);
    return failed(describeDbError(error));
  }
  if (!data) return failed(CHANGED_MEANWHILE);
  return done(row.business_id, "Deactivated. It no longer plays; you can activate it again at any time.");
}

// Delete / duplicate / stalled generation ---------------------------------------------

/** Deletes the row, then its audio object (never the other way round, so a failed delete loses nothing). */
export async function deleteAnnouncement(deps: AnnouncementMutationDeps, announcementId: string): Promise<MutationOutcome> {
  const loaded = await loadRow(deps, announcementId);
  if ("outcome" in loaded) return loaded.outcome;
  const { row } = loaded;
  if (isGenerationInProgress(toAnnouncementState(row), deps.now)) {
    return failed("Audio is being generated for this announcement. Wait for it to finish, then delete it.");
  }

  const { data, error } = await deps.supabase.from("announcements").delete().eq("id", row.id).select("id").maybeSingle();
  if (error) {
    console.error("[announcements] delete failed", error);
    return failed(describeDbError(error));
  }
  if (!data) return failed(NOT_FOUND);

  // The row is gone, so the audio it pointed at is no longer referenced.
  await removeAudioObject(deps, row.audio_path, "deleted announcement");
  return done(row.business_id, "Announcement deleted.");
}

/**
 * Copies wording, placement, language and the voice/model suggestion into a new draft (no audio).
 * This is how an on-air announcement gets new audio without going off air.
 */
export async function duplicateAnnouncement(deps: AnnouncementMutationDeps, announcementId: string): Promise<MutationOutcome> {
  const loaded = await loadWithBusiness(deps, announcementId);
  if ("outcome" in loaded) return loaded.outcome;
  const { row, business } = loaded;

  const insert: TablesInsert<"announcements"> = {
    business_id: row.business_id,
    template_key: row.template_key,
    placement: row.placement,
    text: row.text,
    spoken_text: row.spoken_text,
    language: row.language,
    status: "draft",
    voice_id: row.voice_id,
    voice_name: row.voice_name,
    model_id: row.model_id,
    branding_version: business.branding_version,
    created_by: deps.userId,
  };
  const { data: copy, error } = await deps.supabase.from("announcements").insert(insert).select("id").single();
  if (error) {
    console.error("[announcements] duplicate failed", error);
    return failed(describeDbError(error));
  }
  return {
    ...done(
      row.business_id,
      row.status === "active"
        ? "Copy created as a draft. Give it audio and approve it, then deactivate the original. The original keeps playing meanwhile."
        : "Copy created as a draft.",
    ),
    announcementId: copy.id,
  };
}

/** Releases a stalled (> 3 min) generation lock so the admin can retry or upload instead. */
export async function markGenerationFailed(deps: AnnouncementMutationDeps, announcementId: string): Promise<MutationOutcome> {
  const loaded = await loadRow(deps, announcementId);
  if ("outcome" in loaded) return loaded.outcome;
  const { row } = loaded;
  if (!isGenerationStale(toAnnouncementState(row), deps.now)) {
    return failed(
      row.status === "generating"
        ? "The audio is still being generated (this can take up to 3 minutes). Wait a moment and refresh."
        : "This announcement is not generating audio.",
    );
  }

  const patch: TablesUpdate<"announcements"> = {
    status: generationFailureStatus("generating", row.audio_path !== null),
    generation_started_at: null,
    last_error: STALLED_GENERATION_MESSAGE,
  };
  let update = deps.supabase.from("announcements").update(patch).eq("id", row.id).eq("status", "generating");
  update =
    row.generation_started_at === null
      ? update.is("generation_started_at", null)
      : update.eq("generation_started_at", row.generation_started_at);
  const { data, error } = await update.select("id").maybeSingle();
  if (error) {
    console.error("[announcements] releasing a stalled generation failed", error);
    return failed(describeDbError(error));
  }
  if (!data) return failed(CHANGED_MEANWHILE);
  return done(row.business_id, "Marked as failed. Generate the audio again or upload an MP3.");
}
