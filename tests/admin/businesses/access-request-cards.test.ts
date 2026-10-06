/**
 * The access-request list as data (review findings REQ-01 and A11Y-08): request cards are keyed by
 * the request id only, so the refresh after every save (a new updatedAt) never re-mounts a card and
 * drops its messages or what the admin typed; failed status changes are kept by the list, also for
 * a request the refresh moved out of the filter; and the notes field is a draft that follows newer
 * saved notes without losing typed text.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isNotesDirty,
  markNotesSaved,
  newNotesDraft,
  notesNeedRebase,
  orphanedStatusProblems,
  rebaseNotesDraft,
  requestCardKey,
  sameNotes,
  setNotesValue,
  statusChangeDiscardMessage,
  statusChangeLeavesList,
  statusProblemOf,
  statusProblemsForFilter,
  takeSavedNotes,
  unsavedNotesMessage,
  withStatusProblem,
  type NotesDraft,
  type StatusProblem,
  type StatusProblems,
} from "@/components/admin/businesses/access-request-cards";

const LIPA = "4d0f5a2c-6e85-4da1-9a5c-0f4d2e7b6c55";
const MORAVA = "5e1a6b3d-7f96-4eb2-8b6d-1a5e3f8c7d66";
const KEJ = "6f2b7c4e-8a07-4fc3-9c7e-2b6f4a9d8e77";

const CONFLICT: StatusProblem = {
  businessName: "Bistro Lipa",
  message: "Someone changed this request in the meantime. The list has been refreshed; check it and try again.",
};
const OPEN_EMAIL: StatusProblem = { businessName: "Bar Kej", message: "There is already an open request from this email address." };

describe("requestCardKey", () => {
  it("is the request id, whatever the request's updatedAt", () => {
    const before = { id: LIPA, updatedAt: "2026-09-24T19:12:00Z" };
    const afterSave = { id: LIPA, updatedAt: "2026-09-24T19:15:42Z" };
    expect(requestCardKey(before)).toBe(LIPA);
    expect(requestCardKey(afterSave)).toBe(requestCardKey(before));
    expect(requestCardKey({ id: MORAVA })).not.toBe(requestCardKey(before));
  });
});

describe("failed status changes (REQ-01)", () => {
  it("records, replaces and clears the problem of one request without touching the others", () => {
    const empty: StatusProblems = {};
    const one = withStatusProblem(empty, LIPA, CONFLICT);
    expect(one).toEqual({ [LIPA]: CONFLICT });
    expect(empty).toEqual({});

    const two = withStatusProblem(one, KEJ, OPEN_EMAIL);
    expect(two).toEqual({ [LIPA]: CONFLICT, [KEJ]: OPEN_EMAIL });
    const replaced = withStatusProblem(two, KEJ, CONFLICT);
    expect(replaced[KEJ]).toBe(CONFLICT);

    const cleared = withStatusProblem(two, LIPA, null);
    expect(cleared).toEqual({ [KEJ]: OPEN_EMAIL });
    expect(two).toEqual({ [LIPA]: CONFLICT, [KEJ]: OPEN_EMAIL });
  });

  it("returns the same object when there is nothing to clear (no re-render)", () => {
    const problems = withStatusProblem({}, KEJ, OPEN_EMAIL);
    expect(withStatusProblem(problems, LIPA, null)).toBe(problems);
    expect(withStatusProblem(problems, "toString", null)).toBe(problems);
  });

  it("gives a listed card its own message, and nothing for others", () => {
    const problems = withStatusProblem({}, KEJ, OPEN_EMAIL);
    expect(statusProblemOf(problems, KEJ)).toBe(OPEN_EMAIL.message);
    expect(statusProblemOf(problems, LIPA)).toBeNull();
    expect(statusProblemOf(problems, "constructor")).toBeNull();
  });

  it("keeps a problem whose request left the list (the refresh moved it out of the filter)", () => {
    const problems = withStatusProblem(withStatusProblem({}, LIPA, CONFLICT), KEJ, OPEN_EMAIL);
    // Under "New", Bistro Lipa was changed elsewhere: the refreshed list no longer has it.
    const listed = [{ id: MORAVA }, { id: KEJ }];
    expect(orphanedStatusProblems(problems, listed)).toEqual([[LIPA, CONFLICT]]);
    // A listed request's problem is shown on its card instead.
    expect(orphanedStatusProblems(problems, [{ id: LIPA }, { id: KEJ }])).toEqual([]);
    expect(orphanedStatusProblems(problems, [])).toEqual([
      [LIPA, CONFLICT],
      [KEJ, OPEN_EMAIL],
    ]);
  });

  it("starts over when the filter changes, and keeps the state while it stays", () => {
    const state = { filter: "new" as const, problems: withStatusProblem({}, LIPA, CONFLICT) };
    expect(statusProblemsForFilter(state, "new")).toBe(state);
    expect(statusProblemsForFilter(state, "contacted")).toEqual({ filter: "contacted", problems: {} });
    expect(statusProblemsForFilter(state, "all")).toEqual({ filter: "all", problems: {} });
  });

  it("knows that a status change takes the card out of a filtered list only", () => {
    expect(statusChangeLeavesList("all")).toBe(false);
    for (const filter of ["new", "contacted", "approved", "declined"] as const) expect(statusChangeLeavesList(filter)).toBe(true);
  });
});

describe("notes draft (A11Y-08 follow-up)", () => {
  function typed(saved: string | null, value: string): NotesDraft {
    return setNotesValue(newNotesDraft(saved), value);
  }

  it("starts from the saved notes, empty when there are none", () => {
    expect(newNotesDraft(null)).toEqual({ baseline: "", value: "", server: "", changedElsewhere: false });
    expect(newNotesDraft("Called on Monday.").value).toBe("Called on Monday.");
    expect(isNotesDirty(newNotesDraft("Called on Monday."))).toBe(false);
  });

  it("is dirty while the text differs from the saved notes (ignoring what the server trims)", () => {
    expect(isNotesDirty(typed(null, "Wants a demo."))).toBe(true);
    expect(isNotesDirty(typed("Called.", "Called.  "))).toBe(false);
    expect(isNotesDirty(typed("Line one\nLine two", "Line one\r\nLine two"))).toBe(false);
    expect(isNotesDirty(typed("Called.", ""))).toBe(true);
    expect(sameNotes("  ", "")).toBe(true);
  });

  it("follows notes another admin saved while the field is untouched", () => {
    const draft = newNotesDraft("Called on Monday.");
    expect(notesNeedRebase(draft, "Called on Monday.")).toBe(false);
    expect(notesNeedRebase(draft, "Called on Monday. Demo booked.")).toBe(true);
    const rebased = rebaseNotesDraft(draft, "Called on Monday. Demo booked.");
    expect(rebased).toEqual(newNotesDraft("Called on Monday. Demo booked."));
    expect(notesNeedRebase(rebased, "Called on Monday. Demo booked.")).toBe(false);
    // Notes cleared elsewhere empty the field too.
    expect(rebaseNotesDraft(draft, null).value).toBe("");
  });

  it("keeps what the admin typed when other notes are saved meanwhile, and flags it", () => {
    const draft = typed("Called on Monday.", "Called on Monday. Wants Jazz.");
    const rebased = rebaseNotesDraft(draft, "Called on Monday. Demo booked.");
    expect(rebased.value).toBe("Called on Monday. Wants Jazz.");
    expect(rebased.changedElsewhere).toBe(true);
    expect(isNotesDirty(rebased)).toBe(true);
    expect(notesNeedRebase(rebased, "Called on Monday. Demo booked.")).toBe(false);

    // Typing the saved notes back resolves it; "Use the saved notes" takes them.
    expect(setNotesValue(rebased, "Called on Monday. Demo booked. ").changedElsewhere).toBe(false);
    expect(takeSavedNotes(rebased)).toEqual(newNotesDraft("Called on Monday. Demo booked."));
  });

  it("does not flag saved notes that match what the admin typed", () => {
    const rebased = rebaseNotesDraft(typed(null, "Wants a demo."), "Wants a demo.");
    expect(rebased.changedElsewhere).toBe(false);
    expect(isNotesDirty(rebased)).toBe(false);
  });

  it("keeps the saved text in the field until the refresh arrives (result first)", () => {
    const saved = markNotesSaved(typed(null, "Wants a demo. "), "Wants a demo. ");
    expect(isNotesDirty(saved)).toBe(false);
    expect(saved.value).toBe("Wants a demo. ");
    // Still the old page: nothing to merge, so the field does not jump back to the old notes.
    expect(notesNeedRebase(saved, null)).toBe(false);
    // The refreshed request brings the stored (trimmed) notes.
    const refreshed = rebaseNotesDraft(saved, "Wants a demo.");
    expect(refreshed).toEqual(newNotesDraft("Wants a demo."));
  });

  it("after the admin's own save, the refresh changes nothing (refresh first)", () => {
    const refreshed = rebaseNotesDraft(typed(null, "Wants a demo."), "Wants a demo.");
    const saved = markNotesSaved(refreshed, "Wants a demo.");
    expect(saved).toEqual({ baseline: "Wants a demo.", value: "Wants a demo.", server: "Wants a demo.", changedElsewhere: false });
  });

  it("keeps text typed while the save was running as unsaved, without a false conflict", () => {
    // Result first: the refresh then brings the submitted notes, which are the admin's own.
    const resultFirst = markNotesSaved(typed(null, "Wants a demo. Jazz"), "Wants a demo.");
    expect(isNotesDirty(resultFirst)).toBe(true);
    const afterRefresh = rebaseNotesDraft(resultFirst, "Wants a demo.");
    expect(afterRefresh.changedElsewhere).toBe(false);
    expect(afterRefresh.value).toBe("Wants a demo. Jazz");
    expect(isNotesDirty(afterRefresh)).toBe(true);

    // Refresh first: briefly looks like a change elsewhere, which the save result then clears.
    const refreshFirst = rebaseNotesDraft(typed(null, "Wants a demo. Jazz"), "Wants a demo.");
    const settled = markNotesSaved(refreshFirst, "Wants a demo.");
    expect(settled.changedElsewhere).toBe(false);
    expect(settled.value).toBe("Wants a demo. Jazz");
    expect(isNotesDirty(settled)).toBe(true);
  });

  it("still flags notes someone else saved after the admin's own save", () => {
    const saved = markNotesSaved(typed(null, "Wants a demo."), "Wants a demo.");
    const typing = setNotesValue(saved, "Wants a demo. Jazz");
    const rebased = rebaseNotesDraft(typing, "Declined by phone.");
    expect(rebased.changedElsewhere).toBe(true);
    expect(rebased.value).toBe("Wants a demo. Jazz");
  });

  it("names the request in the unsaved-notes questions", () => {
    expect(unsavedNotesMessage("Bistro Lipa")).toBe("Your notes on the request from Bistro Lipa haven’t been saved.");
    expect(statusChangeDiscardMessage("Bistro Lipa")).toBe(
      "Your notes on the request from Bistro Lipa haven’t been saved. Changing its status moves it out of this list, and the notes are lost.",
    );
  });
});

/**
 * Keys and state kept across prop updates are invisible to server rendering (and the suite has no
 * DOM environment), so the wiring the fix depends on is checked in the source.
 */
describe("AccessRequestsView wiring (REQ-01, A11Y-08)", () => {
  const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
  // Normalise line endings so the source checks hold on CRLF checkouts (Windows) too.
  const source = readFileSync(path.join(ROOT, "src/components/admin/businesses/AccessRequestsView.tsx"), "utf8").replace(/\r\n/g, "\n");
  const card = source.match(/<RequestCard\b[\s\S]*?\/>/)?.[0] ?? "";
  const cardBody = source.match(/\nfunction RequestCard\([\s\S]*?\n}\n/)?.[0] ?? "";

  it("keys each card by requestCardKey (the id), never by updatedAt", () => {
    expect(card).toContain("key={requestCardKey(request)}");
    expect(card).not.toMatch(/updatedAt/);
    expect(source).not.toMatch(/key=\{[^}]*updatedAt/);
    // Also template-literal keys such as key={`${request.id}:${request.updatedAt}`} on any element.
    expect(source).not.toMatch(/key=\{[^\n]*updatedAt/);
  });

  it("gives each card its problem from the list, not from state of its own", () => {
    expect(card).toContain("problem={statusProblemOf(problems, request.id)}");
    expect(card).toContain("onProblem={reportProblem}");
    expect(cardBody).toContain("problem: string | null;");
    expect(cardBody).not.toMatch(/\[\s*(?:problem|error)\w*\s*,\s*set\w*\s*\]\s*=\s*useState/i);
    expect(cardBody).not.toMatch(/useState<[^>]*StatusProblem/);
  });

  it("shows the notes draft in a controlled field and reports unsaved notes to the admin-wide guard", () => {
    expect(source).toContain("value={draft.value}");
    expect(source).not.toContain("defaultValue=");
    expect(cardBody).toContain("if (notesNeedRebase(notes, request.adminNotes)) setNotes(rebaseNotesDraft(notes, request.adminNotes));");
    expect(cardBody).toContain("useUnsavedChangesGuard(notesDirty, { message: unsavedNotesMessage(request.businessName) });");
    expect(source).toContain('from "@/components/admin/shell/unsaved-changes"');
  });
});
