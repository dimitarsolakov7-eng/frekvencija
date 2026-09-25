/**
 * Review finding A11Y-15: text-field boundaries used the #26382F card hairline (1.35:1 on a card).
 * Form controls now use a dedicated border-input token that keeps ≥ 3:1 (WCAG 1.4.11) against every
 * surface a control sits on. The ratios are computed from the tokens in globals.css.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox, Input, PasswordInput, SearchInput, Select, Switch, Textarea } from "@/components/ui";
import { CONTROL_CLASSES } from "@/components/ui/internal/control-styles";

const css = readFileSync(fileURLToPath(new URL("../../src/app/globals.css", import.meta.url)), "utf8");

/** `--color-<name>: #rrggbb` from the @theme block. */
function token(name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`token --color-${name} not found`);
  return match[1];
}

const channels = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** `top` at `alpha` painted over the opaque `bottom`. */
function over(top: string, alpha: number, bottom: string): string {
  const [t, u] = [channels(top), channels(bottom)];
  return `#${t.map((value, index) => Math.round(alpha * value + (1 - alpha) * u[index]).toString(16).padStart(2, "0")).join("")}`;
}

/** Everything a form control is placed on: page, sidebar/bars, the control well, cards, raised panels. */
const SURFACES = ["canvas", "sidebar", "control", "surface", "surface-2"] as const;

describe("control boundary token", () => {
  it("keeps the design palette values", () => {
    expect(token("canvas").toLowerCase()).toBe("#0b1110");
    expect(token("surface").toLowerCase()).toBe("#15201c");
    expect(token("border").toLowerCase()).toBe("#26382f");
  });

  it.each(SURFACES)("border-input and its hover state reach 3:1 on %s", (surface) => {
    expect(contrast(token("border-input"), token(surface))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("border-input-hover"), token(surface))).toBeGreaterThanOrEqual(3);
  });

  it("is a real improvement over the hairline it replaces on controls", () => {
    expect(contrast(token("border"), token("surface"))).toBeLessThan(1.5);
    expect(contrast(token("border-input"), token("surface"))).toBeGreaterThan(3.5);
  });

  it("hover is lighter than rest, and the focus ring stays far above 3:1", () => {
    expect(luminance(token("border-input-hover"))).toBeGreaterThan(luminance(token("border-input")));
    for (const surface of [...SURFACES, "surface-3"]) expect(contrast(token("ring"), token(surface))).toBeGreaterThan(8);
  });

  it("a checked checkbox tile keeps a 3:1 edge (accent/60 over its accent/10 fill)", () => {
    for (const page of ["surface", "canvas"]) {
      const fill = over(token("accent"), 0.1, token(page));
      expect(contrast(over(token("accent"), 0.6, fill), token(page))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("controls use the boundary token", () => {
  const tokensOf = (html: string, marker: string) => {
    const index = html.indexOf(marker);
    const tag = html.slice(html.lastIndexOf("<", index), html.indexOf(">", index) + 1);
    return (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
  };

  it("CONTROL_CLASSES: border-input at rest, lighter on hover, the hairline only when disabled", () => {
    const classes = CONTROL_CLASSES.split(/\s+/);
    expect(classes).toContain("border-border-input");
    expect(classes).toContain("hover:border-border-input-hover");
    expect(classes).not.toContain("border-border");
    expect(classes).toContain("disabled:border-border");
  });

  it.each([
    ["Input", () => renderToString(h(Input, { name: "field" })), 'name="field"'],
    ["Textarea", () => renderToString(h(Textarea, { name: "field" })), 'name="field"'],
    ["Select", () => renderToString(h(Select, { name: "field" }, h("option", null, "A"))), 'name="field"'],
    ["SearchInput", () => renderToString(h(SearchInput, { name: "field" })), 'name="field"'],
    ["PasswordInput", () => renderToString(h(PasswordInput, { name: "field" })), 'name="field"'],
  ])("%s renders with border-border-input", (_name, render, marker) => {
    expect(tokensOf(render(), marker)).toContain("border-border-input");
  });

  it("checkbox tiles and the switch track use it too", () => {
    const tile = renderToString(h(Checkbox, { variant: "tile", label: "House" }));
    expect(tile).toMatch(/class="[^"]*\bborder-border-input\b[^"]*has-checked:border-accent\/60/);
    const toggle = renderToString(h(Switch, { "aria-label": "Announcements" }));
    expect(tokensOf(toggle, 'role="switch"')).toContain("border-border-input");
  });
});
