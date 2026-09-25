import { describe, expect, it } from "vitest";
import {
  ADMIN_HOME_PATH,
  ADMIN_NAV_ITEMS,
  ADMIN_SECONDARY_NAV_ITEMS,
  adminNavItemState,
} from "@/components/admin/shell/nav-items";

const item = (href: string) => {
  const found = [...ADMIN_NAV_ITEMS, ...ADMIN_SECONDARY_NAV_ITEMS].find((entry) => entry.href === href);
  if (!found) throw new Error(`no nav item ${href}`);
  return found;
};

describe("admin navigation model (screens 05–08)", () => {
  it("lists Music library, Genres, Businesses and Announcements, with Settings at the bottom", () => {
    expect(ADMIN_NAV_ITEMS.map((entry) => [entry.label, entry.href])).toEqual([
      ["Music library", "/admin/music"],
      ["Genres", "/admin/genres"],
      ["Businesses", "/admin/businesses"],
      ["Announcements", "/admin/announcements"],
    ]);
    expect(ADMIN_SECONDARY_NAV_ITEMS.map((entry) => entry.href)).toEqual(["/admin/settings"]);
  });

  it("starts the workspace in the music library", () => {
    expect(ADMIN_HOME_PATH).toBe("/admin/music");
  });
});

describe("adminNavItemState", () => {
  it("marks a section for its nested pages", () => {
    expect(adminNavItemState("/admin/businesses", item("/admin/businesses"))).toBe("page");
    expect(adminNavItemState("/admin/businesses/", item("/admin/businesses"))).toBe("page");
    expect(adminNavItemState("/admin/businesses/42", item("/admin/businesses"))).toBe("section");
    expect(adminNavItemState("/admin/businesses-archive", item("/admin/businesses"))).toBeNull();
    expect(adminNavItemState("/admin/music", item("/admin/genres"))).toBeNull();
  });

  it("handles a missing pathname", () => {
    expect(adminNavItemState(null, item("/admin/music"))).toBeNull();
  });
});
