/**
 * Uploading a recording from the announcements studio (screen 07). The order of the steps is the
 * point (review finding ANN-01):
 *
 * - An existing recording keeps its wording and its audio until the new file has passed the server's
 *   checks and the row points at it: the upload-complete route validates first and removes the
 *   previous audio only after the update, so a rejected or cancelled upload changes nothing, and an
 *   approved recording is never taken off air by a failed upload.
 * - Wording edits are saved only after that. By then the recording's audio is the uploaded file,
 *   which a wording edit keeps (statusAfterWordingEdit); saved first, a changed wording would discard
 *   generated audio before the upload could still fail.
 * - A new announcement is created first, because the upload needs its row.
 *
 * Pure orchestration over injected steps, so the order is unit-tested.
 */
import type { ActionState } from "@/lib/actions/state";

export interface RecordingUploadSteps {
  /** The recording the editor saves to, or null for a new announcement. */
  existingId: string | null;
  /** Creates the new announcement's draft; its id, or null when that failed (already reported). */
  createDraft: () => Promise<string | null>;
  /** Signed upload, then the server's validation and attach. Throws UploadError (also when cancelled). */
  upload: (announcementId: string) => Promise<void>;
  /** Saves the editor's wording to the existing recording: null when it already had it. Must not throw. */
  saveWording: (announcementId: string) => Promise<ActionState | null>;
}

export type RecordingUploadOutcome =
  /** The draft for a new announcement could not be created; nothing was uploaded. */
  | { kind: "not-started" }
  /** The file is attached. `wording` is the result of saving wording edits afterwards (null: none). */
  | { kind: "uploaded"; announcementId: string; wording: ActionState | null };

export async function runRecordingUpload(steps: RecordingUploadSteps): Promise<RecordingUploadOutcome> {
  const announcementId = steps.existingId ?? (await steps.createDraft());
  if (!announcementId) return { kind: "not-started" };
  await steps.upload(announcementId);
  const wording = steps.existingId ? await steps.saveWording(steps.existingId) : null;
  return { kind: "uploaded", announcementId, wording };
}
