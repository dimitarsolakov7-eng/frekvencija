/**
 * Guard against a Next.js App Router pitfall: a Server Component (or any module in the server graph)
 * that imports a plain value — a constant, hook or helper — from a "use client" module receives a
 * client-reference placeholder instead of the value. Rendering then fails at runtime (e.g. a <Link>
 * whose href is `undefined`), while unit tests that run everything in Node stay green.
 *
 * The test walks the server module graph from every app entry point (pages, layouts, route handlers,
 * templates, error boundaries are client so they stop the walk) and reports any non-component value
 * imported from a "use client" module. PascalCase imports are treated as components (allowed:
 * rendering a client component from the server is the normal pattern); UPPER_CASE constants and
 * camelCase functions/hooks are values (not allowed).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = walk(SRC);
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

function directive(file: string): "client" | "server-actions" | null {
  const text = (source.get(file) ?? "").replace(/^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*/, "");
  if (/^["']use client["']/.test(text)) return "client";
  if (/^["']use server["']/.test(text)) return "server-actions";
  return null;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface ImportRef {
  target: string;
  names: string[];
}

function valueImports(file: string): ImportRef[] {
  const text = source.get(file) ?? "";
  const refs: ImportRef[] = [];
  const re = /import\s+(type\s+)?([\w$]+\s*,?\s*)?(\{[^}]*\})?\s*from\s*["']([^"']+)["']/g;
  for (const m of text.matchAll(re)) {
    if (m[1]) continue; // import type { … }
    const target = resolveImport(file, m[4]);
    if (!target) continue;
    const names: string[] = [];
    if (m[2]) names.push(m[2].replace(/[\s,]/g, ""));
    if (m[3]) {
      for (const part of m[3].slice(1, -1).split(",")) {
        const p = part.trim();
        if (!p || p.startsWith("type ")) continue;
        names.push(p.split(/\s+as\s+/)[0].trim());
      }
    }
    refs.push({ target, names });
  }
  return refs;
}

/** Named re-exports of a module (`export { a as b } from "./x"`): exported name → origin module + name. */
function reExports(file: string): Map<string, { target: string; name: string }> {
  const map = new Map<string, { target: string; name: string }>();
  const text = source.get(file) ?? "";
  for (const m of text.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (m[1]) continue;
    const target = resolveImport(file, m[3]);
    if (!target) continue;
    for (const part of m[2].split(",")) {
      const p = part.trim();
      if (!p || p.startsWith("type ")) continue;
      const [original, alias] = p.split(/\s+as\s+/).map((s) => s.trim());
      map.set(alias ?? original, { target, name: original });
    }
  }
  return map;
}

/** Follows barrel re-exports to the module that defines `name` (bounded depth). */
function origin(target: string, name: string, depth = 0): { target: string; name: string } {
  if (depth > 5 || directive(target) === "client") return { target, name };
  const next = reExports(target).get(name);
  return next ? origin(next.target, next.name, depth + 1) : { target, name };
}

const isComponentName = (name: string) => /^[A-Z][a-z0-9]/.test(name) || /^[A-Z]$/.test(name);

const ENTRY = /[\\/]app[\\/].*[\\/](page|layout|template|route|not-found|default|loading|opengraph-image|icon)\.(ts|tsx)$|[\\/]proxy\.ts$/;

function serverGraphViolations(): string[] {
  const entries = files.filter((f) => ENTRY.test(f) && directive(f) !== "client");
  const seen = new Set<string>();
  const queue = [...entries];
  const violations: string[] = [];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const ref of valueImports(file)) {
      for (const name of ref.names) {
        const def = origin(ref.target, name);
        if (directive(def.target) !== "client") {
          if (!seen.has(def.target)) queue.push(def.target);
          continue;
        }
        // Reached a client boundary: components are fine, plain values are not.
        if (name === "default" || isComponentName(def.name)) continue;
        violations.push(
          `${relative(ROOT, file)} imports value "${name}" (defined in client module ${relative(ROOT, def.target)})`,
        );
      }
      // Barrels themselves are walked for any side-effect imports / non-re-exported values.
      if (directive(ref.target) !== "client" && !seen.has(ref.target) && ref.names.length === 0) queue.push(ref.target);
    }
  }
  return violations;
}

describe("server/client module boundary", () => {
  it("finds app entry points to analyse", () => {
    expect(files.filter((f) => ENTRY.test(f)).length).toBeGreaterThan(20);
  });

  it("never imports plain values (constants, hooks, helpers) from \"use client\" modules into the server graph", () => {
    expect(serverGraphViolations()).toEqual([]);
  });
});
