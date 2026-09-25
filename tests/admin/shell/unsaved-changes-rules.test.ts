/**
 * NAV-01 / A11Y-06: the admin-wide unsaved-changes guard. Which link clicks are held back for
 * "Discard unsaved changes?", how several editors register, and the dialog wording.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAVE_MESSAGE,
  guardedLinkDestination,
  leaveMessages,
  UnsavedChangesRegistry,
  type GuardedClick,
  type GuardedLink,
} from "@/components/admin/shell/unsaved-changes-rules";

const HERE = "https://frekvencija.online/admin/music?genre=g1";
const PLAIN: GuardedClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

function link(href: string, extra: Partial<GuardedLink> = {}): GuardedLink {
  return { href, target: null, download: false, skip: false, ...extra };
}

describe("guardedLinkDestination", () => {
  it("holds back plain clicks on in-app links that leave the page", () => {
    // Sidebar, account menu, breadcrumbs, "Manage tracks"…
    expect(guardedLinkDestination(PLAIN, link("/admin/businesses"), HERE)).toBe("/admin/businesses");
    expect(guardedLinkDestination(PLAIN, link("/admin/genres?x=1#top"), HERE)).toBe("/admin/genres?x=1#top");
    expect(guardedLinkDestination(PLAIN, link("https://frekvencija.online/admin/settings"), HERE)).toBe("/admin/settings");
    // Relative hrefs resolve against the document.
    expect(guardedLinkDestination(PLAIN, link("../genres"), "https://frekvencija.online/admin/music/x")).toBe("/admin/genres");
    expect(guardedLinkDestination(PLAIN, link("/reset-password"), HERE)).toBe("/reset-password");
  });

  it("treats another query on the same path as leaving (e.g. another venue, or a remounting view)", () => {
    expect(guardedLinkDestination(PLAIN, link("/admin/music"), HERE)).toBe("/admin/music");
    expect(guardedLinkDestination(PLAIN, link("/admin/music?genre=g2"), HERE)).toBe("/admin/music?genre=g2");
    expect(
      guardedLinkDestination(PLAIN, link("/admin/announcements?business=b2"), "https://frekvencija.online/admin/announcements?business=b1"),
    ).toBe("/admin/announcements?business=b2");
  });

  it("leaves in-page anchors and links to the open page alone", () => {
    expect(guardedLinkDestination(PLAIN, link("#main-content"), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("/admin/music?genre=g1#main-content"), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("/admin/music?genre=g1"), `${HERE}#section`)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link(""), HERE)).toBeNull();
  });

  it("ignores modified clicks, other buttons and clicks someone else already handled", () => {
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(guardedLinkDestination({ ...PLAIN, [modifier]: true }, link("/admin/genres"), HERE)).toBeNull();
    }
    expect(guardedLinkDestination({ ...PLAIN, button: 1 }, link("/admin/genres"), HERE)).toBeNull();
    expect(guardedLinkDestination({ ...PLAIN, defaultPrevented: true }, link("/admin/genres"), HERE)).toBeNull();
  });

  it("ignores links that open elsewhere, downloads and opted-out links", () => {
    expect(guardedLinkDestination(PLAIN, link("/admin/genres", { target: "_blank" }), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("/admin/genres", { target: "preview" }), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("/admin/genres", { target: "_self" }), HERE)).toBe("/admin/genres");
    expect(guardedLinkDestination(PLAIN, link("/admin/genres", { target: " _SELF " }), HERE)).toBe("/admin/genres");
    expect(guardedLinkDestination(PLAIN, link("/api/admin/export.csv", { download: true }), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("/admin/music?page=2", { skip: true }), HERE)).toBeNull();
  });

  it("ignores other origins and non-web URLs", () => {
    expect(guardedLinkDestination(PLAIN, link("https://example.com/admin/genres"), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("//evil.example/x"), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("http://frekvencija.online/admin/genres"), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("mailto:owner@frekvencija.online"), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("tel:+38970000000"), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("javascript:void(0)"), HERE)).toBeNull();
    expect(guardedLinkDestination(PLAIN, link("http://[bad"), HERE)).toBeNull();
  });

  it("resolves against the document base URL when it differs from the page URL", () => {
    expect(guardedLinkDestination(PLAIN, link("genres"), HERE, "https://frekvencija.online/admin/")).toBe("/admin/genres");
  });
});

describe("UnsavedChangesRegistry", () => {
  it("counts every dirty editor, so one finishing does not clear the others", () => {
    const registry = new UnsavedChangesRegistry();
    expect(registry.dirty).toBe(false);

    const unregisterTrack = registry.register("track-editor");
    const unregisterUploads = registry.register("upload-queue", "2 uploads are still in progress.");
    expect(registry.size).toBe(2);
    expect(registry.dirty).toBe(true);

    unregisterTrack();
    expect(registry.size).toBe(1);
    expect(registry.dirty).toBe(true);

    unregisterUploads();
    expect(registry.dirty).toBe(false);
  });

  it("replaces an id registered again, and a stale unregister leaves the newer registration alone", () => {
    const registry = new UnsavedChangesRegistry();
    const first = registry.register("genre-editor", "Your changes to “Jazz” haven’t been saved.");
    const second = registry.register("genre-editor", "Your changes to “Smooth Jazz” haven’t been saved.");
    expect(registry.size).toBe(1);
    expect(registry.messages()).toEqual(["Your changes to “Smooth Jazz” haven’t been saved."]);

    first();
    expect(registry.dirty).toBe(true);
    second();
    expect(registry.dirty).toBe(false);
    // Unregistering twice is harmless.
    second();
    expect(registry.size).toBe(0);
  });

  it("lists distinct, non-blank messages in registration order", () => {
    const registry = new UnsavedChangesRegistry();
    registry.register("a", "Your edits to “Afterglow” haven’t been saved.");
    registry.register("b");
    registry.register("c", "   ");
    registry.register("d", "2 uploads are still in progress.");
    registry.register("e", "Your edits to “Afterglow” haven’t been saved.");
    expect(registry.size).toBe(5);
    expect(registry.messages()).toEqual(["Your edits to “Afterglow” haven’t been saved.", "2 uploads are still in progress."]);
  });
});

describe("leaveMessages", () => {
  it("falls back to the generic sentence when no editor explains itself", () => {
    expect(leaveMessages([])).toEqual([DEFAULT_LEAVE_MESSAGE]);
    expect(leaveMessages(["  "])).toEqual([DEFAULT_LEAVE_MESSAGE]);
    expect(leaveMessages(["A.", " A. ", "B."])).toEqual(["A.", "B."]);
  });
});
