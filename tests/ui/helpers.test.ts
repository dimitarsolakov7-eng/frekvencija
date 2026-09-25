import { createElement, isValidElement } from "react";
import { Music } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_HOME_PATH,
  ADMIN_NAV_ITEMS,
  ADMIN_SECONDARY_NAV_ITEMS,
  adminNavItemState,
} from "@/components/admin/shell/nav-items";
import { ariaCurrentFor, navItemState, normalizePath } from "@/components/shell/nav-state";
import {
  AVATAR_AUTO_TONES,
  GENRE_CHIP_TONES,
  avatarAutoToneClasses,
  computeMenuPosition,
  genreChipTone,
  renderIcon,
  waveformHeights,
} from "@/components/ui";
import { restoreFocus } from "@/components/ui/internal/use-modal-dialog";

describe("genreChipTone", () => {
  it("is deterministic and ignores case/whitespace", () => {
    expect(genreChipTone("house")).toBe(genreChipTone("house"));
    expect(genreChipTone("House")).toBe(genreChipTone("  house "));
    expect(GENRE_CHIP_TONES).toContain(genreChipTone("deep-house"));
  });

  it("returns a tone for missing keys", () => {
    expect(GENRE_CHIP_TONES).toContain(genreChipTone(undefined));
    expect(genreChipTone(null)).toBe(genreChipTone(""));
  });

  it("uses every tone across many genres", () => {
    const tones = new Set(Array.from({ length: 300 }, (_, index) => genreChipTone(`genre-${index}`)));
    expect(tones.size).toBe(GENRE_CHIP_TONES.length);
  });
});

describe("avatarAutoToneClasses", () => {
  it("picks a stable palette entry per name", () => {
    expect(avatarAutoToneClasses("EmeraldBar")).toBe(avatarAutoToneClasses("emeraldbar"));
    expect(AVATAR_AUTO_TONES).toContain(avatarAutoToneClasses("Hotel Aurora"));
  });
});

describe("waveformHeights", () => {
  it("returns the requested number of bars within 0.12–1", () => {
    const heights = waveformHeights(40, "voice");
    expect(heights).toHaveLength(40);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(0.12);
      expect(height).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic per seed and count", () => {
    expect(waveformHeights(24, "a")).toEqual(waveformHeights(24, "a"));
    expect(waveformHeights(24, "a")).not.toEqual(waveformHeights(24, "b"));
    expect(waveformHeights(24)).toEqual(waveformHeights(24, "frekvencija"));
  });

  it("handles degenerate counts", () => {
    expect(waveformHeights(0)).toEqual([]);
    expect(waveformHeights(-3)).toEqual([]);
    expect(waveformHeights(2.9)).toHaveLength(2);
    expect(waveformHeights(1)).toHaveLength(1);
  });
});

describe("computeMenuPosition", () => {
  const viewport = { width: 1000, height: 800 };
  const trigger = { top: 100, bottom: 140, left: 600, right: 644 };
  const menu = { width: 220, height: 180 };

  it("opens below, aligned to the trigger's end edge", () => {
    expect(computeMenuPosition(trigger, menu, viewport, { align: "end", side: "bottom" })).toEqual({
      top: 146,
      left: 424,
      side: "bottom",
    });
  });

  it("aligns to the start edge when asked", () => {
    expect(computeMenuPosition(trigger, menu, viewport, { align: "start", side: "bottom" }).left).toBe(600);
  });

  it("flips above when there is no room below", () => {
    const low = { top: 700, bottom: 740, left: 600, right: 644 };
    expect(computeMenuPosition(low, menu, viewport, { align: "end", side: "bottom" })).toEqual({
      top: 514,
      left: 424,
      side: "top",
    });
  });

  it("keeps the preferred side when the other side is even smaller", () => {
    const tall = { width: 220, height: 900 };
    const result = computeMenuPosition(trigger, tall, viewport, { align: "end", side: "bottom" });
    expect(result.side).toBe("bottom");
    // Clamped inside the viewport margin.
    expect(result.top).toBe(8);
  });

  it("clamps horizontally inside the viewport", () => {
    const edge = { top: 100, bottom: 140, left: 10, right: 40 };
    expect(computeMenuPosition(edge, menu, viewport, { align: "end", side: "bottom" }).left).toBe(8);
    const right = { top: 100, bottom: 140, left: 960, right: 990 };
    expect(computeMenuPosition(right, menu, viewport, { align: "start", side: "bottom" }).left).toBe(772);
  });
});

describe("navItemState", () => {
  it("normalises paths", () => {
    expect(normalizePath("/admin/music/")).toBe("/admin/music");
    expect(normalizePath("/admin/music?genre=1#top")).toBe("/admin/music");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });

  it("marks the page and, for prefix items, nested pages", () => {
    expect(navItemState("/admin/businesses", "/admin/businesses")).toBe("page");
    expect(navItemState("/admin/businesses/", "/admin/businesses")).toBe("page");
    expect(navItemState("/admin/businesses/42", "/admin/businesses")).toBe("section");
    expect(navItemState("/admin/businesses/42", "/admin/businesses", "exact")).toBeNull();
    expect(navItemState("/admin/businesses-archive", "/admin/businesses")).toBeNull();
    expect(navItemState("/radio", "/")).toBeNull();
    expect(navItemState(null, "/radio")).toBeNull();
  });

  it("maps states to aria-current values", () => {
    expect(ariaCurrentFor("page")).toBe("page");
    expect(ariaCurrentFor("section")).toBe("true");
    expect(ariaCurrentFor(null)).toBeUndefined();
  });
});

describe("admin navigation model", () => {
  it("lists Music library, Genres, Businesses and Announcements, then Settings", () => {
    expect(ADMIN_NAV_ITEMS.map((item) => [item.label, item.href])).toEqual([
      ["Music library", "/admin/music"],
      ["Genres", "/admin/genres"],
      ["Businesses", "/admin/businesses"],
      ["Announcements", "/admin/announcements"],
    ]);
    expect(ADMIN_SECONDARY_NAV_ITEMS.map((item) => [item.label, item.href])).toEqual([["Settings", "/admin/settings"]]);
    expect(ADMIN_HOME_PATH).toBe("/admin/music");
  });

  it("marks sections for nested admin pages", () => {
    const businesses = ADMIN_NAV_ITEMS[2];
    expect(adminNavItemState("/admin/businesses", businesses)).toBe("page");
    expect(adminNavItemState("/admin/businesses/new", businesses)).toBe("section");
    expect(adminNavItemState("/admin/music", businesses)).toBeNull();
    expect(adminNavItemState(null, businesses)).toBeNull();
  });
});

describe("renderIcon", () => {
  it("creates an aria-hidden element from a component icon", () => {
    const node = renderIcon(Music, "size-5");
    expect(isValidElement(node)).toBe(true);
    const props = (node as { props: { className?: string; "aria-hidden"?: boolean } }).props;
    expect(props.className).toBe("size-5");
    expect(props["aria-hidden"]).toBe(true);
  });

  it("passes elements and plain nodes through", () => {
    const element = createElement(Music);
    expect(renderIcon(element)).toBe(element);
    expect(renderIcon("★")).toBe("★");
    expect(renderIcon(undefined)).toBeNull();
    expect(renderIcon(null)).toBeNull();
  });
});

describe("restoreFocus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(active: unknown) {
    const body = { isConnected: true };
    vi.stubGlobal("document", { body, activeElement: active === "body" ? body : active });
    const inside = { isConnected: true };
    const dialog = { contains: (node: unknown) => node === inside } as unknown as HTMLDialogElement;
    const target = { isConnected: true, focus: vi.fn() };
    return { dialog, inside, target, asTarget: target as unknown as HTMLElement };
  }

  it("returns focus when it is on <body> or still inside the closing dialog", () => {
    const onBody = setup("body");
    restoreFocus(onBody.asTarget, onBody.dialog);
    expect(onBody.target.focus).toHaveBeenCalledOnce();

    const fromInside = setup(null);
    vi.stubGlobal("document", { body: {}, activeElement: fromInside.inside });
    restoreFocus(fromInside.asTarget, fromInside.dialog);
    expect(fromInside.target.focus).toHaveBeenCalledOnce();
  });

  it("returns focus when the focused element was removed (dialog unmounted while open)", () => {
    const removed = { isConnected: false };
    const { asTarget, target, dialog } = setup(removed);
    restoreFocus(asTarget, dialog);
    expect(target.focus).toHaveBeenCalledOnce();
  });

  it("leaves focus alone when the user already moved it elsewhere, or the opener is gone", () => {
    const elsewhere = { isConnected: true };
    const first = setup(elsewhere);
    restoreFocus(first.asTarget, first.dialog);
    expect(first.target.focus).not.toHaveBeenCalled();

    const second = setup("body");
    second.target.isConnected = false;
    restoreFocus(second.asTarget, second.dialog);
    expect(second.target.focus).not.toHaveBeenCalled();

    const third = setup("body");
    restoreFocus(null, third.dialog);
    expect(third.target.focus).not.toHaveBeenCalled();
  });
});
