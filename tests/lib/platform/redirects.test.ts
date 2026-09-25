import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirects";

/** Dot segments followed by "//": they pass the raw checks but normalise to "//evil.example" (SEC-01). */
const DOT_SEGMENT_OPEN_REDIRECTS = [
  "/.//evil.example",
  "/.//evil.example/phish",
  "/%2e//evil.example",
  "/%2E//evil.example",
  "/%2e%2e//evil.example",
  "/%2E%2e//evil.example/login?x=1#y",
  "/.%2e//evil.example",
  "/a/..//evil.example",
  "/a/%2e%2e//evil.example",
  "/radio/..//evil.example",
  "/a/b/../..//evil.example",
  "/x/../..//evil.example",
  "/..//evil.example",
  "/././/evil.example",
  "/;/..//evil.example",
  "/.//",
];

const SITE_PAGE = "https://frekvencija.online/login";

describe("safeNextPath", () => {
  it.each([
    ["/radio", "/radio"],
    ["/admin/businesses/abc?tab=members#invites", "/admin/businesses/abc?tab=members#invites"],
    ["/set-password", "/set-password"],
    ["/a/../admin", "/admin"],
    ["/a/./b/../c", "/a/c"],
    ["/%2e%2e/radio", "/radio"],
    ["/a//b", "/a//b"],
  ])("accepts relative path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example/phish",
    "http:/evil.example",
    "javascript:alert(1)",
    "//evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "/\\/evil.example",
    "\\\\evil.example",
    "/admin\\..\\//evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "radio",
    "",
    " /radio",
  ])("rejects %j", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it.each(DOT_SEGMENT_OPEN_REDIRECTS)("rejects %j, which normalises to a protocol-relative URL", (input) => {
    expect(safeNextPath(input)).toBe("/");
    expect(safeNextPath(input, "")).toBe("");
    expect(safeNextPath(input, "/login")).toBe("/login");
    expect(safeNextPath([input, "/radio"])).toBe("/");
  });

  it("rejects non-strings and uses the first value of arrays", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(42)).toBe("/");
    expect(safeNextPath(["/radio", "/admin"])).toBe("/radio");
    expect(safeNextPath(["//evil.example"])).toBe("/");
  });

  it("uses the supplied fallback", () => {
    expect(safeNextPath("//evil.example", "/login")).toBe("/login");
  });

  it("rejects absurdly long values", () => {
    expect(safeNextPath(`/${"a".repeat(5000)}`)).toBe("/");
  });

  it("keeps percent-encoded slashes as a same-origin path", () => {
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
    expect(new URL(safeNextPath("/%2F%2Fevil.example"), SITE_PAGE).origin).toBe("https://frekvencija.online");
  });

  it("is idempotent and only ever returns same-origin paths (seeded fuzz)", () => {
    const pieces = ["/", "/", "//", ".", "..", "%2e", "%2E", "%2e%2e", "a", "evil.example", "\\", "%5c", "%2f", "?", "#", ";", ":", "@", "\t", "https:", " "];
    // mulberry32: a small deterministic PRNG in 32-bit integer arithmetic.
    let state = 0x5eed;
    const random = (max: number) => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4_294_967_296) * max);
    };
    const originOf = (value: string) => {
      try {
        return new URL(value, SITE_PAGE).origin;
      } catch {
        return "invalid URL";
      }
    };

    let accepted = 0;
    for (let run = 0; run < 5000; run += 1) {
      let input = "/";
      const length = 1 + random(8);
      for (let index = 0; index < length; index += 1) input += pieces[random(pieces.length)];

      const output = safeNextPath(input, "");
      if (output === "") continue;
      accepted += 1;
      expect(output.startsWith("/"), input).toBe(true);
      expect(output.startsWith("//"), input).toBe(false);
      expect(output.includes("\\"), input).toBe(false);
      expect(/[\u0000-\u001f\u007f]/.test(output), input).toBe(false);
      expect(safeNextPath(output, ""), input).toBe(output);
      // What a browser does with the value in a Location header or form redirect: stays on this site.
      expect(originOf(output), input).toBe("https://frekvencija.online");
    }
    // The generator must exercise the accept path too (about half of the inputs are safe paths).
    expect(accepted).toBeGreaterThan(1000);
  });
});
