/**
 * The access-request list as data (review findings REQ-01 and A11Y-08). Every save on a card is
 * followed by a refresh of the list, and the refreshed request carries a new updatedAt. So:
 * - a card is keyed by its request id only: re-keying it by updatedAt would re-mount it and drop its
 *   messages ("Notes saved.", a failed status change) and whatever the admin was typing;
 * - a failed status change is kept by the list, not by the card, so it is still shown when the
 *   refresh moves the request out of the current filter (its card is gone then);
 * - the notes field is a draft: untouched notes follow newer saved notes, typed notes are kept (and
 *   flagged when someone else saved different notes meanwhile), so no edit is lost and a refresh
 *   never leaves stale notes on screen to be saved back over newer ones.
 *
 * Pure and client-safe.
 */
import type { AccessRequestFilter } from "@/lib/validation/access-requests";

/** React key of a request card. Never include updatedAt (see above). */
export function requestCardKey(request: { id: string }): string {
  return request.id;
}

// ---------------------------------------------------------------------------
// Failed status changes
// ---------------------------------------------------------------------------

/** A status change that failed, with what the card showed, so it can be reported without the card. */
export interface StatusProblem {
  businessName: string;
  message: string;
}

/** Failed status changes by request id. */
export type StatusProblems = Readonly<Record<string, StatusProblem>>;

/** Records (`problem`) or clears (`null`) the failed status change of one request. Unchanged input is returned as is. */
export function withStatusProblem(problems: StatusProblems, requestId: string, problem: StatusProblem | null): StatusProblems {
  if (problem) return { ...problems, [requestId]: problem };
  if (!Object.hasOwn(problems, requestId)) return problems;
  const next = { ...problems };
  delete next[requestId];
  return next;
}

/** What the card of `requestId` shows as its failed status change, or null. */
export function statusProblemOf(problems: StatusProblems, requestId: string): string | null {
  return Object.hasOwn(problems, requestId) ? problems[requestId].message : null;
}

/**
 * Problems whose request is no longer in the list (the refresh after the failure moved it out of
 * the current filter): the list shows these itself, in the order they happened.
 */
export function orphanedStatusProblems(
  problems: StatusProblems,
  requests: readonly { id: string }[],
): [requestId: string, problem: StatusProblem][] {
  const listed = new Set(requests.map((request) => request.id));
  return Object.entries(problems).filter(([requestId]) => !listed.has(requestId));
}

/** The failed status changes of one filtered list. */
export interface StatusProblemState {
  filter: AccessRequestFilter;
  problems: StatusProblems;
}

/**
 * The problems to show for `filter`: another filter is another list, so earlier problems (which
 * belong to the list they happened in) are dropped. Returns `state` itself while the filter is the same.
 */
export function statusProblemsForFilter(state: StatusProblemState, filter: AccessRequestFilter): StatusProblemState {
  return state.filter === filter ? state : { filter, problems: {} };
}

/**
 * Under a status filter, every status change takes the request out of the list (on success, and on
 * a conflict too: the refresh shows its newer status), and its card with it. Unsaved notes on that
 * card would be lost, so the admin is asked first. "All" keeps every card.
 */
export function statusChangeLeavesList(filter: AccessRequestFilter): boolean {
  return filter !== "all";
}

// ---------------------------------------------------------------------------
// Notes draft
// ---------------------------------------------------------------------------

/** The server normalises line breaks and trims the notes before saving (blank clears them). */
function normalizeNotes(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function sameNotes(a: string, b: string): boolean {
  return normalizeNotes(a) === normalizeNotes(b);
}

export interface NotesDraft {
  /** The saved notes the admin's edits are compared with. */
  baseline: string;
  /** What the field shows and saves. */
  value: string;
  /** The saved notes last merged in from the page (they change when someone saves elsewhere). */
  server: string;
  /** Someone else saved different notes while the admin had unsaved edits (the edits were kept). */
  changedElsewhere: boolean;
}

/** The field's text for saved notes (none = empty). */
export function notesText(saved: string | null): string {
  return saved ?? "";
}

export function newNotesDraft(saved: string | null): NotesDraft {
  const text = notesText(saved);
  return { baseline: text, value: text, server: text, changedElsewhere: false };
}

export function isNotesDirty(draft: Pick<NotesDraft, "baseline" | "value">): boolean {
  return !sameNotes(draft.value, draft.baseline);
}

/** Whether the page brought saved notes the draft has not merged in yet. */
export function notesNeedRebase(draft: NotesDraft, saved: string | null): boolean {
  return !sameNotes(draft.server, notesText(saved));
}

export function setNotesValue(draft: NotesDraft, value: string): NotesDraft {
  // Typing the saved notes back resolves the conflict.
  return { ...draft, value, changedElsewhere: draft.changedElsewhere && !sameNotes(value, draft.server) };
}

/**
 * Merges newer saved notes into the draft: untouched notes follow them; edited notes keep the
 * admin's text, flagged when someone else saved notes that differ from it. (Notes equal to the
 * baseline are the admin's own save coming back with the refresh, not a change elsewhere.)
 */
export function rebaseNotesDraft(draft: NotesDraft, saved: string | null): NotesDraft {
  const text = notesText(saved);
  if (!isNotesDirty(draft)) return newNotesDraft(text);
  const savedElsewhere = !sameNotes(text, draft.server) && !sameNotes(text, draft.baseline);
  const changedElsewhere = (draft.changedElsewhere || savedElsewhere) && !sameNotes(text, draft.value);
  return { baseline: text, value: draft.value, server: text, changedElsewhere };
}

/**
 * After a successful save of `submitted`: those notes are the saved ones the edits compare with,
 * and the field keeps showing them until the refresh brings the stored copy. Text typed while the
 * save was running stays unsaved.
 */
export function markNotesSaved(draft: NotesDraft, submitted: string): NotesDraft {
  return { ...draft, baseline: submitted, changedElsewhere: false };
}

/** "Use the saved notes": drops the admin's edits for the latest saved notes. */
export function takeSavedNotes(draft: NotesDraft): NotesDraft {
  return newNotesDraft(draft.server);
}

/** What "Discard unsaved changes?" says about a card's unsaved notes. */
export function unsavedNotesMessage(businessName: string): string {
  return `Your notes on the request from ${businessName} haven’t been saved.`;
}

/** Asked before a status change that takes the card, and its unsaved notes, out of the list. */
export function statusChangeDiscardMessage(businessName: string): string {
  return `${unsavedNotesMessage(businessName)} Changing its status moves it out of this list, and the notes are lost.`;
}

export const STATUS_CHANGE_DISCARD_LABEL = "Discard notes";
