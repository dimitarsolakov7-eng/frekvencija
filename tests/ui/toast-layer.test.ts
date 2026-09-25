/**
 * Review finding A11Y-05: toasts shown while a modal <Dialog>/<Drawer> is open were inert and drawn
 * under the backdrop. The toast layer now follows the topmost open modal dialog (everything outside
 * it is inert), sits in the top layer above it, and announces each toast through its own polite live
 * region once it has settled. The browser is replaced by a small fake that models what matters here:
 * DOM moves, the top layer, "removing a showing popover hides it" and the dialog `close` event.
 */
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "@/components/ui";
import { pushOpenModal, subscribeToOpenModals, topmostOpenModal } from "@/components/ui/internal/modal-stack";
import {
  ANNOUNCE_SETTLE_MS,
  ANNOUNCEMENT_TTL_MS,
  MAX_ANNOUNCEMENT_LINES,
  TOAST_LAYER_CLASSES,
  createToastLayer,
  type ToastLayerEnvironment,
} from "@/components/ui/internal/toast-layer";
import { toastAnnouncement } from "@/components/ui/Toast";

class FakeElement {
  parentNode: FakeElement | null = null;
  childNodes: FakeElement[] = [];
  className = "";
  textContent = "";
  /** Only meaningful for <dialog>. */
  open = false;
  private readonly attributes = new Map<string, string>();

  constructor(
    readonly doc: FakeDocument,
    readonly tagName: string,
  ) {}

  get firstChild(): FakeElement | null {
    return this.childNodes[0] ?? null;
  }

  get isConnected(): boolean {
    if (this === this.doc.body) return true;
    return this.parentNode?.isConnected ?? false;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  appendChild(child: FakeElement): FakeElement {
    child.remove();
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  remove() {
    const parent = this.parentNode;
    if (!parent) return;
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1);
    this.parentNode = null;
    // Browser removing steps: a showing popover in the removed subtree is hidden.
    const hide = (node: FakeElement) => {
      this.doc.leaveTopLayer(node);
      node.childNodes.forEach(hide);
    };
    hide(this);
  }

  matches(selector: string): boolean {
    if (selector !== ":popover-open") throw new Error(`unsupported selector ${selector}`);
    return this.doc.topLayer.includes(this);
  }

  showPopover() {
    if (this.attributes.get("popover") === undefined) throw new Error("NotSupportedError: not a popover");
    if (!this.isConnected) throw new Error("InvalidStateError: not connected");
    if (this.doc.topLayer.includes(this)) throw new Error("InvalidStateError: already showing");
    if (this.doc.breakPopovers) throw new Error("InvalidStateError: simulated failure");
    this.doc.topLayer.push(this);
  }

  /** Test helper: <dialog>.showModal(). */
  showModal() {
    this.open = true;
    this.doc.topLayer.push(this);
  }

  /** Test helper: <dialog>.close(). */
  close() {
    this.open = false;
    this.doc.leaveTopLayer(this);
  }
}

class FakeDocument {
  readonly body: FakeElement;
  /** Rendering order of the top layer, bottom to top. */
  topLayer: FakeElement[] = [];
  breakPopovers = false;
  private readonly closeListeners = new Set<() => void>();

  constructor() {
    this.body = new FakeElement(this, "body");
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }

  leaveTopLayer(node: FakeElement) {
    this.topLayer = this.topLayer.filter((entry) => entry !== node);
  }

  addEventListener(type: string, listener: () => void, capture?: boolean) {
    if (type === "close" && capture) this.closeListeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void, capture?: boolean) {
    if (type === "close" && capture) this.closeListeners.delete(listener);
  }

  /** A <dialog> fired `close` (captured at the document). */
  dispatchClose() {
    for (const listener of Array.from(this.closeListeners)) listener();
  }
}

function setup({ popover = true }: { popover?: boolean } = {}) {
  const doc = new FakeDocument();
  const env: ToastLayerEnvironment = {
    document: doc as unknown as Document,
    popover,
    topmostModal: () => topmostOpenModal<FakeElement>() as unknown as Element | null,
    subscribeModals: subscribeToOpenModals,
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const layer = createToastLayer(env);
  const container = layer.container as unknown as FakeElement;
  const host = container.parentNode as FakeElement;
  const live = host.childNodes.find((node) => node.getAttribute("aria-live") !== null) as FakeElement;
  const releases: Array<() => void> = [];

  /** Opens a modal dialog the way useModalDialog does (showModal, then the modal stack). */
  function openModal(parent: FakeElement = doc.body) {
    const dialog = doc.createElement("dialog");
    parent.appendChild(dialog);
    dialog.showModal();
    const release = pushOpenModal(dialog);
    releases.push(release);
    return {
      dialog,
      /** Closes it the way useModalDialog's cleanup does. */
      close() {
        dialog.close();
        release();
      },
    };
  }

  const lines = () => live.childNodes.map((node) => node.textContent);
  const cleanup = () => releases.forEach((release) => release());
  return { doc, layer, host, container, live, openModal, lines, cleanup };
}

describe("modal stack", () => {
  it("reports the most recently opened modal that is still open and in the document", () => {
    const first = { open: true, isConnected: true };
    const second = { open: true, isConnected: true };
    const listener = vi.fn();
    const unsubscribe = subscribeToOpenModals(listener);

    const releaseFirst = pushOpenModal(first);
    const releaseSecond = pushOpenModal(second);
    expect(topmostOpenModal()).toBe(second);
    expect(listener).toHaveBeenCalledTimes(2);

    second.open = false; // closed by the browser before its owner released it
    expect(topmostOpenModal()).toBe(first);
    releaseSecond();
    releaseSecond(); // releasing twice is harmless and does not notify again
    expect(listener).toHaveBeenCalledTimes(3);

    first.isConnected = false;
    expect(topmostOpenModal()).toBeNull();
    releaseFirst();
    unsubscribe();
    pushOpenModal(first)();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(topmostOpenModal()).toBeNull();
  });

  it("moves a re-opened modal back to the top", () => {
    const a = { open: true, isConnected: true };
    const b = { open: true, isConnected: true };
    const releaseA = pushOpenModal(a);
    const releaseB = pushOpenModal(b);
    const releaseAgain = pushOpenModal(a);
    expect(topmostOpenModal()).toBe(a);
    releaseAgain();
    expect(topmostOpenModal()).toBe(b);
    releaseA();
    releaseB();
    expect(topmostOpenModal()).toBeNull();
  });
});

describe("toast layer placement", () => {
  let current: ReturnType<typeof setup> | null = null;
  afterEach(() => {
    current?.cleanup();
    current = null;
  });

  it("stays detached until attached, then shows as a click-through popover in <body>", () => {
    current = setup();
    const { doc, layer, host, container, live } = current;
    expect(host.isConnected).toBe(false);
    expect(host.getAttribute("popover")).toBe("manual");
    expect(host.className).toBe(TOAST_LAYER_CLASSES);
    expect(host.className).toContain("pointer-events-none");
    expect(container.parentNode).toBe(host);
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.className).toBe("sr-only");

    const detach = layer.attach();
    expect(host.parentNode).toBe(doc.body);
    expect(doc.topLayer).toEqual([host]);
    detach();
    expect(host.isConnected).toBe(false);
    expect(doc.topLayer).toEqual([]);
  });

  it("moves inside the topmost open modal and above it, and back out when it closes", () => {
    current = setup();
    const { doc, layer, host, openModal } = current;
    const detach = layer.attach();

    const drawer = openModal();
    // Inside the modal (so not inert) and painted above it and its backdrop.
    expect(host.parentNode).toBe(drawer.dialog);
    expect(doc.topLayer).toEqual([drawer.dialog, host]);

    // A confirm dialog opened from inside the drawer.
    const confirm = openModal(drawer.dialog);
    expect(host.parentNode).toBe(confirm.dialog);
    expect(doc.topLayer).toEqual([drawer.dialog, confirm.dialog, host]);

    confirm.close();
    expect(host.parentNode).toBe(drawer.dialog);
    expect(doc.topLayer).toEqual([drawer.dialog, host]);

    drawer.close();
    expect(host.parentNode).toBe(doc.body);
    expect(doc.topLayer).toEqual([host]);
    detach();
  });

  it("follows a dialog the browser closed before its owner released it", () => {
    current = setup();
    const { doc, layer, host, openModal } = current;
    const detach = layer.attach();
    const drawer = openModal();
    expect(host.parentNode).toBe(drawer.dialog);

    drawer.dialog.close(); // e.g. Escape pressed twice; the modal stack has not heard yet
    doc.dispatchClose();
    expect(host.parentNode).toBe(doc.body);
    expect(host.matches(":popover-open")).toBe(true);
    detach();
  });

  it("without the Popover API it is a plain fixed layer that still moves into the modal", () => {
    current = setup({ popover: false });
    const { doc, layer, host, openModal } = current;
    const detach = layer.attach();
    expect(host.getAttribute("popover")).toBeNull();
    expect(host.className).toContain("fixed");
    expect(host.className).toContain("z-50");

    const dialog = openModal();
    expect(host.parentNode).toBe(dialog.dialog);
    expect(doc.topLayer).toEqual([dialog.dialog]);
    detach();
  });

  it("falls back to the plain layer if showing the popover fails, instead of staying hidden", () => {
    current = setup();
    const { doc, layer, host } = current;
    doc.breakPopovers = true;
    const detach = layer.attach();
    expect(host.parentNode).toBe(doc.body);
    expect(host.getAttribute("popover")).toBeNull();
    detach();
  });

  it("stops following modals once detached", () => {
    current = setup();
    const { layer, host, openModal } = current;
    layer.attach()();
    openModal();
    expect(host.isConnected).toBe(false);
  });
});

describe("toast layer announcements", () => {
  let current: ReturnType<typeof setup> | null = null;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    current?.cleanup();
    current = null;
    vi.useRealTimers();
  });

  it("writes each message into the polite live region once the layer has settled, then clears it", () => {
    current = setup();
    const { layer, lines } = current;
    const detach = layer.attach();
    vi.advanceTimersByTime(1000);

    layer.announce("  Saved.  ");
    layer.announce("   ");
    expect(lines()).toEqual([]);
    vi.advanceTimersByTime(ANNOUNCE_SETTLE_MS);
    expect(lines()).toEqual(["Saved."]);

    vi.advanceTimersByTime(ANNOUNCEMENT_TTL_MS);
    expect(lines()).toEqual([]);
    detach();
  });

  it("waits for the layer to settle after a move: a toast fired as a nested confirm dialog closes", () => {
    current = setup();
    const { layer, host, lines, openModal } = current;
    const detach = layer.attach();
    const drawer = openModal();
    const confirm = openModal(drawer.dialog);
    vi.advanceTimersByTime(1000);

    // Same tick: the toast is queued, then the confirm dialog closes and the layer moves.
    layer.announce("Genre deactivated");
    vi.advanceTimersByTime(100);
    confirm.close();
    expect(host.parentNode).toBe(drawer.dialog);

    vi.advanceTimersByTime(ANNOUNCE_SETTLE_MS - 100);
    expect(lines()).toEqual([]); // not written while the region may still be "new"
    vi.advanceTimersByTime(100);
    expect(lines()).toEqual(["Genre deactivated"]);
    // Written inside the drawer, which is the part of the page that is not inert.
    expect(host.parentNode).toBe(drawer.dialog);
    detach();
  });

  it("keeps messages queued until attached and caps the region", () => {
    current = setup();
    const { layer, lines } = current;
    for (let index = 1; index <= MAX_ANNOUNCEMENT_LINES + 2; index++) layer.announce(`Message ${index}`);
    vi.advanceTimersByTime(ANNOUNCE_SETTLE_MS * 2);
    expect(lines()).toEqual([]);

    const detach = layer.attach();
    vi.advanceTimersByTime(ANNOUNCE_SETTLE_MS);
    expect(lines()).toHaveLength(MAX_ANNOUNCEMENT_LINES);
    expect(lines().at(-1)).toBe(`Message ${MAX_ANNOUNCEMENT_LINES + 2}`);

    detach();
    expect(lines()).toEqual([]);
  });
});

describe("toastAnnouncement", () => {
  it("reads the title, then the description", () => {
    expect(toastAnnouncement({ title: "Upload failed", description: "The file is not a valid MP3." })).toBe(
      "Upload failed. The file is not a valid MP3.",
    );
    expect(toastAnnouncement({ title: "Saved.", description: "Venues see it next time." })).toBe("Saved. Venues see it next time.");
    expect(toastAnnouncement({ title: " Genre list refreshed " })).toBe("Genre list refreshed");
    expect(toastAnnouncement({ title: "", description: "Only a description" })).toBe("Only a description");
  });
});

describe("ToastProvider on the server", () => {
  it("renders the app without a toast region (the layer is created in the browser)", () => {
    function UsesToasts() {
      const toast = useToast();
      return h("p", null, typeof toast.success === "function" ? "APP" : "missing");
    }
    const html = renderToString(h(ToastProvider, null, h(UsesToasts)));
    expect(html).toBe("<p>APP</p>");
  });
});
