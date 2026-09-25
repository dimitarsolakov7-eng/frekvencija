/**
 * Keyboard focus must stay visible in every shared primitive (design/CLAUDE-HANDOFF.md "Keep all
 * focus outlines visible", WCAG 2.4.7). Review finding A11Y-01: in Tailwind 4, `outline-none` and
 * `outline-hidden` set `--tw-outline-style: none`, which silently cancels `focus-visible:outline-2`
 * on the same element, so the dropdown menu items had no ring.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/shell";
import { MENU_ITEM_FOCUS_RING_CLASSES, menuItemClasses } from "@/components/ui/internal/menu-styles";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** Class tokens that turn an outline off (with any variant prefix). */
const isSuppressor = (token: string) => /(?:^|:)outline-(?:none|hidden)$/.test(token);
/**
 * Class tokens that bring a ring back for keyboard focus: an explicit outline style on the element,
 * or a ring on its ::before/::after (`--tw-outline-style` does not inherit into pseudo-elements).
 */
const isFocusVisibleRestore = (token: string) =>
  /^focus-visible:outline-(?:solid|dashed|dotted|double)$/.test(token) || /^focus-visible:(?:after|before):outline-/.test(token);

describe("DropdownMenu item focus ring", () => {
  const variants = [
    { label: "default", classes: menuItemClasses() },
    { label: "danger", classes: menuItemClasses({ tone: "danger" }) },
    { label: "disabled", classes: menuItemClasses({ disabled: true }) },
  ];

  it.each(variants)("$label items draw a solid 2px ring in the ring colour on keyboard focus", ({ classes }) => {
    const tokens = classes.split(/\s+/);
    for (const token of MENU_ITEM_FOCUS_RING_CLASSES.split(" ")) expect(tokens).toContain(token);
    expect(tokens).toEqual(expect.arrayContaining(["focus-visible:outline-2", "focus-visible:outline-solid", "focus-visible:outline-ring"]));
  });

  it.each(variants)("$label items never cancel the ring with outline-none/outline-hidden", ({ classes }) => {
    const tokens = classes.split(/\s+/);
    const suppressors = tokens.filter(isSuppressor);
    // Either none at all, or explicitly restored for keyboard focus.
    expect(suppressors.length === 0 || tokens.some(isFocusVisibleRestore)).toBe(true);
    expect(suppressors).toEqual([]);
  });

  it("keeps the hover/focus tint and the danger colour", () => {
    expect(menuItemClasses()).toContain("focus:bg-surface-3");
    expect(menuItemClasses({ tone: "danger" })).toContain("text-danger");
    expect(menuItemClasses({ disabled: true })).toContain("cursor-not-allowed");
  });

  it("is what DropdownMenu renders for its items", () => {
    const source = read("src/components/ui/DropdownMenu.tsx");
    expect(source).toContain("menuItemClasses({ tone: item.tone, disabled: item.disabled })");
  });
});

/** Every .ts/.tsx file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry.name) ? [relative] : [];
  });
}

/** String literals of a source file, comments removed first. */
function stringLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return Array.from(code.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\]*)`/g), (match) => match[1] ?? match[2] ?? match[3] ?? "");
}

/**
 * Outline suppressions that are fine because the element is not an interactive control: the app
 * shell's <main tabIndex={-1}> only receives focus from the skip link.
 */
const ALLOWED_SUPPRESSIONS = [{ file: "src/components/shell/AppShell.tsx", token: "focus:outline-none" }];

describe("no shared primitive removes its focus outline", () => {
  const files = [...sourceFiles("src/components/ui"), ...sourceFiles("src/components/shell")];

  it("scans the whole UI kit and shell", () => {
    expect(files).toContain("src/components/ui/DropdownMenu.tsx");
    expect(files).toContain("src/components/ui/internal/menu-styles.ts");
    expect(files).toContain("src/components/shell/AppShell.tsx");
  });

  it("pairs every outline-none/outline-hidden with a focus-visible outline, or it is a known non-control", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const literal of stringLiterals(read(file))) {
        const tokens = literal.split(/\s+/).filter(Boolean);
        if (tokens.some(isFocusVisibleRestore)) continue;
        for (const token of tokens.filter(isSuppressor)) {
          const allowed = ALLOWED_SUPPRESSIONS.some((entry) => entry.file === file && entry.token === token);
          if (!allowed) violations.push(`${file}: "${token}" in "${literal}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the allowed suppression really sits on the skip-link target <main tabindex=-1>", () => {
    const html = renderToString(h(AppShell, { sidebar: null, mobileHeader: null, children: "x" }));
    const main = html.match(/<main\b[^>]*>/)?.[0] ?? "";
    expect(main).toContain('id="main-content"');
    expect(main).toMatch(/tabindex="-1"/i);
    expect(main).toContain("focus:outline-none");
  });

  it("globals.css keeps the base ring and only drops an outline where another indicator replaces it", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--color-ring\);/);
    const removals = Array.from(css.matchAll(/([^{}]+)\{[^{}]*outline(?:-style)?:\s*none/g), (match) => match[1].trim());
    // The range input shows focus as a ring around its thumb instead…
    expect(removals).toEqual([expect.stringMatching(/\.ui-range:focus-visible$/)]);
    expect(css).toMatch(/\.ui-range:focus-visible::-webkit-slider-thumb\s*\{[^}]*var\(--color-ring\)/);
    expect(css).toMatch(/\.ui-range:focus-visible::-moz-range-thumb\s*\{[^}]*var\(--color-ring\)/);
    // …and forced-colours mode (which drops box-shadows) gets an outline back.
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.ui-range:focus-visible\s*\{\s*outline:\s*2px solid/);
  });
});
