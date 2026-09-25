/**
 * Server-render smoke tests for the design-system primitives, the app shell and the admin shell:
 * they must render without a browser and carry the accessible structure they promise.
 */
import { createElement as h, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { Music, Radio, Settings, User } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import AdminError from "@/app/admin/error";
import AdminLoading from "@/app/admin/loading";
import AdminIndexPage from "@/app/admin/page";
import { AdminShell } from "@/components/admin/shell";
import {
  AppShell,
  MobileTabBar,
  MobileTopBar,
  PageHeading,
  SidebarBrand,
  SidebarButton,
  SidebarIdentity,
  SidebarNav,
  SidebarSection,
  UserMenu,
} from "@/components/shell";
import {
  Accordion,
  Avatar,
  CoverImage,
  Dialog,
  Drawer,
  DropdownMenu,
  GenreChip,
  PasswordInput,
  SearchInput,
  SegmentedTabs,
  StatusPill,
  TR,
  Waveform,
  genreChipTone,
} from "@/components/ui";

const render = (element: ReactElement, pathname = "/") => renderToString(h(PathnameContext, { value: pathname }, element));

/** The opening tag of the first element whose opening tag contains `needle`. */
function tagWith(html: string, needle: string): string {
  const index = html.indexOf(needle);
  if (index === -1) return "";
  const start = html.lastIndexOf("<", index);
  const end = html.indexOf(">", index);
  return html.slice(start, end + 1);
}

/** The opening <a> tag with exactly this href (attribute order independent). */
function linkTo(html: string, href: string): string {
  return html.match(/<a\b[^>]*>/g)?.find((tag) => tag.includes(` href="${href}"`)) ?? "";
}

/** The <form …> opening tag posting to `action`, followed by its first control's opening tag. */
function postForm(html: string, action: string): { form: string; next: string } {
  const match = html.match(new RegExp(`(<form\\b[^>]*action="${action.replace(/\//g, "\\/")}"[^>]*>)(<[a-z]+\\b[^>]*>)?`));
  return { form: match?.[1] ?? "", next: match?.[2] ?? "" };
}

describe("admin shell", () => {
  const shell = (pathname: string) =>
    render(h(AdminShell, { email: "admin@example.com", children: h("p", null, "page content") }), pathname);

  it("renders the skip link first, the main landmark and the page content", () => {
    const html = shell("/admin/music");
    expect(html.indexOf('href="#main-content"')).toBeGreaterThan(-1);
    expect(html.indexOf('href="#main-content"')).toBeLessThan(html.indexOf("<nav"));
    expect(tagWith(html, 'id="main-content"')).toMatch(/^<main[^>]*tabindex="-1"/i);
    expect(html).toContain("page content");
  });

  it("shows the logo, the workspace eyebrow and the four sections with the current one marked", () => {
    const html = shell("/admin/music");
    expect(html).toContain('alt="Frekvencija"');
    expect(html).toContain("Admin workspace");
    expect(html).toContain('<nav aria-label="Admin"');
    for (const [href, label] of [
      ["/admin/music", "Music library"],
      ["/admin/genres", "Genres"],
      ["/admin/businesses", "Businesses"],
      ["/admin/announcements", "Announcements"],
    ]) {
      expect(html).toContain(`href="${href}"`);
      expect(html).toContain(label);
    }
    const musicLinks = html.match(/<a\b[^>]*href="\/admin\/music"[^>]*>/g) ?? [];
    // The sidebar logo and the mobile logo link home too, without aria-current.
    expect(musicLinks.some((tag) => tag.includes('aria-current="page"'))).toBe(true);
    expect(linkTo(html, "/admin/genres")).not.toContain("aria-current");
  });

  it("marks the section for nested pages", () => {
    const html = shell("/admin/businesses/b1");
    expect(linkTo(html, "/admin/businesses")).toContain('aria-current="true"');
  });

  it("offers Settings, a POST sign-out form and the Administrator account menu", () => {
    const html = shell("/admin/settings");
    expect(linkTo(html, "/admin/settings")).toContain('aria-current="page"');
    const signOut = postForm(html, "/auth/signout");
    expect(signOut.form).toContain('method="post"');
    expect(signOut.next).toMatch(/^<button type="submit"/);
    expect(html).toContain(">Sign out<");
    const menuTrigger = tagWith(html, 'aria-label="Administrator, account menu"');
    expect(menuTrigger).toContain('aria-haspopup="menu"');
    expect(menuTrigger).toContain('aria-expanded="false"');
    // The menu's own sign-out item posts a hidden form (the menu itself is closed).
    const hiddenForms = (html.match(/<form\b[^>]*>/g) ?? []).filter((tag) => tag.includes('hidden=""'));
    expect(hiddenForms.some((tag) => tag.includes('action="/auth/signout"') && tag.includes('method="post"'))).toBe(true);
    expect(html).not.toContain('role="menu"');
  });

  it("gives smaller screens a menu button for the navigation drawer", () => {
    const html = shell("/admin/music");
    const button = tagWith(html, 'aria-label="Open menu"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
  });
});

describe("admin routes", () => {
  it("/admin redirects to the music library", () => {
    let caught: unknown;
    try {
      AdminIndexPage();
    } catch (error) {
      caught = error;
    }
    expect(String((caught as { digest?: string }).digest)).toContain("/admin/music");
  });

  it("loading skeleton announces loading", () => {
    expect(render(AdminLoading())).toContain('role="status"');
  });

  it("error boundary explains the failure and offers a retry inside the shell", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = render(h(AdminError, { error: Object.assign(new Error("db down"), { digest: "abc123" }), retry: () => {} }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
    expect(html).toContain("abc123");
    expect(html).toContain('href="/admin/music"');
    expect(html).not.toContain("db down");
  });
});

describe("AppShell", () => {
  const sidebar = h(SidebarBrand, { href: "/radio", eyebrow: "Your station" });

  it("stacks the player bar above the tab bar in one sticky bottom region", () => {
    const html = render(
      h(AppShell, {
        sidebar,
        mobileHeader: h(MobileTopBar, { href: "/radio" }),
        mobileNav: h(MobileTabBar, {
          items: [
            { href: "/radio", label: "Radio", icon: Radio },
            { href: "/account", label: "Account", icon: User },
          ],
        }),
        playerBar: h("div", null, "PLAYER"),
        children: h("p", null, "CONTENT"),
      }),
      "/radio",
    );
    const bottom = html.indexOf("data-shell-bottom");
    expect(bottom).toBeGreaterThan(html.indexOf("CONTENT"));
    expect(html.indexOf("data-shell-player")).toBeGreaterThan(bottom);
    expect(html.indexOf("PLAYER")).toBeLessThan(html.indexOf("data-shell-tabbar"));
    expect(tagWith(html, "data-shell-bottom")).toContain("sticky");
    const radioLinks = html.match(/<a\b[^>]*href="\/radio"[^>]*>/g) ?? [];
    expect(radioLinks.some((tag) => tag.includes('aria-current="page"'))).toBe(true);
    expect(html).toContain('<nav aria-label="Main"');
    expect(tagWith(html, "data-shell-header")).toMatch(/^<header/);
  });

  it("omits the bottom region without player or tabs and pads for the safe area instead", () => {
    const html = render(h(AppShell, { sidebar, mobileHeader: null, children: "x" }));
    expect(html).not.toContain("data-shell-bottom");
    expect(tagWith(html, 'id="main-content"')).toContain("safe-area-inset-bottom");
  });

  it("renders the desktop top bar only when given", () => {
    const withTopBar = render(h(AppShell, { sidebar, mobileHeader: null, topBar: h("span", null, "TOPBAR"), children: "x" }));
    expect(withTopBar).toContain("TOPBAR");
    expect(render(h(AppShell, { sidebar, mobileHeader: null, children: "x" }))).not.toContain("TOPBAR");
  });
});

describe("shell pieces", () => {
  it("SidebarNav accepts component and element icons and marks exact matches only", () => {
    const html = render(
      h(SidebarNav, {
        label: "Main",
        items: [
          { href: "/radio", label: "Your radio", icon: Radio, match: "exact" },
          { href: "/account", label: "Account", icon: h(User) },
        ],
      }),
      "/radio/extra",
    );
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).not.toContain("aria-current");
  });

  it("SidebarButton renders a link, a form POST or a button", () => {
    expect(render(h(SidebarButton, { href: "/help", label: "Help" }), "/help")).toContain('aria-current="page"');
    const signOut = postForm(render(h(SidebarButton, { action: "/auth/signout", label: "Sign out" })), "/auth/signout");
    expect(signOut.form).toContain('method="post"');
    expect(signOut.next).toMatch(/^<button type="submit"/);
    expect(render(h(SidebarButton, { label: "Sign out" }))).toMatch(/<button type="button"/);
    expect(render(h(SidebarSection, { label: "Account", children: "x" }))).toContain('<nav aria-label="Account"');
  });

  it("SidebarIdentity shows the venue name with a decorative initials avatar", () => {
    const html = render(h(SidebarIdentity, { name: "EmeraldBar", subtitle: "EmeraldBar Radio" }));
    expect(html).toContain("EmeraldBar Radio");
    expect(html).toMatch(/aria-hidden="true"[^>]*>EB</);
  });

  it("UserMenu names its trigger with the visible name and keeps items out of the DOM while closed", () => {
    const html = render(
      h(UserMenu, {
        name: "EmeraldBar",
        email: "manager@emeraldbar.example",
        items: [{ label: "Account", href: "/account", icon: Settings }],
      }),
    );
    expect(html).toContain('aria-label="EmeraldBar, account menu"');
    expect(html).not.toContain("manager@emeraldbar.example");
    expect(html).not.toContain('href="/account"');
  });

  it("PageHeading renders eyebrow, h1, description and actions", () => {
    const html = render(
      h(PageHeading, {
        eyebrow: "Your station",
        title: "EmeraldBar Radio",
        description: "Choose the sound for your space.",
        actions: h("button", null, "ACTION"),
      }),
    );
    expect(html).toMatch(/<p class="eyebrow[^"]*">Your station<\/p>/);
    expect(html).toMatch(/<h1 class="page-title[^"]*">EmeraldBar Radio<\/h1>/);
    expect(html).toContain("Choose the sound for your space.");
    expect(html).toContain("ACTION");
  });
});

describe("primitives", () => {
  it("StatusPill shows its label with a decorative dot", () => {
    const html = render(h(StatusPill, { tone: "success", children: "Active" }));
    expect(html).toContain("Active");
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*bg-accent/);
    expect(render(h(StatusPill, { tone: "warning", label: "Invited" }))).toContain("Invited");
  });

  it("GenreChip colours by genre key (falling back to the name)", () => {
    const tone = genreChipTone("house");
    expect(render(h(GenreChip, { genreKey: "house", name: "House" }))).toContain(`bg-${tone}-400/10`);
    expect(render(h(GenreChip, { children: "House" }))).toContain(`bg-${genreChipTone("House")}-400/10`);
    expect(render(h(GenreChip, { tone: "rose", name: "Balkan Hits" }))).toContain("bg-rose-400/10");
  });

  it("Avatar renders initials as an image role, or decoratively", () => {
    expect(render(h(Avatar, { name: "EmeraldBar" }))).toMatch(/role="img" aria-label="EmeraldBar"[^>]*>EB</);
    expect(render(h(Avatar, { name: "Administrator", initials: "A", decorative: true }))).toMatch(
      /aria-hidden="true"[^>]*>A</,
    );
    expect(render(h(Avatar, { name: "Logo", src: "https://example.com/logo.png" }))).toMatch(/<img[^>]*alt="Logo"/);
  });

  it("Waveform is decorative and renders one bar per count", () => {
    const html = render(h(Waveform, { bars: 12, seed: "x", progress: 0.5 }));
    expect(html.startsWith('<span aria-hidden="true"')).toBe(true);
    expect(html.match(/rounded-full/g)).toHaveLength(12);
    expect(html.match(/bg-fg-muted\/35/g)).toHaveLength(6);
  });

  it("Accordion uses native details/summary, exclusive via a shared name", () => {
    const html = render(
      h(Accordion, {
        exclusive: true,
        items: [
          { id: "a", title: "Can I change the music?", content: "Choose another genre whenever you like.", defaultOpen: true },
          { id: "b", title: "Q2", content: "A2" },
        ],
      }),
    );
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html.match(/<summary/g)).toHaveLength(2);
    expect(tagWith(html, 'id="a"')).toContain('open=""');
    expect(tagWith(html, 'id="b"')).not.toContain("open");
    const names = [...html.matchAll(/<details[^>]*name="([^"]+)"/g)].map((match) => match[1]);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe(names[1]);
  });

  it("SearchInput is a labelled search field with a clear button once it has text", () => {
    const empty = render(h(SearchInput, { name: "q" }));
    expect(tagWith(empty, 'type="search"')).toContain('aria-label="Search"');
    expect(empty).not.toContain("Clear search");
    const filled = render(h(SearchInput, { label: "Search tracks or artists", defaultValue: "jazz" }));
    expect(filled).toContain('aria-label="Search tracks or artists"');
    expect(filled).toContain('aria-label="Clear search"');
  });

  it("PasswordInput hides the password behind a pressed-state toggle", () => {
    const html = render(h(PasswordInput, { id: "pw", name: "password" }));
    expect(tagWith(html, 'name="password"')).toContain('type="password"');
    const toggle = tagWith(html, 'aria-label="Show password"');
    expect(toggle).toContain('aria-pressed="false"');
    expect(toggle).toContain('aria-controls="pw"');
  });

  it("CoverImage falls back to the default genre artwork (decorative by default)", () => {
    const html = render(h(CoverImage, { artworkKey: "house", className: "aspect-[3/2]" }));
    expect(html).toMatch(/<img[^>]*alt=""/);
    expect(html).toContain("%2Fbrand%2Fgenres%2Fdefault-0");
    const remote = render(h(CoverImage, { src: "https://cdn.example/cover.jpg", artworkKey: "house", overlay: true }));
    expect(remote).toContain('src="https://cdn.example/cover.jpg"');
    expect(remote).toContain("bg-linear-to-t");
  });

  it("SegmentedTabs keeps the tabs pattern", () => {
    const html = render(
      h(SegmentedTabs, {
        label: "Announcement source",
        items: [
          { value: "generate", label: "Generate voice", content: "G" },
          { value: "upload", label: "Upload recording", content: "U" },
        ],
      }),
    );
    expect(html).toContain('role="tablist" aria-label="Announcement source"');
    expect(tagWith(html, 'data-value="generate"')).toContain('aria-selected="true"');
    expect(tagWith(html, 'data-value="upload"')).toContain('tabindex="-1"');
  });

  it("DropdownMenu renders only its trigger while closed", () => {
    const html = render(
      h(DropdownMenu, {
        label: "Actions for Afterglow",
        items: [{ label: "Edit" }, { type: "separator" }, { label: "Remove", tone: "danger" }],
      }),
    );
    const trigger = tagWith(html, 'aria-label="Actions for Afterglow"');
    expect(trigger).toContain('aria-haspopup="menu"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(html).not.toContain("Remove");
  });

  it("Dialog and Drawer keep their content unmounted while closed", () => {
    const dialog = render(h(Dialog, { open: false, onClose: () => {}, title: "T", children: "BODY" }));
    const drawer = render(h(Drawer, { open: false, onClose: () => {}, title: "T", children: "BODY" }));
    for (const html of [dialog, drawer]) {
      expect(html).toMatch(/^<dialog/);
      expect(html).not.toContain("BODY");
    }
  });

  it("TR marks a selected row for styling", () => {
    const html = renderToString(h("table", null, h("tbody", null, h(TR, { selected: true }, h("td", null, "x")))));
    expect(html).toContain('data-selected="true"');
  });

  it("icons given as components render inside MobileTabBar", () => {
    const html = render(h(MobileTabBar, { items: [{ href: "/radio", label: "Radio", icon: Music }] }), "/radio");
    expect(html).toContain("<svg");
    expect(html).toContain('aria-current="page"');
  });
});
