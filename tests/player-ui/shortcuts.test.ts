import { describe, expect, it } from "vitest";
import { isModalDialogOpen, isPopupOpen, playerShortcutFor, type ShortcutKeyEvent } from "@/components/player/shortcuts";

/** A minimal element stand-in: `closest` answers true when any listed selector part is in `matches`. */
function element(matches: readonly string[]) {
  return {
    closest(selectors: string) {
      const parts = selectors.split(",").map((part) => part.trim());
      return parts.some((part) => matches.includes(part)) ? this : null;
    },
  };
}

const body = element([]);
const button = element(["button"]);
const link = element(["a[href]"]);
const textInput = element(["input"]);
const range = element(["input", '[role="slider"]']);
const switchControl = element(['[role="switch"]']);
const editable = element(['[contenteditable="true"]']);
const plainEditable = element(['[contenteditable="plaintext-only"]']);
/** A menu item of an open menu (e.g. "Account" in the venue account menu on /radio). */
const menuItem = element(['[role="menuitem"]', "button", '[role="menu"]']);
const listboxOption = element(['[role="option"]', '[role="listbox"]']);
const insideDialog = element(["button", '[role="dialog"]']);
const insideNativeDialog = element(["a[href]", "dialog"]);

function key(k: string, overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    key: k,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: body,
    ...overrides,
  };
}

describe("playerShortcutFor", () => {
  it("maps Space/K, M and N (case-insensitive)", () => {
    expect(playerShortcutFor(key(" "))).toBe("toggle");
    expect(playerShortcutFor(key("k"))).toBe("toggle");
    expect(playerShortcutFor(key("K"))).toBe("toggle");
    expect(playerShortcutFor(key("m"))).toBe("mute");
    expect(playerShortcutFor(key("M"))).toBe("mute");
    expect(playerShortcutFor(key("n"))).toBe("skip");
    expect(playerShortcutFor(key("N"))).toBe("skip");
    expect(playerShortcutFor(key("x"))).toBeNull();
    expect(playerShortcutFor(key("Enter"))).toBeNull();
  });

  it("ignores keys typed into text fields, sliders and editable content", () => {
    for (const target of [textInput, range, editable]) {
      expect(playerShortcutFor(key(" ", { target }))).toBeNull();
      expect(playerShortcutFor(key("k", { target }))).toBeNull();
      expect(playerShortcutFor(key("m", { target }))).toBeNull();
    }
  });

  it("leaves Space to buttons, links and switches (they activate themselves) but still maps letters there", () => {
    for (const target of [button, link, switchControl]) {
      expect(playerShortcutFor(key(" ", { target }))).toBeNull();
      expect(playerShortcutFor(key("k", { target }))).toBe("toggle");
      expect(playerShortcutFor(key("n", { target }))).toBe("skip");
    }
  });

  it("ignores chords, auto-repeat, IME composition and already-handled events", () => {
    expect(playerShortcutFor(key("k", { ctrlKey: true }))).toBeNull();
    expect(playerShortcutFor(key("k", { metaKey: true }))).toBeNull();
    expect(playerShortcutFor(key("m", { altKey: true }))).toBeNull();
    expect(playerShortcutFor(key(" ", { repeat: true }))).toBeNull();
    expect(playerShortcutFor(key("n", { isComposing: true }))).toBeNull();
    expect(playerShortcutFor(key("n", { defaultPrevented: true }))).toBeNull();
  });

  it("ignores Shift chords too (any modifier key means the key is not a player shortcut)", () => {
    expect(playerShortcutFor(key("N", { shiftKey: true }))).toBeNull();
    expect(playerShortcutFor(key("M", { shiftKey: true }))).toBeNull();
    expect(playerShortcutFor(key(" ", { shiftKey: true }))).toBeNull();
    expect(playerShortcutFor(key("N"))).toBe("skip"); // Caps Lock: an upper-case key without Shift
  });

  it("A11Y-11: leaves every key to an open menu, listbox or dialog that has focus (their typeahead)", () => {
    for (const target of [menuItem, listboxOption, insideDialog, insideNativeDialog]) {
      for (const k of [" ", "k", "K", "m", "n"]) expect(playerShortcutFor(key(k, { target }))).toBeNull();
    }
  });

  it("ignores keys in any editable content, including inherited and plaintext-only editing", () => {
    expect(playerShortcutFor(key("m", { target: plainEditable }))).toBeNull();
    const inheritedEditable = { ...element([]), isContentEditable: true };
    expect(playerShortcutFor(key("n", { target: inheritedEditable }))).toBeNull();
    expect(playerShortcutFor(key("n", { target: { ...element([]), isContentEditable: false } }))).toBe("skip");
  });

  it("treats a target without closest() (document, window) like the page body", () => {
    expect(playerShortcutFor(key(" ", { target: null }))).toBe("toggle");
    expect(playerShortcutFor(key("m", { target: {} }))).toBe("mute");
  });
});

describe("isModalDialogOpen", () => {
  it("detects an element with aria-modal=true", () => {
    expect(isModalDialogOpen({ querySelector: (selector) => (selector.includes('[aria-modal="true"]') ? {} : null) })).toBe(true);
    expect(isModalDialogOpen({ querySelector: () => null })).toBe(false);
    expect(isModalDialogOpen(null)).toBe(false);
  });

  it("falls back to the attribute selector when :modal is not supported", () => {
    const root = {
      querySelector(selector: string) {
        if (selector.includes(":modal")) throw new SyntaxError("unknown pseudo-class");
        return selector === '[aria-modal="true"]' ? {} : null;
      },
    };
    expect(isModalDialogOpen(root)).toBe(true);
  });
});

describe("isPopupOpen (A11Y-11)", () => {
  it("detects an open menu or an expanded popup trigger anywhere on the page", () => {
    const querying = (present: string | null) => ({
      querySelector: (selector: string) => (present !== null && selector.split(",").map((part) => part.trim()).includes(present) ? {} : null),
    });
    expect(isPopupOpen(querying('[role="menu"]'))).toBe(true);
    expect(isPopupOpen(querying('[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]'))).toBe(true);
    expect(isPopupOpen(querying(null))).toBe(false);
    expect(isPopupOpen(null)).toBe(false);
    expect(
      isPopupOpen({
        querySelector: () => {
          throw new SyntaxError("unsupported");
        },
      }),
    ).toBe(false);
  });
});
