"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Focus handling shared by the admin forms (review finding A11Y-07). The forms stay mounted across
 * results, so their polite FormMessage region announces each message; these hooks move focus to
 * where the admin has to act next.
 */

/** Controls marked invalid by <Field> (aria-invalid) that can take focus. */
export const INVALID_CONTROL_SELECTOR = '[aria-invalid="true"]:not([disabled])';

interface Focusable {
  focus: () => void;
}

/** Focuses the first invalid control in `form`, else `fallback`; returns what received focus. */
export function focusFirstProblem<T extends Focusable>(
  form: { querySelector: (selector: string) => T | null } | null,
  fallback: T | null,
): T | null {
  const target = form?.querySelector(INVALID_CONTROL_SELECTOR) ?? fallback;
  target?.focus();
  return target;
}

/** Focus is lost when nothing, or only the page body, has it (e.g. its element became disabled). */
export function focusWasLost(active: Element | null, body: Element | null): boolean {
  return active === null || active === body;
}

/**
 * After a failed submit (a new result with `ok: false`), focuses the first invalid field in `form`,
 * or `fallback` (the form's message, focusable with tabIndex={-1}) when no field is marked invalid.
 * Runs once per result: results carry a fresh `nonce`.
 */
export function useFocusAfterFailure(
  result: { ok: boolean; nonce?: number },
  form: RefObject<HTMLElement | null>,
  fallback: RefObject<HTMLElement | null>,
): void {
  const { ok, nonce } = result;
  useEffect(() => {
    if (ok || nonce === undefined) return;
    focusFirstProblem<HTMLElement>(form.current, fallback.current);
  }, [ok, nonce, form, fallback]);
}

/**
 * A submit button is disabled while its form saves, and a disabled element loses focus. When the
 * save ends with focus lost, puts it back on `target`.
 */
export function useRestoreFocusAfterPending(pending: boolean, target: RefObject<HTMLElement | null>): void {
  const wasPending = useRef(pending);
  useEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    if (finished && focusWasLost(document.activeElement, document.body)) target.current?.focus();
  }, [pending, target]);
}
