/**
 * MP3 validation for uploaded and generated audio (docs/research/audio-tooling.md §6).
 *
 * The verdict and the duration come from our own MPEG Layer III frame walk. music-metadata alone is
 * not trustworthy here: with a forced MIME type it "parses" WAV, random bytes and text without
 * error, and it estimates CBR duration from the file size (4 KB of MP3 followed by 300 KB of garbage
 * reads as a 19 s file). It is only used as a codec cross-check and to read the title and artist tags.
 *
 * Deliberately no `import "server-only"`: this is pure computation without secrets, and the tsx
 * scripts (demo audio, seeding) import it, where server-only throws. music-metadata is ESM-only and
 * is loaded with a dynamic import because a static one breaks when tsx runs this file as CommonJS
 * (the type-only import below is erased at runtime).
 */
import type { IAudioMetadata } from "music-metadata";

export type Mp3RejectCode = "empty" | "too_large" | "not_mp3" | "truncated" | "too_short" | "corrupt";

export interface Mp3Metadata {
  ok: true;
  /** Playable length: frame count (minus LAME encoder delay/padding when declared), rounded to 0.01 s. */
  durationSeconds: number;
  /** Average bitrate over the audio frames. */
  bitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: 1 | 2 | null;
  /** "MPEG 1 Layer 3" | "MPEG 2 Layer 3" | "MPEG 2.5 Layer 3" */
  codec: string;
  /** ID3/APE tag values, whitespace-normalised and capped at 200 characters; null when absent. */
  title: string | null;
  artist: string | null;
}

export interface Mp3Rejection {
  ok: false;
  code: Mp3RejectCode;
  /** User-facing explanation. */
  reason: string;
}

export type Mp3Validation = Mp3Metadata | Mp3Rejection;

export interface ValidateMp3Options {
  /** Default 50 MB (music bucket limit). Use 10 MB for announcements. */
  maxBytes?: number;
  /** Default 0.5 s. */
  minDurationSeconds?: number;
}

export const MP3_DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
export const MP3_DEFAULT_MIN_DURATION_SECONDS = 0.5;
/** Largest share of the audio region (tags excluded) that may be something other than MPEG frames. */
export const MP3_MAX_JUNK_RATIO = 0.02;
/** Same limit as tracks.title / tracks.artist. */
export const MAX_TAG_TEXT_LENGTH = 200;

/** The first frame chain must start within this many bytes after the ID3v2 tag(s). */
const FIRST_FRAME_SEARCH_BYTES = 64 * 1024;
/** Consecutive, mutually consistent frame headers required to accept a sync position. */
const CHAIN_LENGTH = 3;
/** A Xing/VBRI header may claim a few more frames than are present (counting conventions differ). */
const DECLARED_FRAMES_TOLERANCE = { frames: 2, ratio: 0.01 };
const LAYER3_CODEC = /^MPEG (1|2|2\.5) Layer 3$/;

// ---------------------------------------------------------------------------
// MPEG audio frame headers (Layer III only)
// ---------------------------------------------------------------------------

const KBPS_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const KBPS_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
/** Keyed by the header's version bits: 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5 (1 is reserved). */
const SAMPLE_RATES: Readonly<Record<number, readonly number[]>> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

interface FrameHeader {
  /** Version bits: 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5. */
  version: number;
  sampleRate: number;
  channels: 1 | 2;
  /** Bytes, including the 4-byte header. */
  length: number;
  /** PCM samples per channel: 1152 (MPEG-1) or 576 (MPEG-2/2.5). */
  samples: number;
}

function readFrameHeader(b: Uint8Array, off: number, limit: number): FrameHeader | null {
  if (off + 4 > limit || b[off] !== 0xff || (b[off + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[off + 1] >> 3) & 3;
  const layer = (b[off + 1] >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const bitrateIndex = b[off + 2] >> 4;
  const sampleRateIndex = (b[off + 2] >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null; // free format / reserved
  const kbps = (version === 3 ? KBPS_V1_L3 : KBPS_V2_L3)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
  const padding = (b[off + 2] >> 1) & 1;
  const samples = version === 3 ? 1152 : 576;
  return {
    version,
    sampleRate,
    channels: b[off + 3] >> 6 === 3 ? 1 : 2,
    length: Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding,
    samples,
  };
}

const sameStream = (a: FrameHeader, b: FrameHeader) => a.version === b.version && a.sampleRate === b.sampleRate;

/**
 * The first header when CHAIN_LENGTH consecutive, consistent Layer III headers start at `off`;
 * "eof" when valid headers run into the end of the data before the chain is complete; else null.
 */
function chainAt(b: Uint8Array, off: number, limit: number, want?: FrameHeader): FrameHeader | "eof" | null {
  let first: FrameHeader | null = null;
  let p = off;
  for (let k = 0; k < CHAIN_LENGTH; k++) {
    if (k > 0 && p + 4 > limit) return "eof";
    const h = readFrameHeader(b, p, limit);
    if (!h || (want && !sameStream(h, want)) || (first && !sameStream(h, first))) return null;
    if (!first) first = h;
    p += h.length;
  }
  return first;
}

// ---------------------------------------------------------------------------
// Tags around the audio
// ---------------------------------------------------------------------------

function asciiAt(b: Uint8Array, off: number, text: string): boolean {
  if (off < 0 || off + text.length > b.length) return false;
  for (let i = 0; i < text.length; i++) if (b[off + i] !== text.charCodeAt(i)) return false;
  return true;
}

const uint32LE = (b: Uint8Array, off: number) => (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
const uint32BE = (b: Uint8Array, off: number) => ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
const synchsafe = (b: Uint8Array, off: number) =>
  ((b[off] & 0x7f) << 21) | ((b[off + 1] & 0x7f) << 14) | ((b[off + 2] & 0x7f) << 7) | (b[off + 3] & 0x7f);

/** Offset just past the leading ID3v2 tag(s), or why the file cannot be an MP3. */
function skipId3v2Tags(b: Uint8Array): { ok: true; offset: number } | { ok: false; code: "not_mp3" | "truncated" } {
  let off = 0;
  while (asciiAt(b, off, "ID3")) {
    if (off + 10 > b.length) return { ok: false, code: "truncated" };
    const major = b[off + 3];
    const sizeBytes = b[off + 6] | b[off + 7] | b[off + 8] | b[off + 9];
    if (major < 2 || major > 4 || b[off + 4] === 0xff || (sizeBytes & 0x80) !== 0) return { ok: false, code: "not_mp3" };
    const footer = major === 4 && (b[off + 5] & 0x10) !== 0 ? 10 : 0;
    const next = off + 10 + synchsafe(b, off + 6) + footer;
    if (next > b.length) return { ok: false, code: "truncated" };
    off = next;
  }
  return { ok: true, offset: off };
}

/** End of the audio region: strips trailing ID3v1, APEv2, Lyrics3v2 and appended ID3v2.4 tags. */
function audioRegionEnd(b: Uint8Array, start: number): number {
  let end = b.length;
  for (;;) {
    const room = end - start;
    let tagBytes = 0;
    if (room >= 128 && asciiAt(b, end - 128, "TAG")) {
      tagBytes = 128;
    } else if (room >= 32 && asciiAt(b, end - 32, "APETAGEX")) {
      // Footer: size covers the items and the footer; a 32-byte header precedes them when flagged.
      const size = uint32LE(b, end - 20);
      const hasHeader = uint32LE(b, end - 12) >>> 31 === 1;
      tagBytes = size >= 32 ? size + (hasHeader ? 32 : 0) : 0;
    } else if (room >= 15 && asciiAt(b, end - 9, "LYRICS200")) {
      const digits = String.fromCharCode(...b.subarray(end - 15, end - 9));
      tagBytes = /^\d{6}$/.test(digits) ? Number(digits) + 15 : 0;
    } else if (room >= 20 && asciiAt(b, end - 10, "3DI")) {
      tagBytes = synchsafe(b, end - 4) + 20;
    }
    if (tagBytes <= 0 || tagBytes > room) return end;
    end -= tagBytes;
  }
}

/** Xing/Info (LAME, FFmpeg) or VBRI (Fraunhofer) header carried by the first frame instead of audio. */
interface InfoFrame {
  declaredFrames: number | null;
  /** LAME/FFmpeg gapless info: samples the encoder added at the start and the end. */
  encoderDelay: number;
  encoderPadding: number;
}

function readInfoFrame(b: Uint8Array, off: number, h: FrameHeader): InfoFrame | null {
  const frameEnd = off + h.length;
  const sideInfo = h.version === 3 ? (h.channels === 1 ? 17 : 32) : h.channels === 1 ? 9 : 17;
  const x = off + 4 + sideInfo;
  if (x + 8 <= frameEnd && (asciiAt(b, x, "Xing") || asciiAt(b, x, "Info"))) {
    const flags = uint32BE(b, x + 4);
    let p = x + 8;
    let declaredFrames: number | null = null;
    if (flags & 0x1) {
      if (p + 4 <= frameEnd) declaredFrames = uint32BE(b, p) || null;
      p += 4;
    }
    if (flags & 0x2) p += 4; // byte count: encoders disagree on whether tags are included, so unused
    if (flags & 0x4) p += 100; // seek table
    if (flags & 0x8) p += 4; // quality
    let encoderDelay = 0;
    let encoderPadding = 0;
    // LAME tag: 9-byte encoder string, then delay/padding as two 12-bit values at offset 21.
    if (p + 24 <= frameEnd && (asciiAt(b, p, "LAME") || asciiAt(b, p, "Lav"))) {
      const packed = (b[p + 21] << 16) | (b[p + 22] << 8) | b[p + 23];
      encoderDelay = packed >> 12;
      encoderPadding = packed & 0xfff;
    }
    return { declaredFrames, encoderDelay, encoderPadding };
  }
  const v = off + 4 + 32; // VBRI always sits 32 bytes after the header
  if (v + 18 <= frameEnd && asciiAt(b, v, "VBRI")) {
    return { declaredFrames: uint32BE(b, v + 14) || null, encoderDelay: 0, encoderPadding: 0 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Frame walk
// ---------------------------------------------------------------------------

interface StreamScan {
  format: FrameHeader;
  audioFrames: number;
  /** Per channel, excluding the info frame. */
  audioSamples: number;
  audioBytes: number;
  /** Non-frame bytes inside the audio region: leading garbage and resync gaps. */
  junkBytes: number;
  regionBytes: number;
  info: InfoFrame | null;
}

type ScanOutcome = { ok: true; scan: StreamScan } | { ok: false; code: "not_mp3" | "truncated" | "too_short" };

/** Walks every frame like a decoder: find a 3-frame chain, then follow frames and resync over junk. */
function scanStream(b: Uint8Array): ScanOutcome {
  const tags = skipId3v2Tags(b);
  if (!tags.ok) return tags;
  const start = tags.offset;
  const end = audioRegionEnd(b, start);
  const regionBytes = end - start;
  const junkBudget = MP3_MAX_JUNK_RATIO * regionBytes;

  const searchEnd = Math.min(end, start + FIRST_FRAME_SEARCH_BYTES);
  let off = start;
  let format: FrameHeader | null = null;
  let endedBeforeChain = false;
  for (; off < searchEnd; off++) {
    if (b[off] !== 0xff) continue;
    const chain = chainAt(b, off, end);
    if (chain === "eof") {
      // Valid frames straight after the tags that simply run out: a real but tiny MP3.
      if (off === start) endedBeforeChain = true;
      continue;
    }
    if (chain) {
      format = chain;
      break;
    }
  }
  if (!format) return { ok: false, code: endedBeforeChain ? "too_short" : "not_mp3" };

  const firstFrameOffset = off;
  let junkBytes = off - start;
  let audioFrames = 0;
  let audioSamples = 0;
  let audioBytes = 0;
  let info: InfoFrame | null = null;

  while (off < end) {
    const h = readFrameHeader(b, off, end);
    if (h && sameStream(h, format)) {
      if (off + h.length > end) break; // cut-off last frame: a decoder drops it too
      if (off === firstFrameOffset) {
        info = readInfoFrame(b, off, h);
        if (info) {
          off += h.length;
          continue;
        }
      }
      audioFrames++;
      audioSamples += h.samples;
      audioBytes += h.length;
      off += h.length;
      continue;
    }
    // Resync: skip to the next position where a consistent chain starts, but stop as soon as the
    // junk alone exceeds the budget (the file is rejected anyway).
    let next = off + 1;
    while (next < end && junkBytes + (next - off) <= junkBudget && !(b[next] === 0xff && chainAt(b, next, end, format))) next++;
    junkBytes += next - off;
    off = next;
    if (junkBytes > junkBudget) break;
  }

  return { ok: true, scan: { format, audioFrames, audioSamples, audioBytes, junkBytes, regionBytes, info } };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function formatSeconds(seconds: number): string {
  return `${Math.round(seconds * 10) / 10} s`;
}

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

const reject = (code: Mp3RejectCode, reason: string): Mp3Rejection => ({ ok: false, code, reason });

const NOT_MP3_REASON = "This is not an MP3 file. Upload an MP3 (MPEG Layer III) audio file.";
const TRUNCATED_REASON = "The MP3 file is incomplete: it ends early. Download or export it again and re-upload it.";

/**
 * Validates MP3 bytes: magic bytes, a Layer III frame walk (≥ 3 consecutive frames, ≤ 2 % non-audio
 * bytes outside ID3v2/ID3v1/APE tags), a Xing/VBRI completeness check, a minimum duration, and a
 * music-metadata codec cross-check. Returns metadata, or a user-facing reason.
 */
export async function validateMp3(bytes: Uint8Array, options: ValidateMp3Options = {}): Promise<Mp3Validation> {
  const maxBytes = options.maxBytes ?? MP3_DEFAULT_MAX_BYTES;
  const minDuration = options.minDurationSeconds ?? MP3_DEFAULT_MIN_DURATION_SECONDS;

  if (bytes.length === 0) return reject("empty", "The file is empty.");
  if (bytes.length > maxBytes) return reject("too_large", `The file is larger than ${formatMegabytes(maxBytes)}.`);

  // 1. Magic bytes: an ID3v2 tag or an MPEG audio frame sync at byte 0 (rejects WAV, text, RIFF-wrapped MP3).
  const startsWithId3 = asciiAt(bytes, 0, "ID3");
  const startsWithSync = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (!startsWithId3 && !startsWithSync) return reject("not_mp3", NOT_MP3_REASON);

  // 2. Frame walk.
  const outcome = scanStream(bytes);
  if (!outcome.ok) {
    if (outcome.code === "truncated") return reject("truncated", TRUNCATED_REASON);
    if (outcome.code === "too_short") {
      return reject("too_short", `The audio is too short. It must be at least ${formatSeconds(minDuration)} long.`);
    }
    return reject("not_mp3", NOT_MP3_REASON);
  }
  const { scan } = outcome;
  if (scan.junkBytes > MP3_MAX_JUNK_RATIO * scan.regionBytes) {
    return reject("corrupt", "The MP3 file is damaged: part of it is not readable audio. Export it again and re-upload it.");
  }
  const declared = scan.info?.declaredFrames;
  if (declared && declared - scan.audioFrames > Math.max(DECLARED_FRAMES_TOLERANCE.frames, declared * DECLARED_FRAMES_TOLERANCE.ratio)) {
    return reject("truncated", TRUNCATED_REASON);
  }

  const frameSeconds = scan.audioSamples / scan.format.sampleRate;
  const gaplessTrim = (scan.info?.encoderDelay ?? 0) + (scan.info?.encoderPadding ?? 0);
  const playableSamples = gaplessTrim > 0 && gaplessTrim < scan.audioSamples ? scan.audioSamples - gaplessTrim : scan.audioSamples;
  const durationSeconds = playableSamples / scan.format.sampleRate;
  if (scan.audioFrames === 0 || durationSeconds < minDuration) {
    return reject(
      "too_short",
      `The audio is too short (${formatSeconds(durationSeconds)}). It must be at least ${formatSeconds(minDuration)} long.`,
    );
  }

  // 3. music-metadata cross-check + tags. The MIME type forces its MPEG parser, which is safe after step 2.
  let metadata: IAudioMetadata;
  try {
    const { parseBuffer } = await import("music-metadata");
    // duration: false — the frame walk is the duration source.
    metadata = await parseBuffer(bytes, { mimeType: "audio/mpeg" }, { duration: false, skipCovers: true });
  } catch {
    return reject("corrupt", "The MP3 file could not be read. Export it again and re-upload it.");
  }
  const format = metadata.format;
  if (format.container !== "MPEG" || !format.codec || !LAYER3_CODEC.test(format.codec) || format.lossless === true) {
    return reject("not_mp3", NOT_MP3_REASON);
  }

  return {
    ok: true,
    durationSeconds: Math.round(durationSeconds * 100) / 100,
    bitrateKbps: frameSeconds > 0 ? Math.round((scan.audioBytes * 8) / frameSeconds / 1000) : null,
    sampleRateHz: scan.format.sampleRate,
    channels: scan.format.channels,
    codec: format.codec,
    title: cleanTagText(metadata.common.title),
    artist: cleanTagText(metadata.common.artist),
  };
}

/** Truncates to at most `max` UTF-16 code units without splitting a surrogate pair. */
function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const char of text) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out.trimEnd();
}

/** Tag text without control characters or runs of whitespace, capped at 200 characters; null when empty. */
function cleanTagText(value: string | undefined): string | null {
  if (!value) return null;
  let printable = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    printable += code < 0x20 || code === 0x7f ? " " : char;
  }
  const cleaned = printable.replace(/\s+/g, " ").trim();
  return cleaned ? truncateText(cleaned, MAX_TAG_TEXT_LENGTH) : null;
}

/**
 * Track title fallback from a file name when the file has no title tag:
 * "C:\\Music\\01 - Blue_Moon.mp3" → "Blue Moon". Never returns an empty string.
 */
export function fileNameToTitle(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const title = base
    .replace(/\.[A-Za-z0-9]{1,5}$/, "") // extension
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Leading track numbers: "01 - ", "7. ", "02) ", or a zero-padded "03 ".
    .replace(/^(?:\d{1,3}\s*[-.)]\s+|0\d\s+)(?=\S)/, "");
  return truncateText(title, MAX_TAG_TEXT_LENGTH) || "Untitled";
}
