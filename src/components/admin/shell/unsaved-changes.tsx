"use client";

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui";
import {
  DEFAULT_DISCARD_MESSAGE,
  DISCARD_CONFIRM_LABEL,
  guardedLinkDestination,
  KEEP_EDITING_LABEL,
  LEAVE_CONFIRM_LABEL,
  leaveMessages,
  SKIP_UNSAVED_GUARD_ATTRIBUTE,
  UNSAVED_CHANGES_TITLE,
  UnsavedChangesRegistry,
} from "./unsaved-changes-rules";

/**
 * "Warn before discarding unsaved edits" (design handoff) for the whole admin workspace. One
 * <UnsavedChangesProvider> sits in AdminShell; editors report unsaved work with
 * useUnsavedChangesGuard(isDirty). While anything is dirty:
 * - a plain click on any same-origin link that leaves the page (sidebar, account menu, breadcrumbs,
 *   "Manage tracks", …) is held back and "Discard unsaved changes?" asks first; "Discard and leave"
 *   then navigates with the Next router, "Keep editing" stays (focus goes back to where it was);
 * - reloading or closing the tab triggers the browser's own warning (beforeunload).
 * Editors that switch what they edit in place (another track, another genre) ask through
 * useConfirmDiscard(). Clicks are read in the capture phase on `window`, before React and next/link
 * see them, so no link needs its own guard. Links whose navigation keeps the editors mounted (list
 * paging) can opt out with the data-skip-unsaved-guard attribute. Not covered: browser Back/Forward
 * (history navigation cannot be held back), which dismisses an open question instead.
 */

export { SKIP_UNSAVED_GUARD_ATTRIBUTE } from "./unsaved-changes-rules";

export interface UnsavedChangesGuardOptions {
  /**
   * What would be lost, shown in "Discard unsaved changes?" when the admin tries to leave, e.g.
   * "Your edits to “Afterglow” haven’t been saved." Default: a generic sentence.
   */
  message?: string;
}

export interface ConfirmDiscardOptions {
  /** Dialog text. Default: "Your changes haven’t been saved. If you continue, they are lost." */
  message?: string;
  /** Label of the confirm button. Default: "Discard changes". */
  confirmLabel?: string;
}

/** Resolves true when the edits may be dropped (the admin chose Discard), false to keep editing. */
export type ConfirmDiscardFn = (options?: ConfirmDiscardOptions) => Promise<boolean>;

/** confirmDiscard(); also available as its own `.confirmDiscard` property for destructuring. */
export type ConfirmDiscard = ConfirmDiscardFn & { readonly confirmDiscard: ConfirmDiscardFn };

type Prompt =
  | { kind: "leave"; href: string; messages: string[] }
  | { kind: "discard"; messages: string[]; confirmLabel: string; resolve: (discard: boolean) => void };

interface GuardContextValue {
  registry: UnsavedChangesRegistry;
  confirmDiscard: ConfirmDiscard;
}

const GuardContext = createContext<GuardContextValue | null>(null);

function preventUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  // Older browsers only show their prompt when returnValue is set.
  event.returnValue = "";
}

/** The <a href> a click landed in (also for clicks on an icon or text inside it). */
function clickedLink(target: EventTarget | null): Element | null {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return element?.closest("a[href]") ?? null;
}

/**
 * "Discard unsaved changes?" for one question. Mounted only while a question is open, so the router
 * is only needed then (the provider itself also renders outside the app router, e.g. in tests);
 * unmounting closes the native dialog and returns focus to the element that had it.
 */
function UnsavedChangesDialog({ prompt, onClose }: { prompt: Prompt; onClose: () => void }) {
  const router = useRouter();

  function handleConfirm() {
    onClose();
    if (prompt.kind === "discard") prompt.resolve(true);
    // The editors unregister when the page unmounts; a navigation that keeps them mounted keeps guarding.
    else router.push(prompt.href as Route);
  }

  return (
    <ConfirmDialog
      open
      onCancel={onClose}
      onConfirm={handleConfirm}
      title={UNSAVED_CHANGES_TITLE}
      description={
        <div className="grid gap-2">
          {prompt.messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      }
      confirmLabel={prompt.kind === "discard" ? prompt.confirmLabel : LEAVE_CONFIRM_LABEL}
      cancelLabel={KEEP_EDITING_LABEL}
    />
  );
}

/**
 * Registry and dialog of the admin unsaved-changes guard. Mount it once around the admin workspace
 * (AdminShell does); nested editors register through useUnsavedChangesGuard().
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [registry] = useState(() => new UnsavedChangesRegistry());
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  // The page changed while a question was open (browser Back/Forward): it no longer applies.
  // Adjusting state during render is React's documented pattern for reacting to a changed value.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    if (prompt) setPrompt(null);
  }

  // Reload, closing the tab, typing another address, or any navigation that unloads the page.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (registry.dirty) preventUnload(event);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [registry]);

  // In-app links navigate on the client, where beforeunload never fires: hold them back here.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!registry.dirty) return;
      const link = clickedLink(event.target);
      if (!link) return;
      const href = guardedLinkDestination(
        event,
        {
          href: link.getAttribute("href") ?? "",
          target: link.getAttribute("target"),
          download: link.hasAttribute("download"),
          skip: link.closest(`[${SKIP_UNSAVED_GUARD_ATTRIBUTE}]`) !== null,
        },
        window.location.href,
        document.baseURI,
      );
      if (href === null) return;
      // next/link ignores a click whose default was prevented, and so does the browser for a plain <a>.
      // The click still reaches other handlers, so a menu or drawer holding the link closes as usual.
      event.preventDefault();
      setPrompt({ kind: "leave", href, messages: leaveMessages(registry.messages()) });
    };
    // Capture on window: runs before React's listeners on the document (and so before next/link).
    window.addEventListener("click", handleClick, true);
    return () => window.removeEventListener("click", handleClick, true);
  }, [registry]);

  // A confirmDiscard() question that is dismissed, replaced or unmounted answers false. (A promise
  // settles once, so this does not undo a "Discard" answer given before the prompt closed.)
  useEffect(() => {
    if (prompt?.kind !== "discard") return;
    const { resolve } = prompt;
    return () => resolve(false);
  }, [prompt]);

  const value = useMemo<GuardContextValue>(() => {
    const ask: ConfirmDiscardFn = (options = {}) => {
      // Nothing unsaved anywhere: nothing to confirm.
      if (!registry.dirty) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        setPrompt({
          kind: "discard",
          messages: [options.message?.trim() || DEFAULT_DISCARD_MESSAGE],
          confirmLabel: options.confirmLabel ?? DISCARD_CONFIRM_LABEL,
          resolve,
        });
      });
    };
    return { registry, confirmDiscard: Object.assign(ask, { confirmDiscard: ask }) };
  }, [registry]);

  return (
    <GuardContext.Provider value={value}>
      {children}
      {prompt && <UnsavedChangesDialog prompt={prompt} onClose={() => setPrompt(null)} />}
    </GuardContext.Provider>
  );
}

/**
 * Registers the calling editor as holding unsaved work while `isDirty` is true (and unregisters it
 * when it turns false or the component unmounts). Several editors, or several calls in one
 * component, can be dirty at the same time. Outside an UnsavedChangesProvider it only warns before
 * the tab is closed or reloaded.
 */
export function useUnsavedChangesGuard(isDirty: boolean, options?: UnsavedChangesGuardOptions): void {
  const context = useContext(GuardContext);
  const id = useId();
  const message = options?.message;

  useEffect(() => {
    if (!isDirty) return;
    if (context) return context.registry.register(id, message);
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [context, id, isDirty, message]);
}

function confirmWithBrowser(options: ConfirmDiscardOptions = {}): Promise<boolean> {
  return Promise.resolve(window.confirm(options.message?.trim() || DEFAULT_DISCARD_MESSAGE));
}

const BROWSER_CONFIRM_DISCARD: ConfirmDiscard = Object.assign(confirmWithBrowser, { confirmDiscard: confirmWithBrowser });

/**
 * `confirmDiscard()` for editors that switch what they edit in place (another track, another genre):
 * call it when the current editor has unsaved changes and continue only when it resolves true.
 *
 * ```ts
 * const confirmDiscard = useConfirmDiscard();
 * if (dirty && !(await confirmDiscard({ message: "Your edits to “Afterglow” haven’t been saved." }))) return;
 * ```
 *
 * It resolves true at once when no editor is registered as dirty, otherwise after the admin answers
 * "Discard unsaved changes?" (true = Discard changes, false = Keep editing or Escape). The function is
 * stable across renders. Outside an UnsavedChangesProvider it falls back to window.confirm().
 */
export function useConfirmDiscard(): ConfirmDiscard {
  return useContext(GuardContext)?.confirmDiscard ?? BROWSER_CONFIRM_DISCARD;
}
