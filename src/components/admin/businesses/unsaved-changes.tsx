"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useConfirmDiscard } from "@/components/admin/shell/unsaved-changes";

/**
 * Helpers of the admin editors around the admin-wide unsaved-changes guard
 * (src/components/admin/shell/unsaved-changes.tsx, mounted once in AdminShell). Editors register
 * unsaved work with useUnsavedChangesGuard(); the guard then holds back every same-origin link click
 * (lists, menus, breadcrumbs, the sidebar), so links need nothing of their own. Navigation started
 * from code — a menu item, a selector — goes through useGuardedNavigation() instead.
 */

export interface GuardedNavigateOptions {
  replace?: boolean;
  /** Same as next/link's `scroll` (default true). */
  scroll?: boolean;
}

export interface GuardedNavigation {
  /** Navigates within the app, asking first when unsaved work would be lost. Resolves whether it navigated. */
  navigate: (href: string, options?: GuardedNavigateOptions) => Promise<boolean>;
}

export function useGuardedNavigation(): GuardedNavigation {
  const router = useRouter();
  const confirmDiscard = useConfirmDiscard();

  return useMemo<GuardedNavigation>(
    () => ({
      async navigate(href, options = {}) {
        if (!(await confirmDiscard())) return false;
        const scroll = options.scroll ?? true;
        if (options.replace) router.replace(href as Route, { scroll });
        else router.push(href as Route, { scroll });
        return true;
      },
    }),
    [router, confirmDiscard],
  );
}

/** Serialises a form's current values (what would be submitted) for change detection. */
export function snapshotForm(form: HTMLFormElement): string {
  const entries: [string, string][] = [];
  for (const [key, value] of new FormData(form).entries()) {
    if (key.startsWith("$ACTION")) continue;
    entries.push([key, typeof value === "string" ? value : value.name]);
  }
  return JSON.stringify(entries);
}

/**
 * Change tracking for one uncontrolled form (`form` is its ref): call `track` from the form's
 * onChange. The baseline is the form as first rendered; `markSaved` accepts the current values after
 * a save (the form stays mounted). Pass `dirty` to useUnsavedChangesGuard().
 */
export function useFormChangeTracking(form: RefObject<HTMLFormElement | null>) {
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (form.current && baseline.current === null) baseline.current = snapshotForm(form.current);
  }, [form]);

  const track = useCallback(() => {
    if (!form.current || baseline.current === null) return;
    setDirty(snapshotForm(form.current) !== baseline.current);
  }, [form]);

  const markSaved = useCallback(() => {
    if (form.current) baseline.current = snapshotForm(form.current);
    setDirty(false);
  }, [form]);

  return { track, markSaved, dirty };
}
