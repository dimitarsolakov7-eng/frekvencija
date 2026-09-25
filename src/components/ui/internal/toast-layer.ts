import { subscribeToOpenModals, topmostOpenModal } from "./modal-stack";

/**
 * The toasts' home in the document (review finding A11Y-05).
 *
 * While a modal <dialog> is open, everything outside the topmost one is inert: not clickable, not
 * focusable and not in the accessibility tree, so a toast region in <body> could be neither
 * operated nor announced, and it would paint under the dialog's backdrop. The layer therefore
 * moves inside the topmost open modal dialog (<Dialog>, <ConfirmDialog>, <Drawer> report
 * themselves through the modal stack) and back to <body> when the last one closes. With the
 * Popover API it is also a manual popover, shown again after every move, so it paints in the top
 * layer above the dialog and its backdrop; without the API it is a fixed z-50 box inside the
 * dialog, which is itself in the top layer.
 *
 * Announcements use the layer's own polite live region. A live region that is re-inserted together
 * with new text is often not announced (e.g. a toast fired in the same tick a nested confirm dialog
 * closes), so each message is written only once the layer has stayed put for ANNOUNCE_SETTLE_MS.
 */

/** How long the layer must have stayed in place before a message is written (ms). */
export const ANNOUNCE_SETTLE_MS = 150;
/** Written messages are removed again after this long; the visible toast is unaffected. */
export const ANNOUNCEMENT_TTL_MS = 6000;
/** At most this many messages stay in the live region. */
export const MAX_ANNOUNCEMENT_LINES = 4;

/**
 * Classes of the layer's outer element: a transparent, click-through, full-viewport box. They also
 * neutralise the browser's own [popover] styles (border, padding, canvas background, fit-content).
 */
export const TOAST_LAYER_CLASSES =
  "pointer-events-none fixed inset-0 z-50 m-0 size-auto overflow-visible border-0 bg-transparent p-0 text-fg";

/** What the layer needs from the browser (tests pass a fake). */
export interface ToastLayerEnvironment {
  document: Document;
  /** The Popover API is available. */
  popover: boolean;
  /** The topmost open modal dialog, if any. */
  topmostModal: () => Element | null;
  /** Calls the listener whenever a modal dialog opens or closes; returns the unsubscribe function. */
  subscribeModals: (listener: () => void) => () => void;
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface ToastLayer {
  /** Portal target for the visible toast list. */
  readonly container: HTMLElement;
  /** Puts the layer into the document and keeps it on the topmost modal. Returns the cleanup. */
  attach(): () => void;
  /** Queues a polite screen reader announcement. */
  announce(message: string): void;
}

function browserEnvironment(): ToastLayerEnvironment {
  return {
    document,
    popover: typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover === "function",
    topmostModal: () => topmostOpenModal<HTMLDialogElement>(),
    subscribeModals: subscribeToOpenModals,
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

/** Creates the (detached) layer elements; nothing touches the document until attach(). */
export function createToastLayer(env: ToastLayerEnvironment = browserEnvironment()): ToastLayer {
  const doc = env.document;
  let popover = env.popover;

  const host = doc.createElement("div");
  host.setAttribute("data-toast-layer", "");
  host.className = TOAST_LAYER_CLASSES;
  if (popover) host.setAttribute("popover", "manual");

  const container = doc.createElement("div");
  const live = doc.createElement("div");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-relevant", "additions text");
  live.className = "sr-only";
  host.appendChild(container);
  host.appendChild(live);

  let attached = false;
  let movedAt = Number.NEGATIVE_INFINITY;
  let flushTimer: unknown = null;
  const pending: string[] = [];
  const expiryTimers = new Set<unknown>();

  function showOnTop(): void {
    if (!popover) return;
    try {
      if (!host.matches(":popover-open")) host.showPopover();
    } catch {
      // Never leave the toasts in an unshown (display: none) popover: use a plain fixed layer.
      popover = false;
      host.removeAttribute("popover");
    }
  }

  function place(): void {
    if (!attached) return;
    const parent = env.topmostModal() ?? doc.body;
    if (host.parentNode !== parent) {
      // Moving a showing popover hides it; showOnTop() below shows it again, above the new modal.
      parent.appendChild(host);
      movedAt = env.now();
    }
    showOnTop();
  }

  const handleDialogClose = () => place();

  function scheduleFlush(delay: number): void {
    // Keep an earlier deadline: flush() re-checks how long the layer has been in place.
    if (flushTimer === null) flushTimer = env.setTimeout(flush, delay);
  }

  function flush(): void {
    flushTimer = null;
    if (!attached || pending.length === 0) return;
    const wait = ANNOUNCE_SETTLE_MS - (env.now() - movedAt);
    if (wait > 0) {
      scheduleFlush(wait);
      return;
    }
    for (const text of pending.splice(0)) {
      const line = doc.createElement("p");
      line.textContent = text;
      live.appendChild(line);
      const expiry = env.setTimeout(() => {
        expiryTimers.delete(expiry);
        line.remove();
      }, ANNOUNCEMENT_TTL_MS);
      expiryTimers.add(expiry);
    }
    while (live.childNodes.length > MAX_ANNOUNCEMENT_LINES) live.firstChild?.remove();
  }

  function attach(): () => void {
    if (attached) return () => {};
    attached = true;
    place();
    const unsubscribe = env.subscribeModals(place);
    // A dialog the browser closed before its owner's state caught up (the event does not bubble).
    doc.addEventListener("close", handleDialogClose, true);
    if (pending.length > 0) scheduleFlush(ANNOUNCE_SETTLE_MS);

    return () => {
      attached = false;
      unsubscribe();
      doc.removeEventListener("close", handleDialogClose, true);
      if (flushTimer !== null) env.clearTimeout(flushTimer);
      flushTimer = null;
      for (const timer of expiryTimers) env.clearTimeout(timer);
      expiryTimers.clear();
      while (live.firstChild) live.firstChild.remove();
      host.remove();
    };
  }

  function announce(message: string): void {
    const text = message.trim();
    if (!text) return;
    pending.push(text);
    scheduleFlush(ANNOUNCE_SETTLE_MS);
  }

  return { container, attach, announce };
}
