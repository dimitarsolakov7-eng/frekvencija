"use server";

import { revalidatePath } from "next/cache";
import type { StudioActionState } from "@/components/admin/announcements/studio-model";
import { actionError, type ActionState } from "@/lib/actions/state";
import { requireAdminAction } from "@/lib/auth/session";
import {
  activateAnnouncement,
  approveAnnouncement,
  createAnnouncement,
  createAnnouncementMutationDeps,
  deactivateAnnouncement,
  deleteAnnouncement,
  duplicateAnnouncement,
  markGenerationFailed,
  updateAnnouncementWording,
  updatePlaybackSettings,
  type AnnouncementMutationDeps,
  type MutationOutcome,
} from "@/lib/data/admin/announcements";

/**
 * Server Actions for /admin/announcements (screen 07). Every action authenticates the admin first
 * (requireAdminAction redirects otherwise), validates its input inside the mutation and writes with
 * the admin's own Supabase client, so RLS applies. Ids arrive from the page and are validated there;
 * action endpoints are public, so a forged call may send anything.
 */

async function adminDeps(): Promise<AnnouncementMutationDeps> {
  const { ctx, supabase } = await requireAdminAction();
  return createAnnouncementMutationDeps(ctx.userId, supabase);
}

const INVALID_FORM = actionError("The form could not be read. Reload the page and try again.");

function finish(outcome: MutationOutcome): StudioActionState {
  if (outcome.businessId) {
    revalidatePath("/admin/announcements");
    // The venue pages summarise announcement counts and settings.
    revalidatePath(`/admin/businesses/${outcome.businessId}`);
    revalidatePath("/admin/businesses");
  }
  return outcome.announcementId ? { ...outcome.state, announcementId: outcome.announcementId } : outcome.state;
}

function versionOf(version: unknown): string | null {
  return typeof version === "string" ? version : null;
}

/** Announcement settings: announcementEveryNTracks (1–50), announcementVolumePercent (10–100). */
export async function updateAnnouncementSettingsAction(businessId: string, _previous: ActionState, formData: FormData): Promise<ActionState> {
  const deps = await adminDeps();
  if (!(formData instanceof FormData)) return INVALID_FORM;
  return finish(await updatePlaybackSettings(deps, businessId, formData));
}

/**
 * New draft for the venue (fields: mode "template" | "custom", templateKey, customText, placement,
 * language, spokenText). Returns the draft's id so the editor can generate or upload its audio.
 */
export async function createAnnouncementDraftAction(businessId: string, formData: FormData): Promise<StudioActionState> {
  const deps = await adminDeps();
  if (!(formData instanceof FormData)) return INVALID_FORM;
  return finish(await createAnnouncement(deps, businessId, formData));
}

/** Saves the editor's wording to an existing recording (fields: text, spokenText, placement, language). */
export async function updateAnnouncementWordingAction(announcementId: string, formData: FormData): Promise<ActionState> {
  const deps = await adminDeps();
  if (!(formData instanceof FormData)) return INVALID_FORM;
  return finish(await updateAnnouncementWording(deps, announcementId, formData));
}

/** Approve & activate (also re-approval after a branding change). `version` is the `updatedAt` the admin reviewed. */
export async function approveAnnouncementAction(announcementId: string, version: string | null): Promise<ActionState> {
  const deps = await adminDeps();
  return finish(await approveAnnouncement(deps, announcementId, versionOf(version)));
}

/** Puts previously approved, switched-off audio back on air. */
export async function activateAnnouncementAction(announcementId: string, version: string | null): Promise<ActionState> {
  const deps = await adminDeps();
  return finish(await activateAnnouncement(deps, announcementId, versionOf(version)));
}

export async function deactivateAnnouncementAction(announcementId: string): Promise<ActionState> {
  const deps = await adminDeps();
  return finish(await deactivateAnnouncement(deps, announcementId));
}

/** Copies the wording, placement, language and voice into a new draft; returns the copy's id. */
export async function duplicateAnnouncementAction(announcementId: string): Promise<StudioActionState> {
  const deps = await adminDeps();
  return finish(await duplicateAnnouncement(deps, announcementId));
}

export async function deleteAnnouncementAction(announcementId: string): Promise<ActionState> {
  const deps = await adminDeps();
  return finish(await deleteAnnouncement(deps, announcementId));
}

/** Releases a stalled generation lock (> 3 minutes old). */
export async function markAnnouncementFailedAction(announcementId: string): Promise<ActionState> {
  const deps = await adminDeps();
  return finish(await markGenerationFailed(deps, announcementId));
}
