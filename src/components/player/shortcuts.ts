/**
 * Keyboard shortcut matching for the player page (docs/research/browser-audio.md §9): Space/K
 * play-pause, M mute, N skip. Pure and DOM-light so it can be unit-tested without a browser.
 *
 * A shortcut never fires while the key belongs to something else: typing in a field or editable
 * content, moving through an open menu, listbox or dialog (their own first-letter typeahead), or
 * any chord with Ctrl, Alt, Meta or Shift.
 */

export type PlayerShortcut = "toggle" | "mute" | "skip";

/** The parts of a KeyboardEvent the matcher reads. */
export interface ShortcutKeyEvent {
  key: string;
  defaultPrevented: boolean;
  repeat: boolean;
  isComposing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: unknown;
}

interface ClosestCapable {
  closest(selectors: string): unknown;
}

/** Targets where typing must never trigger a shortcut. */
const TEXT_ENTRY_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"], [role="slider"]';

/**
 * Widgets that own printable keys (first-letter typeahead) or trap focus: a key pressed inside
 * them is theirs, even when they do not call preventDefault (e.g. the account menu on /radio).
 */
const POPUP_SELECTOR = '[role="menu"], [role="menubar"], [role="listbox"], [role="dialog"], [role="alertdialog"], dialog';

/** Targets that Space activates themselves: handling Space too would toggle twice. */
const SPACE_ACTIVATES_SELECTOR =
  'button, a[href], summary, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="tab"], [role="option"]';

/** Anything that shows an open menu, listbox or dialog: a popup trigger that is expanded, or the popup itself. */
const OPEN_POPUP_SELECTOR = '[role="menu"], [aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]';

function asClosestCapable(target: unknown): ClosestCapable | null {
  if (typeof target !== "object" || target === null) return null;
  return typeof (target as { closest?: unknown }).closest === "function" ? (target as ClosestCapable) : null;
}

function matches(target: ClosestCapable | null, selector: string): boolean {
  if (!target) return false;
  try {
    return Boolean(target.closest(selector));
  } catch {
    return false;
  }
}

/** Editable through an inherited contenteditable too (HTMLElement.isContentEditable). */
function isEditable(target: unknown): boolean {
  return typeof target === "object" && target !== null && (target as { isContentEditable?: unknown }).isContentEditable === true;
}

/** Map a keydown to a player command, or null when the key belongs to something else. */
export function playerShortcutFor(event: ShortcutKeyEvent): PlayerShortcut | null {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const target = asClosestCapable(event.target);
  if (isEditable(event.target) || matches(target, TEXT_ENTRY_SELECTOR) || matches(target, POPUP_SELECTOR)) return null;
  if (event.key === " " || event.key === "Spacebar") {
    return matches(target, SPACE_ACTIVATES_SELECTOR) ? null : "toggle";
  }
  switch (event.key.toLowerCase()) {
    case "k":
      return "toggle";
    case "m":
      return "mute";
    case "n":
      return "skip";
    default:
      return null;
  }
}

/** True while a modal dialog is open (the UI kit's Dialog sets aria-modal="true" only while open). */
export function isModalDialogOpen(root: { querySelector(selectors: string): unknown } | null | undefined): boolean {
  if (!root) return false;
  try {
    return root.querySelector('[aria-modal="true"], dialog[open]:modal') !== null;
  } catch {
    // `:modal` is unknown to very old engines: fall back to the attribute alone.
    return root.querySelector('[aria-modal="true"]') !== null;
  }
}

/**
 * True while a menu, listbox or other popup is open anywhere on the page (e.g. the account menu
 * opened with the mouse while focus stayed elsewhere): its keys are not the player's.
 */
export function isPopupOpen(root: { querySelector(selectors: string): unknown } | null | undefined): boolean {
  if (!root) return false;
  try {
    return root.querySelector(OPEN_POPUP_SELECTOR) !== null;
  } catch {
    return false;
  }
}

/** Key list shown next to the shortcuts switch. */
export const PLAYER_SHORTCUT_KEYS: readonly { keys: readonly string[]; action: string }[] = [
  { keys: ["Space", "K"], action: "Play / pause" },
  { keys: ["M"], action: "Mute / unmute" },
  { keys: ["N"], action: "Skip to the next song (music only)" },
];
