/**
 * Feedback when a catalogue editor (genre, track) refuses to save because a field is invalid: a
 * sentence for a polite live region, and moving focus to the first invalid field, whose error the
 * screen reader then reads through the field's aria-describedby. Client-safe; unit-tested in
 * tests/admin/catalog.
 */

export interface FieldProblem {
  /** The field's visible label, e.g. "Genre name". */
  label: string;
  /** The problem, or nothing when the field is fine. */
  message: string | null | undefined;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * "Fix 1 field before saving. Genre name: Enter a genre name." — or "" when no field has a problem.
 * `action` completes "before …" (default "saving").
 */
export function describeFieldProblems(problems: readonly FieldProblem[], action = "saving"): string {
  const listed = problems.flatMap((problem) => {
    const message = problem.message?.trim();
    return message ? [`${problem.label}: ${sentence(message)}`] : [];
  });
  if (listed.length === 0) return "";
  const count = listed.length === 1 ? "1 field" : `${listed.length} fields`;
  return [`Fix ${count} before ${action}.`, ...listed].join(" ");
}

/**
 * Focuses the first control marked aria-invalid="true" in `root` (in document order), opening a
 * collapsed <details> around it first (e.g. "More settings"). Returns whether one was found.
 */
export function focusFirstInvalidField(root: ParentNode | null | undefined): boolean {
  const field = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!field) return false;
  const details = field.closest("details");
  if (details && !details.open) details.open = true;
  field.focus();
  return true;
}
