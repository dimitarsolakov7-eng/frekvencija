import { describe, expect, it } from "vitest";
import { sniffImage, validateLogo } from "@/lib/files/image";
import { asciiBytes, concatBytes, randomBytes } from "../../fixtures/audio";

const PNG = concatBytes(
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  asciiBytes("IHDR"),
  new Uint8Array([0, 0, 0, 64, 0, 0, 0, 64, 8, 6, 0, 0, 0]),
  randomBytes(64, 1),
);
const JPEG = concatBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), asciiBytes("JFIF\0"), randomBytes(64, 2));
const webp = (chunk: string) => concatBytes(asciiBytes("RIFF"), new Uint8Array([60, 0, 0, 0]), asciiBytes("WEBP"), asciiBytes(chunk), randomBytes(48, 3));
const GIF = concatBytes(asciiBytes("GIF89a"), randomBytes(32, 4));
const SVG = asciiBytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>');
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const XML_SVG = concatBytes(UTF8_BOM, asciiBytes('  <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
const BMP = concatBytes(asciiBytes("BM"), randomBytes(64, 5));
const AVIF = concatBytes(new Uint8Array([0, 0, 0, 0x1c]), asciiBytes("ftypavif"), randomBytes(32, 6));
const HEIC = concatBytes(new Uint8Array([0, 0, 0, 0x18]), asciiBytes("ftypheic"), randomBytes(32, 7));

describe("sniffImage", () => {
  it.each([
    ["PNG", PNG, "png"],
    ["JPEG", JPEG, "jpeg"],
    ["WebP (lossy)", webp("VP8 "), "webp"],
    ["WebP (lossless)", webp("VP8L"), "webp"],
    ["WebP (extended)", webp("VP8X"), "webp"],
  ] as const)("recognises %s", (_label, bytes, expected) => {
    expect(sniffImage(bytes)).toBe(expected);
  });

  it.each([
    ["GIF", GIF],
    ["SVG", SVG],
    ["XML-prologue SVG", XML_SVG],
    ["BMP", BMP],
    ["AVIF", AVIF],
    ["HEIC", HEIC],
    ["WAV (RIFF but not WEBP)", concatBytes(asciiBytes("RIFF"), new Uint8Array(4), asciiBytes("WAVEfmt "), randomBytes(32, 8))],
    ["PNG signature without IHDR", concatBytes(PNG.subarray(0, 8), randomBytes(32, 9))],
    ["a truncated PNG signature", PNG.subarray(0, 6)],
    ["two JPEG bytes", JPEG.subarray(0, 2)],
    ["empty bytes", new Uint8Array()],
    ["text", asciiBytes("hello world")],
  ])("rejects %s", (_label, bytes) => {
    expect(sniffImage(bytes)).toBeNull();
  });
});

describe("validateLogo", () => {
  it("accepts matching bytes and declared type with the canonical extension", () => {
    expect(validateLogo(PNG, "image/png")).toEqual({ ok: true, format: "png", contentType: "image/png", extension: "png" });
    expect(validateLogo(JPEG, "image/jpeg")).toEqual({ ok: true, format: "jpeg", contentType: "image/jpeg", extension: "jpg" });
    expect(validateLogo(webp("VP8 "), "image/webp")).toEqual({ ok: true, format: "webp", contentType: "image/webp", extension: "webp" });
  });

  it("accepts JPEG aliases, parameters and uninformative declared types", () => {
    expect(validateLogo(JPEG, "image/jpg").ok).toBe(true);
    expect(validateLogo(JPEG, "IMAGE/PJPEG").ok).toBe(true);
    expect(validateLogo(PNG, "image/png; charset=binary").ok).toBe(true);
    expect(validateLogo(PNG, "").ok).toBe(true);
    expect(validateLogo(PNG, "application/octet-stream").ok).toBe(true);
    expect(validateLogo(PNG, null).ok).toBe(true);
    expect(validateLogo(PNG).ok).toBe(true);
  });

  it("refuses bytes that disagree with the declared type", () => {
    const result = validateLogo(JPEG, "image/png");
    expect(result).toMatchObject({ ok: false, code: "type_mismatch" });
    if (!result.ok) expect(result.reason).toContain(".jpg");
    expect(validateLogo(PNG, "image/gif")).toMatchObject({ ok: false, code: "type_mismatch" });
  });

  it("names the unsupported format when it can", () => {
    const reasons = [GIF, SVG, XML_SVG, BMP, AVIF, HEIC].map((bytes) => {
      const result = validateLogo(bytes, "");
      expect(result.ok).toBe(false);
      return result.ok ? "" : result.reason;
    });
    expect(reasons).toEqual([
      expect.stringContaining("GIF images are not supported"),
      expect.stringContaining("SVG images are not supported"),
      expect.stringContaining("SVG images are not supported"),
      expect.stringContaining("BMP images are not supported"),
      expect.stringContaining("AVIF images are not supported"),
      expect.stringContaining("HEIC images are not supported"),
    ]);
    expect(validateLogo(randomBytes(64, 10).map((byte) => byte & 0x3f))).toEqual({
      ok: false,
      code: "unsupported",
      reason: "This file is not a PNG, JPEG or WebP image.",
    });
  });

  it("rejects empty and oversized files", () => {
    expect(validateLogo(new Uint8Array(), "image/png")).toMatchObject({ ok: false, code: "empty" });
    expect(validateLogo(concatBytes(PNG, new Uint8Array(2 * 1024 * 1024)), "image/png")).toMatchObject({ ok: false, code: "too_large" });
    expect(validateLogo(PNG, "image/png", { maxBytes: 10 })).toMatchObject({ ok: false, code: "too_large" });
  });
});
