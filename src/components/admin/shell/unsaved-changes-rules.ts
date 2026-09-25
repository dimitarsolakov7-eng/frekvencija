/**
 * Pure rules of the admin "unsaved changes" guard (no React, no DOM globals; unit-tested in
 * tests/admin/shell): which link clicks leave the current page and must be held back, which editors
 * currently hold unsaved work, and what the confirmation dialog says. The React side lives in
 * ./unsaved-changes.tsx.
 */

/**
 * Put this attribute on a link, or on an element around links, whose navigation keeps the editors
 * mounted and their edits intact (e.g. list paging on the same screen), so the guard lets it through.
 */
export const SKIP_UNSAVED_GUARD_ATTRIBUTE = "data-skip-unsaved-guard";

export const UNSAVED_CHANGES_TITLE = "Discard unsaved changes?";
export const LEAVE_CONFIRM_LABEL = "Discard and leave";
export const DISCARD_CONFIRM_LABEL = "Discard changes";
export const KEEP_EDITING_LABEL = "Keep editing";
export const DEFAULT_LEAVE_MESSAGE = "You have changes that haven’t been saved. If you leave this page now, they are lost.";
export const DEFAULT_DISCARD_MESSAGE = "Your changes haven’t been saved. If you continue, they are lost.";

/** The parts of a click event the guard looks at. */
export interface GuardedClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** The parts of the clicked <a> the guard looks at. */
export interface GuardedLink {
  /** The href attribute as written. */
  href: string;
  /** The target attribute, or null. */
  target: string | null;
  /** The link has a download attribute. */
  download: boolean;
  /** The link, or an element around it, carries SKIP_UNSAVED_GUARD_ATTRIBUTE. */
  skip: boolean;
}

/**
 * Where a link click would take the admin ("/path?query#hash"), when that click leaves the current
 * page and so must wait for "Discard unsaved changes?"; null when the click should be left alone:
 * - modified clicks (new tab/window, download), other buttons, and clicks already handled elsewhere;
 * - links that open elsewhere (`target` other than _self), downloads, and opted-out links;
 * - other origins and non-http(s) URLs (mailto:, tel:, javascript:), which a click cannot turn
 *   into an in-app navigation (a real page unload still triggers the browser's own warning);
 * - links to the page that is already open (same path and query): in-page #anchors, and a
 *   same-URL navigation that re-renders the page without unmounting its editors.
 */
export function guardedLinkDestination(
  click: GuardedClick,
  link: GuardedLink,
  currentUrl: string,
  baseUrl: string = currentUrl,
): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (link.skip || link.download) return null;
  const target = link.target?.trim().toLowerCase() ?? "";
  if (target !== "" && target !== "_self") return null;

  let current: URL;
  let destination: URL;
  try {
    current = new URL(currentUrl);
    destination = new URL(link.href, baseUrl);
  } catch {
    return null;
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:") return null;
  if (destination.origin !== current.origin) return null;
  if (destination.pathname === current.pathname && destination.search === current.search) return null;
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

interface DirtyEntry {
  message: string | null;
}

/**
 * Who currently holds unsaved work (editors with unsaved edits, an upload queue still running): one
 * entry per registration, so several editors can be dirty at once and one of them finishing does not
 * clear the others. Registering an id again replaces its entry (and message).
 */
export class UnsavedChangesRegistry {
  private readonly entries = new Map<string, DirtyEntry>();

  /**
   * Marks `id` as holding unsaved work. Returns its unregister function, which only removes this
   * registration: a stale one (the id was registered again since) leaves the newer entry alone.
   */
  register(id: string, message?: string | null): () => void {
    const entry: DirtyEntry = { message: message?.trim() || null };
    this.entries.set(id, entry);
    return () => {
      if (this.entries.get(id) === entry) this.entries.delete(id);
    };
  }

  /** Whether anything is registered as dirty. */
  get dirty(): boolean {
    return this.entries.size > 0;
  }

  /** Number of dirty registrations. */
  get size(): number {
    return this.entries.size;
  }

  /** The distinct custom messages of the dirty registrations, oldest registration first. */
  messages(): string[] {
    const seen = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.message) seen.add(entry.message);
    }
    return [...seen];
  }
}

/** The paragraphs of the "leave this page" confirmation: the editors' own messages, or the default. */
export function leaveMessages(messages: readonly string[]): string[] {
  const own = messages.map((message) => message.trim()).filter((message) => message.length > 0);
  return own.length > 0 ? [...new Set(own)] : [DEFAULT_LEAVE_MESSAGE];
}
