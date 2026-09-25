"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Focus handling shared by the admin forms (review finding A11Y-07). The forms stay mounted across
 * results, so their polite FormMessage region announces each message; these hooks move focus to
 * where the admin has to act next.
 */

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
    const invalid = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not([disabled])');
    (invalid ?? fallback.current)?.focus();
  }, [ok, nonce, form, fallback]);
}

/**
 * A submit button is disabled while its form saves, and a disabled element loses focus. When the
 * save ends with focus lost (on the page body), puts it back on `target`.
 */
export function useRestoreFocusAfterPending(pending: boolean, target: RefObject<HTMLElement | null>): void {
  const wasPending = useRef(pending);
  useEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    if (!finished) return;
    const active = document.activeElement;
    if (!active || active === document.body) target.current?.focus();
  }, [pending, target]);
}
