/**
 * The modal <dialog>s opened through useModalDialog (<Dialog>, <ConfirmDialog>, <Drawer>), in the
 * order they were shown, which is also their top-layer order.
 *
 * While a modal dialog is open the browser makes everything outside the topmost one inert: it can
 * be neither clicked nor focused, and it leaves the accessibility tree (live regions included).
 * UI that must stay usable on top of a modal, such as the toast layer, therefore follows the
 * topmost open dialog.
 */

/** The parts of a <dialog> the stack relies on (lets tests use plain objects). */
export type ModalDialogLike = Pick<HTMLDialogElement, "open" | "isConnected">;

type Listener = () => void;

const openModals: ModalDialogLike[] = [];
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of Array.from(listeners)) listener();
}

function remove(dialog: ModalDialogLike): boolean {
  const index = openModals.indexOf(dialog);
  if (index === -1) return false;
  openModals.splice(index, 1);
  return true;
}

/**
 * Records `dialog` as the topmost modal (call it right after showModal()). Returns the release
 * function to call once the dialog has closed; releasing twice is harmless.
 */
export function pushOpenModal<T extends ModalDialogLike>(dialog: T): () => void {
  remove(dialog);
  openModals.push(dialog);
  notify();
  return () => {
    if (remove(dialog)) notify();
  };
}

/** The most recently shown modal that is still open and in the document, or null. */
export function topmostOpenModal<T extends ModalDialogLike = HTMLDialogElement>(): T | null {
  for (let index = openModals.length - 1; index >= 0; index--) {
    const dialog = openModals[index];
    if (dialog.open && dialog.isConnected) return dialog as T;
  }
  return null;
}

/** Calls `listener` whenever a modal opens or closes. Returns the unsubscribe function. */
export function subscribeToOpenModals(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
