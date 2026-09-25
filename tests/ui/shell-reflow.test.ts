/**
 * Review finding A11Y-02: below 1024px the venue shell pinned a 65px top bar and a ~200px bottom
 * stack (player bar + tab bar), which covered the whole viewport at 400% zoom (320×256) and left
 * ~60px on a landscape phone. On short viewports the bars now scroll with the page, and the
 * published bar heights (scroll-padding) only count bars that are actually pinned.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement as h, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { Radio, User } from "lucide-react";
import { describe, expect, it } from "vitest";
import { AppShell, MobileTabBar, MobileTopBar } from "@/components/shell";
import { pinnedBarHeight } from "@/components/shell/ShellMetrics";

const render = (element: ReactElement) => renderToString(h(PathnameContext, { value: "/radio" }, element));

function openingTag(html: string, marker: string): string {
  const index = html.indexOf(marker);
  if (index === -1) return "";
  return html.slice(html.lastIndexOf("<", index), html.indexOf(">", index) + 1);
}

const classTokens = (tag: string) => (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);

describe("app shell on short viewports", () => {
  const html = render(
    h(AppShell, {
      sidebar: null,
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
  );

  it("pins the top bar and the bottom stack normally, but lets both scroll with the page when short", () => {
    for (const marker of ["data-shell-header", "data-shell-bottom"]) {
      const tokens = classTokens(openingTag(html, marker));
      expect(tokens).toContain("sticky");
      expect(tokens).toContain("short:static");
    }
  });

  it("keeps the flow order header → content → player → tabs, so every part stays reachable", () => {
    const order = ["data-shell-header", "CONTENT", "data-shell-bottom", "PLAYER", "data-shell-tabbar"].map((marker) =>
      html.indexOf(marker),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("defines the short: variant as a max-height media query in globals.css", () => {
    const css = readFileSync(fileURLToPath(new URL("../../src/app/globals.css", import.meta.url)), "utf8");
    expect(css).toMatch(/@custom-variant short \(@media \(max-height: 32rem\)\);/);
  });
});

describe("pinnedBarHeight", () => {
  it("counts sticky and fixed bars, rounded up", () => {
    expect(pinnedBarHeight("sticky", 64.2)).toBe(65);
    expect(pinnedBarHeight("fixed", 197)).toBe(197);
  });

  it("counts a bar that scrolls with the page, or is hidden, as 0", () => {
    expect(pinnedBarHeight("static", 197)).toBe(0);
    expect(pinnedBarHeight("relative", 65)).toBe(0);
    expect(pinnedBarHeight("sticky", 0)).toBe(0);
    expect(pinnedBarHeight("sticky", -3)).toBe(0);
  });
});
