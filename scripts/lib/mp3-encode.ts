// WAV parsing and MP3 encoding with @breezystack/lamejs (docs/research/audio-tooling.md §3–4).
// Script-only: lamejs is a devDependency and needs ESM mode under tsx (scripts/package.json).
//
// lamejs validates almost nothing: a Float32Array input silently encodes to 0 bytes, invalid rates
// are resampled or snapped without notice, and it returns Int8Array despite its typings. Every
// public function here checks its inputs and fails loudly instead.
import { Mp3Encoder } from "@breezystack/lamejs";
import { normalizeLoudness, type NormalizeOptions, type PcmAudio } from "./pcm";

const MPEG1_RATES = new Set([32000, 44100, 48000]);
const MPEG2_RATES = new Set([16000, 22050, 24000, 8000, 11025, 12000]);
const MPEG1_KBPS = new Set([32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]);
const MPEG2_KBPS = new Set([8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]);

/** Checks a PCM buffer is something lamejs will encode faithfully; throws a descriptive error otherwise. */
export function assertEncodablePcm(pcm: PcmAudio, kbps: number): void {
  const { sampleRate, channels } = pcm;
  if (!Array.isArray(channels) || (channels.length !== 1 && channels.length !== 2)) {
    throw new TypeError("encodeMp3: PCM must have 1 or 2 channels");
  }
  for (const [index, channel] of channels.entries()) {
    if (!(channel instanceof Float32Array)) {
      throw new TypeError(`encodeMp3: channel ${index} must be a Float32Array of samples in [-1, 1]`);
    }
  }
  if (channels[0].length === 0) throw new RangeError("encodeMp3: PCM has no samples");
  if (channels.length === 2 && channels[1].length !== channels[0].length) {
    throw new RangeError("encodeMp3: channel lengths differ");
  }
  const mpeg1 = MPEG1_RATES.has(sampleRate);
  if (!mpeg1 && !MPEG2_RATES.has(sampleRate)) throw new RangeError(`encodeMp3: unsupported sample rate ${sampleRate} Hz`);
  if (!Number.isInteger(kbps) || !(mpeg1 ? MPEG1_KBPS : MPEG2_KBPS).has(kbps)) {
    throw new RangeError(`encodeMp3: ${kbps} kbps is not a valid MPEG-${mpeg1 ? "1" : "2"} Layer III bitrate at ${sampleRate} Hz`);
  }
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      if (!Number.isFinite(channel[i])) throw new RangeError(`encodeMp3: sample ${i} is not a finite number`);
    }
  }
}

/** Clamps to [-1, 1] and converts to signed 16-bit (the only input lamejs encodes correctly). */
export function floatToInt16(source: Float32Array): Int16Array {
  const out = new Int16Array(source.length);
  for (let i = 0; i < source.length; i++) {
    const s = source[i] > 1 ? 1 : source[i] < -1 ? -1 : source[i];
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Encodes planar float PCM to CBR MPEG Layer III (no ID3 tag, no Xing/LAME info frame). */
export function encodeMp3(pcm: PcmAudio, kbps = 128): Uint8Array {
  assertEncodablePcm(pcm, kbps);
  const left = floatToInt16(pcm.channels[0]);
  const right = pcm.channels.length === 2 ? floatToInt16(pcm.channels[1]) : undefined;

  const encoder = new Mp3Encoder(pcm.channels.length, pcm.sampleRate, kbps);
  const chunks: Uint8Array[] = [];
  const push = (chunk: Uint8Array | Int8Array) => {
    // lamejs returns Int8Array at runtime (its typings say Uint8Array): view the same bytes as unsigned.
    if (chunk.length > 0) chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  };
  const block = 1152 * 16; // any multiple of 1152 works; lamejs grows its output buffer as needed
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    push(right ? encoder.encodeBuffer(l, right.subarray(i, i + block)) : encoder.encodeBuffer(l));
  }
  push(encoder.flush());
  const mp3 = concat(chunks);
  if (mp3.length === 0) throw new Error("encodeMp3: the encoder produced no output");
  return mp3;
}

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

/** Parses RIFF/WAVE with 16-bit integer PCM (format 1, or 0xFFFE extensible with the PCM subformat). */
export function parseWav(bytes: Uint8Array): PcmAudio {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("parseWav: expected the WAV file as a Uint8Array");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("parseWav: not a RIFF/WAVE file");
  let fmt: { format: number; channels: number; sampleRate: number; bits: number; blockAlign: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.length) throw new Error("parseWav: truncated fmt chunk");
      let format = view.getUint16(body, true);
      if (format === 0xfffe && size >= 40) format = view.getUint16(body + 24, true); // SubFormat GUID, first 2 bytes
      fmt = {
        format,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("parseWav: data chunk before fmt chunk");
      if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`parseWav: need 16-bit PCM, got format ${fmt.format}/${fmt.bits}-bit`);
      if (fmt.channels < 1 || fmt.channels > 2) throw new Error(`parseWav: ${fmt.channels} channels unsupported`);
      if (fmt.blockAlign !== fmt.channels * 2) throw new Error(`parseWav: unexpected block alignment ${fmt.blockAlign}`);
      const available = Math.min(size, bytes.length - body); // streaming writers may leave size = 0xFFFFFFFF
      const frames = Math.floor(available / fmt.blockAlign);
      const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++) {
          channels[c][i] = view.getInt16(body + i * fmt.blockAlign + c * 2, true) / 32768;
        }
      }
      return { sampleRate: fmt.sampleRate, channels };
    }
    offset = body + size + (size & 1); // chunks are word-aligned
  }
  throw new Error("parseWav: no data chunk");
}

/** Minimal 16-bit PCM WAV writer (test fixtures). */
export function encodeWav16(pcm: PcmAudio): Uint8Array {
  const channelCount = pcm.channels.length;
  const frames = pcm.channels[0].length;
  const dataBytes = frames * channelCount * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < 4; i++) out[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  const ints = pcm.channels.map(floatToInt16);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) view.setInt16(44 + (i * channelCount + c) * 2, ints[c][i], true);
  }
  return out;
}

/** Linear-interpolation resampler (fine for speech; integer ratios such as 22050 → 44100 are exact at the source points). */
export function resampleLinear(pcm: PcmAudio, targetRate: number): PcmAudio {
  if (pcm.sampleRate === targetRate) return pcm;
  const ratio = pcm.sampleRate / targetRate;
  const outLength = Math.floor(pcm.channels[0].length / ratio);
  const channels = pcm.channels.map((source) => {
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const x = i * ratio;
      const j = Math.floor(x);
      const frac = x - j;
      out[i] = source[j] * (1 - frac) + source[Math.min(j + 1, source.length - 1)] * frac;
    }
    return out;
  });
  return { sampleRate: targetRate, channels };
}

export interface WavToMp3Options {
  /** Output sample rate. Default 44100 (matches ElevenLabs mp3_44100_128 and the music). */
  sampleRate?: number;
  /** Default 128 at 32–48 kHz, 64 at 16–24 kHz. */
  kbps?: number;
  /** Silence added before and after the audio, in seconds. Default 0.25. */
  padSeconds?: number;
  /** Default { targetLufs: -16, ceilingDbfs: -1 }; false keeps the original level. */
  normalize?: NormalizeOptions | false;
}

/** Decodes a 16-bit PCM WAV, resamples, pads, loudness-normalises and encodes it as MP3. */
export function wavToMp3(wav: Uint8Array, options: WavToMp3Options = {}): Uint8Array {
  const { sampleRate = 44100, padSeconds = 0.25, normalize = {} } = options;
  if (!(padSeconds >= 0)) throw new RangeError("wavToMp3: padSeconds must be >= 0");
  let pcm = resampleLinear(parseWav(wav), sampleRate);
  if (padSeconds > 0) {
    const pad = Math.round(padSeconds * sampleRate);
    pcm = {
      sampleRate,
      channels: pcm.channels.map((channel) => {
        const out = new Float32Array(channel.length + 2 * pad);
        out.set(channel, pad);
        return out;
      }),
    };
  }
  if (normalize !== false) normalizeLoudness(pcm, normalize);
  return encodeMp3(pcm, options.kbps ?? (sampleRate >= 32000 ? 128 : 64));
}
