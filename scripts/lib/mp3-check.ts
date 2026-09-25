// Strict frame-level sanity check for MP3s WE generate. Deliberately stricter than the upload
// validator (src/lib/audio/mp3.ts): our encoder output must be an optional ID3v2 tag followed by
// back-to-back Layer III frames with identical format to the last byte — no junk, no cut-off frame.

export interface Mp3FrameReport {
  frames: number;
  /** frames × samples-per-frame / sample rate (what a decoder plays, incl. encoder delay/padding). */
  durationSeconds: number;
  sampleRate: number;
  /** Average over all frames. */
  bitrateKbps: number;
  channels: 1 | 2;
  mpegVersion: "1" | "2" | "2.5";
  /** Size of the leading ID3v2 tag (0 when absent). */
  tagBytes: number;
}

const KBPS_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const KBPS_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Readonly<Record<number, readonly number[]>> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};
const VERSION_NAMES: Readonly<Record<number, Mp3FrameReport["mpegVersion"]>> = { 3: "1", 2: "2", 0: "2.5" };

interface Header {
  version: number;
  sampleRate: number;
  channels: 1 | 2;
  length: number;
  samples: number;
}

function readHeader(b: Uint8Array, offset: number): Header | null {
  if (offset + 4 > b.length || b[offset] !== 0xff || (b[offset + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[offset + 1] >> 3) & 3;
  const layer = (b[offset + 1] >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const bitrateIndex = b[offset + 2] >> 4;
  const rateIndex = (b[offset + 2] >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const kbps = (version === 3 ? KBPS_V1_L3 : KBPS_V2_L3)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const padding = (b[offset + 2] >> 1) & 1;
  const samples = version === 3 ? 1152 : 576;
  const channels = (b[offset + 3] >> 6) === 3 ? 1 : 2;
  return { version, sampleRate, channels, samples, length: Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding };
}

function id3v2Length(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

/** Walks every frame; throws a descriptive Error on the first irregularity. */
export function inspectGeneratedMp3(bytes: Uint8Array): Mp3FrameReport {
  const tagBytes = id3v2Length(bytes);
  if (tagBytes > bytes.length) throw new Error("MP3 check: the ID3v2 tag is longer than the file");
  let offset = tagBytes;
  const first = readHeader(bytes, offset);
  if (!first) throw new Error(`MP3 check: no MPEG Layer III frame header at byte ${offset}`);
  let frames = 0;
  let samples = 0;
  let audioBytes = 0;
  while (offset < bytes.length) {
    const header = readHeader(bytes, offset);
    if (!header) throw new Error(`MP3 check: invalid frame header at byte ${offset} (after ${frames} frames)`);
    if (header.version !== first.version || header.sampleRate !== first.sampleRate || header.channels !== first.channels) {
      throw new Error(`MP3 check: frame ${frames} changes format (version/sample rate/channels)`);
    }
    if (offset + header.length > bytes.length) throw new Error(`MP3 check: frame ${frames} is cut off at the end of the file`);
    frames++;
    samples += header.samples;
    audioBytes += header.length;
    offset += header.length;
  }
  if (frames < 3) throw new Error(`MP3 check: only ${frames} frame(s)`);
  const durationSeconds = samples / first.sampleRate;
  return {
    frames,
    durationSeconds,
    sampleRate: first.sampleRate,
    bitrateKbps: Math.round((audioBytes * 8) / durationSeconds / 1000),
    channels: first.channels,
    mpegVersion: VERSION_NAMES[first.version],
    tagBytes,
  };
}
