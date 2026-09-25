/**
 * Audio fixtures generated in-test: real MP3 frames from @breezystack/lamejs plus hand-built tags,
 * Xing/VBRI info frames, WAV files and deterministic junk. Nothing binary is committed.
 */
import { Mp3Encoder } from "@breezystack/lamejs";

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
}

/** Deterministic pseudo-random bytes (mulberry32). */
export function randomBytes(length: number, seed = 1): Uint8Array {
  let state = seed >>> 0;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
  }
  return out;
}

export interface ToneOptions {
  seconds: number;
  sampleRate?: number;
  channels?: 1 | 2;
  kbps?: number;
  frequency?: number;
}

/** A sine tone encoded as CBR MP3 by lamejs (plain frames: no ID3 tag, no Xing/LAME info frame). */
export function encodeToneMp3({ seconds, sampleRate = 44100, channels = 2, kbps = 128, frequency = 440 }: ToneOptions): Uint8Array {
  const length = Math.round(seconds * sampleRate);
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.3 * 0x7fff);

  const encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const chunks: Uint8Array[] = [];
  // lamejs returns Int8Array at runtime (its types say Uint8Array); copy the bytes as unsigned.
  const push = (chunk: Uint8Array | Int8Array) => {
    if (chunk.length > 0) chunks.push(Uint8Array.from(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
  };
  const block = 1152 * 16;
  for (let i = 0; i < length; i += block) {
    const part = pcm.subarray(i, i + block);
    push(channels === 2 ? encoder.encodeBuffer(part, part) : encoder.encodeBuffer(part));
  }
  push(encoder.flush());
  return concatBytes(...chunks);
}

/** Offsets of consecutive MPEG Layer III frames in a tag-free stream (independent re-implementation for assertions). */
export function mpegFrameOffsets(bytes: Uint8Array): number[] {
  const kbpsV1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const kbpsV2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const rates: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const offsets: number[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0) {
    const version = (bytes[offset + 1] >> 3) & 3;
    const mpeg1 = version === 3;
    const kbps = (mpeg1 ? kbpsV1 : kbpsV2)[bytes[offset + 2] >> 4];
    const sampleRate = rates[version][(bytes[offset + 2] >> 2) & 3];
    const length = Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / sampleRate) + ((bytes[offset + 2] >> 1) & 1);
    if (offset + length > bytes.length) break;
    offsets.push(offset);
    offset += length;
  }
  return offsets;
}

/** Samples per frame for the stream's MPEG version (1152 for MPEG-1, 576 otherwise). */
export function samplesPerFrame(bytes: Uint8Array): number {
  return ((bytes[1] >> 3) & 3) === 3 ? 1152 : 576;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function synchsafeBytes(size: number): number[] {
  return [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f];
}

/** Latin-1 ID3v2.3 tag with TIT2 (title) and TPE1 (artist) frames. */
export function id3v23Tag(title: string, artist: string): Uint8Array {
  const frames = (
    [
      ["TIT2", title],
      ["TPE1", artist],
    ] as const
  ).map(([id, text]) => {
    const frame = new Uint8Array(11 + text.length);
    frame.set(asciiBytes(id));
    new DataView(frame.buffer).setUint32(4, 1 + text.length); // v2.3 frame size: plain big-endian
    frame.set(asciiBytes(text), 11); // frame[10] = 0: ISO-8859-1
    return frame;
  });
  const body = concatBytes(...frames);
  return concatBytes(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, ...synchsafeBytes(body.length)]), body);
}

/** ID3v2 header that claims `declaredSize` bytes of tag data (for truncation tests). */
export function id3v2Header(declaredSize: number): Uint8Array {
  return new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, ...synchsafeBytes(declaredSize)]);
}

/** 128-byte ID3v1 tag appended at the end of a file. */
export function id3v1Tag(title: string, artist: string): Uint8Array {
  const tag = new Uint8Array(128);
  tag.set(asciiBytes("TAG"));
  tag.set(asciiBytes(title.slice(0, 30)), 3);
  tag.set(asciiBytes(artist.slice(0, 30)), 33);
  tag[127] = 255; // genre: none
  return tag;
}

/** APEv2 tag with a header and footer; `binarySize` adds a large binary item (like embedded cover art). */
export function apeV2Tag(title: string, binarySize = 0): Uint8Array {
  const item = (key: string, value: Uint8Array, binary: boolean) => {
    const head = new Uint8Array(8);
    const view = new DataView(head.buffer);
    view.setUint32(0, value.length, true);
    view.setUint32(4, binary ? 1 << 1 : 0, true); // item type: 0 = UTF-8 text, 1 = binary
    return concatBytes(head, asciiBytes(key), new Uint8Array([0]), value);
  };
  const items = [item("Title", asciiBytes(title), false)];
  if (binarySize > 0) items.push(item("Cover Art (Front)", concatBytes(asciiBytes("cover.jpg\0"), randomBytes(binarySize, 7)), true));
  const body = concatBytes(...items);
  const block = (isHeader: boolean) => {
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);
    bytes.set(asciiBytes("APETAGEX"));
    view.setUint32(8, 2000, true);
    view.setUint32(12, body.length + 32, true); // items + footer
    view.setUint32(16, items.length, true);
    view.setUint32(20, (1 << 31) | (isHeader ? 1 << 29 : 0), true); // has header; this block is the header
    return bytes;
  };
  return concatBytes(block(true), body, block(false));
}

// ---------------------------------------------------------------------------
// Info frames (MPEG-1 Layer III, 44.1 kHz, 128 kbps, no padding: 417 bytes)
// ---------------------------------------------------------------------------

const INFO_FRAME_HEADER = [0xff, 0xfb, 0x90, 0x64]; // joint stereo ⇒ side info is 32 bytes
const INFO_FRAME_LENGTH = 417;

/** LAME-style "Info" frame declaring `frames` audio frames, with encoder delay/padding in the LAME tag. */
export function xingInfoFrame(frames: number, lame?: { delay: number; padding: number }): Uint8Array {
  const frame = new Uint8Array(INFO_FRAME_LENGTH);
  const view = new DataView(frame.buffer);
  frame.set(INFO_FRAME_HEADER);
  const x = 4 + 32;
  frame.set(asciiBytes("Info"), x);
  view.setUint32(x + 4, 0x0f, false); // frames, bytes, TOC, quality
  view.setUint32(x + 8, frames, false);
  view.setUint32(x + 12, frames * INFO_FRAME_LENGTH, false);
  // TOC (100 bytes) and quality (4 bytes) stay zero.
  const lameOffset = x + 8 + 4 + 4 + 100 + 4;
  if (lame) {
    frame.set(asciiBytes("LAME3.100"), lameOffset);
    const packed = (lame.delay << 12) | lame.padding;
    frame.set([(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff], lameOffset + 21);
  }
  return frame;
}

/** Fraunhofer "VBRI" frame declaring `frames` audio frames. */
export function vbriInfoFrame(frames: number): Uint8Array {
  const frame = new Uint8Array(INFO_FRAME_LENGTH);
  const view = new DataView(frame.buffer);
  frame.set(INFO_FRAME_HEADER);
  const v = 4 + 32;
  frame.set(asciiBytes("VBRI"), v);
  view.setUint16(v + 4, 1, false); // version
  view.setUint16(v + 6, 0, false); // delay
  view.setUint16(v + 8, 75, false); // quality
  view.setUint32(v + 10, frames * INFO_FRAME_LENGTH, false); // bytes
  view.setUint32(v + 14, frames, false); // frames
  view.setUint16(v + 18, 0, false); // TOC entries
  view.setUint16(v + 20, 1, false); // scale
  view.setUint16(v + 22, 2, false); // bytes per entry
  view.setUint16(v + 24, 0, false); // frames per entry
  return frame;
}

// ---------------------------------------------------------------------------
// Non-MP3 files
// ---------------------------------------------------------------------------

/** 16-bit PCM mono WAV of silence. */
export function wavFile(seconds: number, sampleRate = 44100): Uint8Array {
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  bytes.set(asciiBytes("RIFF"));
  view.setUint32(4, 36 + dataBytes, true);
  bytes.set(asciiBytes("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(asciiBytes("data"), 36);
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/** An MP3 stream wrapped in a RIFF/WAVE container (format 0x55), which browsers do not play as MP3. */
export function riffWrappedMp3(mp3: Uint8Array): Uint8Array {
  const header = wavFile(0);
  const view = new DataView(header.buffer);
  view.setUint16(20, 0x55, true);
  view.setUint32(40, mp3.length, true);
  view.setUint32(4, 36 + mp3.length, true);
  return concatBytes(header, mp3);
}
