/**
 * Upload limits shared by the browser (pre-validation), the sign endpoint and the Storage bucket
 * configuration (docs/ARCHITECTURE.md §5.6). Keep the byte limits in sync with the bucket migration.
 */
import type { UploadKind } from "@/lib/api/contracts";

export const MAX_TRACK_BYTES = 50 * 1024 * 1024;
export const MAX_ANNOUNCEMENT_BYTES = 10 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
/** Genre cover images; equals the `genre-covers` bucket limit (3145728 bytes). */
export const MAX_GENRE_COVER_BYTES = 3 * 1024 * 1024;
export const MAX_FILE_NAME_LENGTH = 255;

/** MIME types the `music`/`announcements` buckets accept; uploads are always sent as the first one. */
export const AUDIO_MIME_TYPES = ["audio/mpeg", "audio/mp3"] as const;
/** Types browsers/OSes report for .mp3 files (all normalised to audio/mpeg before upload). */
export const ACCEPTED_AUDIO_MIME_TYPES = [
  ...AUDIO_MIME_TYPES,
  "audio/mpeg3",
  "audio/x-mpeg-3",
  "audio/x-mp3",
  "audio/x-mpeg",
  "audio/mpg",
  "audio/x-mpg",
] as const;
export const AUDIO_EXTENSIONS = [".mp3"] as const;

/** MIME types the `logos` and `genre-covers` buckets accept. */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;

/** Values for `<input type="file" accept>`. */
export const AUDIO_ACCEPT = [...AUDIO_EXTENSIONS, ...AUDIO_MIME_TYPES].join(",");
export const IMAGE_ACCEPT = [...IMAGE_EXTENSIONS, ...IMAGE_MIME_TYPES].join(",");

export type UploadBucket = "music" | "announcements" | "logos" | "genre-covers";

export interface UploadRule {
  bucket: UploadBucket;
  maxBytes: number;
  /** Human noun used in messages, e.g. "Track". */
  label: string;
  media: "audio" | "image";
}

export const UPLOAD_RULES: Record<UploadKind, UploadRule> = {
  track: { bucket: "music", maxBytes: MAX_TRACK_BYTES, label: "Track", media: "audio" },
  "track-replace": { bucket: "music", maxBytes: MAX_TRACK_BYTES, label: "Track", media: "audio" },
  announcement: { bucket: "announcements", maxBytes: MAX_ANNOUNCEMENT_BYTES, label: "Announcement", media: "audio" },
  logo: { bucket: "logos", maxBytes: MAX_LOGO_BYTES, label: "Logo", media: "image" },
  "genre-cover": { bucket: "genre-covers", maxBytes: MAX_GENRE_COVER_BYTES, label: "Genre cover", media: "image" },
};

const IMAGE_TYPE_BY_EXTENSION: Record<string, (typeof IMAGE_MIME_TYPES)[number]> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
/** Canonical object-path extension per image type. */
export const IMAGE_EXTENSION_BY_TYPE: Record<(typeof IMAGE_MIME_TYPES)[number], "png" | "jpg" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const IMAGE_TYPE_ALIASES: Record<string, (typeof IMAGE_MIME_TYPES)[number]> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/webp": "image/webp",
};

/** Types that carry no information; the extension decides and the server checks the bytes. */
const UNINFORMATIVE_TYPES = new Set(["", "application/octet-stream"]);

/** Lower-case extension including the dot (".mp3"), or "" when there is none. */
export function getFileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** "50 MB", "1.5 MB", "300 KB", "12 bytes". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export type UploadFileCheck =
  | {
      ok: true;
      /** Content type to send to Storage (normalised; always allowed by the bucket). */
      contentType: string;
      /** Canonical extension without dot for the object path ("mp3", "png", "jpg", "webp"). */
      extension: string;
    }
  | { ok: false; code: "invalid_request" | "payload_too_large" | "unsupported_media"; message: string };

export interface UploadFileDescriptor {
  name: string;
  size: number;
  /** Browser-reported MIME type (may be ""). */
  type: string;
}

/**
 * Checks name/size/type of a file for an upload kind. Used by the browser before signing and by the
 * sign endpoint; the complete endpoint still validates the actual bytes.
 */
export function checkUploadFile(kind: UploadKind, file: UploadFileDescriptor): UploadFileCheck {
  const rule = UPLOAD_RULES[kind];
  const name = file.name.trim();
  if (!name) return { ok: false, code: "invalid_request", message: "The file has no name." };
  if (name.length > MAX_FILE_NAME_LENGTH) {
    return { ok: false, code: "invalid_request", message: `File names must be at most ${MAX_FILE_NAME_LENGTH} characters.` };
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return { ok: false, code: "invalid_request", message: `"${name}" is empty.` };
  }
  if (file.size > rule.maxBytes) {
    return {
      ok: false,
      code: "payload_too_large",
      message: `"${name}" is ${formatBytes(file.size)}; the ${rule.label.toLowerCase()} limit is ${formatBytes(rule.maxBytes)}.`,
    };
  }

  const extension = getFileExtension(name);
  const reportedType = file.type.trim().toLowerCase();

  if (rule.media === "audio") {
    const knownType =
      UNINFORMATIVE_TYPES.has(reportedType) || (ACCEPTED_AUDIO_MIME_TYPES as readonly string[]).includes(reportedType);
    if (!(AUDIO_EXTENSIONS as readonly string[]).includes(extension) || !knownType) {
      return { ok: false, code: "unsupported_media", message: `"${name}" is not an MP3 file. Only .mp3 files are accepted.` };
    }
    return { ok: true, contentType: AUDIO_MIME_TYPES[0], extension: "mp3" };
  }

  const typeFromExtension = IMAGE_TYPE_BY_EXTENSION[extension];
  const typeFromMime = IMAGE_TYPE_ALIASES[reportedType];
  const unsupported = {
    ok: false,
    code: "unsupported_media",
    message: `"${name}" is not a supported image. Use a PNG, JPEG or WebP file.`,
  } as const;
  if (!typeFromExtension) return unsupported;
  if (!typeFromMime && !UNINFORMATIVE_TYPES.has(reportedType)) return unsupported;
  if (typeFromMime && typeFromMime !== typeFromExtension) {
    return {
      ok: false,
      code: "unsupported_media",
      message: `"${name}" has a ${extension} extension but is reported as ${reportedType}. Re-save it with the correct extension.`,
    };
  }
  return { ok: true, contentType: typeFromExtension, extension: IMAGE_EXTENSION_BY_TYPE[typeFromExtension] };
}
