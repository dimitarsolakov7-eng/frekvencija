/**
 * Logo validation by content (docs/ARCHITECTURE.md §8): the bytes decide, never the file name or the
 * browser-reported type. Only PNG, JPEG and WebP are accepted; SVG is refused because it can carry
 * scripts, GIF and everything else because the `logos` bucket does not allow them.
 *
 * Pure and dependency-free, so the browser can use it for a pre-check as well.
 */
import { formatBytes, IMAGE_EXTENSION_BY_TYPE, MAX_LOGO_BYTES } from "@/lib/validation/limits";

export type ImageFormat = "png" | "jpeg" | "webp";
export type ImageContentType = "image/png" | "image/jpeg" | "image/webp";

export const IMAGE_CONTENT_TYPE: Readonly<Record<ImageFormat, ImageContentType>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const FORMAT_LABEL: Readonly<Record<ImageFormat, string>> = { png: "PNG", jpeg: "JPEG", webp: "WebP" };

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return startsWith(bytes, Array.from(text, (char) => char.charCodeAt(0)), offset);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** PNG, JPEG or WebP by magic bytes; null for anything else (SVG, GIF, BMP, HEIC, AVIF, text…). */
export function sniffImage(bytes: Uint8Array): ImageFormat | null {
  // PNG: 8-byte signature, then the mandatory IHDR chunk first.
  if (startsWith(bytes, PNG_SIGNATURE) && asciiAt(bytes, 12, "IHDR")) return "png";
  // JPEG: SOI marker followed by the start of another marker.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  // WebP: RIFF container of type WEBP with a VP8 / VP8L / VP8X first chunk.
  if (
    asciiAt(bytes, 0, "RIFF") &&
    asciiAt(bytes, 8, "WEBP") &&
    (asciiAt(bytes, 12, "VP8 ") || asciiAt(bytes, 12, "VP8L") || asciiAt(bytes, 12, "VP8X"))
  ) {
    return "webp";
  }
  return null;
}

/** Best-effort name of a rejected format, for a more helpful message. */
function describeUnsupported(bytes: Uint8Array): string | null {
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a")) return "GIF";
  if (asciiAt(bytes, 0, "BM")) return "BMP";
  if (asciiAt(bytes, 4, "ftyp")) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (brand.startsWith("avi")) return "AVIF";
    if (brand.startsWith("hei") || brand.startsWith("mif") || brand.startsWith("hev")) return "HEIC";
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 512)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "SVG";
  return null;
}

const CONTENT_TYPE_ALIASES: Readonly<Record<string, ImageContentType>> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/webp": "image/webp",
};

/** Declared types that carry no information and are therefore not compared with the bytes. */
const UNINFORMATIVE_TYPES = new Set(["", "application/octet-stream"]);

export type LogoValidation =
  | { ok: true; format: ImageFormat; contentType: ImageContentType; extension: "png" | "jpg" | "webp" }
  | { ok: false; code: "empty" | "too_large" | "unsupported" | "type_mismatch"; reason: string };

export interface ValidateLogoOptions {
  /** Default 2 MB (the `logos` bucket limit). */
  maxBytes?: number;
}

/**
 * Validates uploaded logo bytes. `declaredType` is the content type the upload was signed and stored
 * with; when it names a different image type than the bytes, the upload is refused so the object's
 * Content-Type and path extension never disagree with its content.
 */
export function validateLogo(bytes: Uint8Array, declaredType?: string | null, options: ValidateLogoOptions = {}): LogoValidation {
  const maxBytes = options.maxBytes ?? MAX_LOGO_BYTES;
  if (bytes.length === 0) return { ok: false, code: "empty", reason: "The image file is empty." };
  if (bytes.length > maxBytes) {
    return { ok: false, code: "too_large", reason: `The image is ${formatBytes(bytes.length)}; logos can be at most ${formatBytes(maxBytes)}.` };
  }

  const format = sniffImage(bytes);
  if (!format) {
    const detected = describeUnsupported(bytes);
    return {
      ok: false,
      code: "unsupported",
      reason: detected
        ? `${detected} images are not supported. Use a PNG, JPEG or WebP file.`
        : "This file is not a PNG, JPEG or WebP image.",
    };
  }

  const contentType = IMAGE_CONTENT_TYPE[format];
  const declared = declaredType?.split(";")[0].trim().toLowerCase() ?? "";
  if (!UNINFORMATIVE_TYPES.has(declared) && CONTENT_TYPE_ALIASES[declared] !== contentType) {
    const extension = IMAGE_EXTENSION_BY_TYPE[contentType];
    return {
      ok: false,
      code: "type_mismatch",
      reason: `This file is a ${FORMAT_LABEL[format]} image but was uploaded as ${declared}. Save it with a .${extension} extension and upload it again.`,
    };
  }

  return { ok: true, format, contentType, extension: IMAGE_EXTENSION_BY_TYPE[contentType] };
}
