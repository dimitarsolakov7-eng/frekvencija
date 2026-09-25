# Audio tooling: demo assets, MP3 validation, SAPI speech, loudness

Researched 2026-09-25 for `scripts/generate-demo-audio.ts` (`npm run demo:audio`), `src/lib/audio/mp3.ts`
(`validateMp3`, used by `POST /api/admin/uploads/complete`) and the loudness of generated assets.
See `docs/ARCHITECTURE.md` §8 (uploads) and §11 (seeds and scripts).

**Evidence tags**

- **[RUN]**: executed on this machine: Windows 11, Node 24.19.0, tsx 4.23.15, tsc 5.9.3, Windows PowerShell
  5.1.26100, using the project's installed `node_modules`. The scratch layout mirrored the project: a root
  `package.json` without `"type"`, plus `scripts/package.json` = `{"type":"module"}`. Every TypeScript block in
  §4, §6, §7 and §9 was typechecked with the project's compiler options (strict, `moduleResolution: bundler`),
  linted with the project's ESLint config, and run. The PowerShell blocks were run too.
- **[SRC]**: read from installed package source (`node_modules/...`).
- **[BUILD]**: a throwaway Next.js 16.3.6 app (Turbopack) had a route handler that calls `validateMp3`.
  Ran `next build` then `next start`, and POSTed real files to it.
- **[BROWSER]**: decoded in Chromium (Browser pane) with `AudioContext.decodeAudioData` and `<audio>`.
- **UNVERIFIED**: not executed. Treat as inference.

Spike sources (runnable) are in the session scratchpad under `scratchpad/audio-tooling/`:
`scripts/lib/*`, `src/lib/audio/mp3.ts`, `scripts/generate-demo-audio.ts`, and tests in `scripts/spike/*`.

---

## 1. Decisions (TL;DR)

1. **Add `scripts/package.json` containing `{"type":"module"}`** (a new file; the root `package.json` is
   unchanged). Without it, `tsx scripts/*.ts` runs in **CommonJS mode**. In that mode
   `import { Mp3Encoder } from "@breezystack/lamejs"` is `undefined`, and music-metadata's `parseBuffer`
   throws `UnsupportedFileTypeError` [RUN]. See §2.
2. **In `src/lib/audio/mp3.ts`, load music-metadata with `await import("music-metadata")` inside
   `validateMp3`.** When a script imports this file, tsx still treats it as CJS (it is outside `scripts/`), and
   only the dynamic import works there. The dynamic import also works in the Next build, in Vitest and in plain
   Node [RUN][BUILD].
3. **Do not put `import "server-only"` in `src/lib/audio/mp3.ts`.** Under tsx, `server-only` throws unless
   Node runs with `--conditions=react-server`, and `npm run demo:audio` / `seed:dev` cannot pass that
   flag [RUN]. The module is pure computation and holds no secrets.
4. **Next.js needs no `serverExternalPackages` entry for music-metadata.** Turbopack bundles it, with each
   parser in its own lazy chunk [BUILD]. music-metadata is not on Next's built-in external list [SRC].
5. **Validation = magic bytes + our own MPEG frame walk + music-metadata cross-check** (§6).
   music-metadata alone is not enough, because with `mimeType: "audio/mpeg"` it **never throws**: it
   "parses" a WAV, random bytes and a text file without error. It also accepts 4 KB of real MP3 followed by
   300 KB of garbage as a 19.5 s CBR file [RUN].
6. **Duration comes from our frame count, not from music-metadata.** For any file whose first three
   frames share a bitrate, music-metadata calls it CBR and estimates the duration from the file size,
   **even with `duration: true`** [SRC][RUN]. On a 1202 s file of alternating 128/192 kbps segments with no
   Xing header, it reported 1001.7 s [RUN].
   The frame walk matches what the browser decodes [BROWSER].
7. **Demo loops: `generateToneTrack()`** produces 20 s of stereo MPEG-1 Layer III at 128 kbps (320,574 B).
   The output is deterministic: the same options give byte-identical bytes [RUN]. It takes ~2.3 s per track
   (synthesis ~1.0 s plus encoding ~1.1 s).
8. **Speech: Windows SAPI via Windows PowerShell 5.1**, which has two voices here: Microsoft David and Zira
   (en-US). Write a 16-bit mono WAV, then run `wavToMp3()` to get 44.1 kHz / 128 kbps mono MP3, which matches
   ElevenLabs `mp3_44100_128`. SAPI only speaks English on this machine. For other languages, use the chime
   placeholder.
9. **Loudness: normalise every generated asset to -16 LUFS integrated (ITU-R BS.1770), with a -1 dBFS
   sample-peak ceiling.** Measure mono as dual-mono. The player already plays music at `MUSIC_GAIN = 0.85`
   (-1.4 dB), so announcements land ~1.4 dB above music, which is where speech sits comfortably. On iPhone,
   element volume is locked, so baked-in loudness is all you get (see `browser-audio.md` §1.3 and §5.1). Measured raw
   SAPI output is already ≈ -16 to -17 LUFS [RUN].

## 2. Module-system gotchas under tsx (read this first)

The root `package.json` has no `"type"` field, so `tsx scripts/foo.ts` treats `.ts` files as CommonJS [RUN].

| Import, in a CJS-mode `.ts` under tsx | Result [RUN] |
| --- | --- |
| `import { Mp3Encoder } from "@breezystack/lamejs"` | `Mp3Encoder === undefined`. The package's `require` condition points at `dist/lamejs.iife.js`, which exports nothing when `require`d (`require(...)` returns `{}`). |
| `await import("@breezystack/lamejs")` | works (`Mp3Encoder` is a function) |
| `import { parseBuffer } from "music-metadata"` | import succeeds, but **every call throws** `UnsupportedFileTypeError: Guessed MIME-type not supported: audio/mpeg`, even with `mimeType` set. Likely cause: tsx converts the ESM dependency to CJS, so `import ContentType from 'content-type'` in `ParserFactory.js` becomes `undefined`. The same default import is `undefined` in a CJS-mode tsx file [RUN]. |
| `await import("music-metadata")` | works |
| `import "server-only"` | throws `This module cannot be imported from a Client Component module…`. It works only with `tsx --conditions=react-server`. |
| top-level `await` | not allowed in CJS mode |

With `scripts/package.json` = `{"type":"module"}`, the scripts run as ESM, so static imports of both
packages and top-level `await` work. Any `src/**` file that a script imports **is still CJS**, which is why
`src/lib/audio/mp3.ts` uses the dynamic import [RUN]. Plain `node` (without tsx) can `require("music-metadata")`
through the `module-sync` condition [RUN]. Vitest resolves both packages as ESM, and a test that imports
`scripts/lib/audio.ts` and `src/lib/audio/mp3.ts` passed [RUN].

## 3. `@breezystack/lamejs` 1.2.7

- **Exports** [SRC]: `"exports": { "default": { "import": "./dist/lamejs.js", "require": "./dist/lamejs.iife.js",
  "types": "./type.d.ts" } }`. The ESM build exports `Mp3Encoder` and `WavHeader`, plus `default` =
  `{ Mp3Encoder, WavHeader }`. **Use the named import.** Both `import { Mp3Encoder }` and
  `import lame from` typecheck with the project options, because TS falls through `import` to the `types`
  condition [RUN].
- **Signatures** (`type.d.ts`, ambient `declare module`):

  ```ts
  class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number);
    encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array; // runtime: Int8Array
    flush(): Uint8Array;                                            // runtime: Int8Array
  }
  ```

- **Gotchas** [RUN]:
  - Both methods return **`Int8Array`** at runtime. View the bytes with
    `new Uint8Array(c.buffer, c.byteOffset, c.byteLength)`.
  - Input must be `Int16Array`. A `Float32Array` is accepted silently and produces **0 bytes**.
  - `kbps` snaps to the nearest valid rate: 999 → 320, 100 → 96, and 192 at 22050 Hz → 160. An invalid
    `sampleRate` is resampled silently (12345 → 16000 Hz, MPEG-2). `channels = 3` throws an opaque
    `TypeError`. Mismatched left/right lengths are not checked. `encodeMp3()` below validates all of these.
  - The output is plain CBR frames: no ID3 tag and no Xing/LAME info frame. Encoder delay plus padding
    adds ~36 ms (20.000 s in → 20.036 s decoded [BROWSER]), so the loops are **not gapless**.
  - Mono and stereo are both fine. MPEG-2 rates (16/22.05/24 kHz) give "MPEG 2 Layer 3", which decodes in
    Chromium [BROWSER].
  - Block size does not matter: 1152, 18432 or the whole buffer in one call all encode 20 s stereo in
    ~1.0–1.1 s [RUN].
  - The package is LGPL-3.0. It is a devDependency used only by local scripts and is never bundled into the app.
- **Speed** [RUN]: 20 s stereo 128 kbps in ~1.0–1.25 s, and 60 s in ~2.8–3.0 s (≈ 20× realtime).

## 4. Demo loops and WAV → MP3: `scripts/lib/audio.ts` (full code) [RUN]

`generateToneTrack(options)` synthesises pad + bass + pluck arpeggio + soft four-on-the-floor kick +
quiet off-beat hats over I–V–vi–IV. It fades in over 10 ms and out over 1.5 s, normalises to -16 LUFS, and
encodes. Vary `bpm`, `transpose` and `seed` per genre and track (`seed % 4` picks the arpeggio pattern, and
`seed / 4` rotates the starting chord). Measured on the default loop: -16.00 LUFS, peak -2.9 dBFS, no
limiting [RUN]. It decodes in Chromium at 20.036 s [BROWSER]. Nobody listened to it; "pleasant" is by
construction only (consonant triads, soft envelopes, no clipping).

`wavToMp3(wavBytes, options?)` parses a 16-bit PCM WAV (including SAPI's 18-byte `fmt ` chunk and
`WAVE_FORMAT_EXTENSIBLE`). It resamples to 44.1 kHz by default, pads 0.25 s of silence at each end,
normalises to -16 LUFS and encodes at 128 kbps. Do not use lamejs's `WavHeader`: its type declares
`readHeader` as an instance method, but it is static, and it throws a string on extensible `fmt` chunks [SRC].

```ts
// scripts/lib/audio.ts - PCM synthesis, loudness (ITU-R BS.1770), WAV parsing and MP3 encoding (@breezystack/lamejs).
// Script-only: lamejs is a devDependency. Needs ESM mode under tsx (scripts/package.json = {"type":"module"}).
import { Mp3Encoder } from "@breezystack/lamejs";

/** Planar float PCM. Samples are in [-1, 1]. channels.length is 1 (mono) or 2 (stereo). */
export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[];
}

// ---------------------------------------------------------------------------
// MP3 encoding
// ---------------------------------------------------------------------------

const MPEG1_RATES = new Set([32000, 44100, 48000]);
const MPEG2_RATES = new Set([16000, 22050, 24000, 8000, 11025, 12000]);
const MPEG1_KBPS = new Set([32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]);
const MPEG2_KBPS = new Set([8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]);

export function floatToInt16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const s = src[i] > 1 ? 1 : src[i] < -1 ? -1 : src[i];
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Encodes planar float PCM to a CBR MP3 (no ID3 tag, no Xing/LAME info frame). */
export function encodeMp3(pcm: PcmAudio, kbps = 128): Uint8Array {
  const { sampleRate, channels } = pcm;
  if (channels.length !== 1 && channels.length !== 2) throw new Error("encodeMp3: need 1 or 2 channels");
  const mpeg1 = MPEG1_RATES.has(sampleRate);
  if (!mpeg1 && !MPEG2_RATES.has(sampleRate)) throw new Error(`encodeMp3: unsupported sample rate ${sampleRate}`);
  if (!(mpeg1 ? MPEG1_KBPS : MPEG2_KBPS).has(kbps)) throw new Error(`encodeMp3: ${kbps} kbps invalid at ${sampleRate} Hz`);
  const left = floatToInt16(channels[0]);
  const right = channels.length === 2 ? floatToInt16(channels[1]) : undefined;
  if (right && right.length !== left.length) throw new Error("encodeMp3: channel lengths differ");

  const encoder = new Mp3Encoder(channels.length, sampleRate, kbps);
  const chunks: Uint8Array[] = [];
  const push = (c: Uint8Array | Int8Array) => {
    // lamejs really returns Int8Array (type.d.ts says Uint8Array); view the same bytes as unsigned.
    if (c.length > 0) chunks.push(new Uint8Array(c.buffer, c.byteOffset, c.byteLength));
  };
  const BLOCK = 1152 * 16; // any multiple of 1152 works; lamejs grows its output buffer as needed
  for (let i = 0; i < left.length; i += BLOCK) {
    push(right ? encoder.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK)) : encoder.encodeBuffer(left.subarray(i, i + BLOCK)));
  }
  push(encoder.flush());
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loudness: ITU-R BS.1770 integrated loudness (LUFS) + gain with a brick-wall look-ahead limiter
// ---------------------------------------------------------------------------

const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fromDb = (db: number) => Math.pow(10, db / 20);

export function peakDbfs(pcm: PcmAudio): number {
  let peak = 0;
  for (const ch of pcm.channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  return toDb(peak);
}

/**
 * Integrated loudness per ITU-R BS.1770-4 (K-weighting, 400 ms blocks with 75 % overlap,
 * -70 LUFS absolute gate, -10 LU relative gate). Mono is measured as dual-mono (+3.01 LU),
 * because browsers play a mono file on both speakers.
 */
export function integratedLufs(pcm: PcmAudio): number {
  const fs = pcm.sampleRate;
  // Stage 1: high shelf (+4 dB above ~1.7 kHz). Stage 2: high-pass (~38 Hz). Coefficients as in libebur128.
  let K = Math.tan((Math.PI * 1681.974450955533) / fs);
  const Q1 = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q1 + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q1 + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0],
  };
  K = Math.tan((Math.PI * 38.13547087602444) / fs);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  const highpass = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0] };
  const biquad = (x: Float32Array, f: { b: number[]; a: number[] }) => {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = f.b[0] * x[i] + f.b[1] * x1 + f.b[2] * x2 - f.a[0] * y1 - f.a[1] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };
  const weighted = pcm.channels.map((ch) => biquad(biquad(ch, shelf), highpass));
  const channelWeight = pcm.channels.length === 1 ? 2 : 1; // dual-mono
  const block = Math.round(0.4 * fs);
  const hop = Math.round(0.1 * fs);
  const blocks: number[] = [];
  for (let s = 0; s + block <= weighted[0].length; s += hop) {
    let z = 0;
    for (const ch of weighted) {
      let ms = 0;
      for (let i = s; i < s + block; i++) ms += ch[i] * ch[i];
      z += (channelWeight * ms) / block;
    }
    blocks.push(z);
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const aboveAbs = blocks.filter((z) => lufs(z) > -70);
  if (aboveAbs.length === 0) return -Infinity;
  const relGate = lufs(mean(aboveAbs)) - 10;
  return lufs(mean(aboveAbs.filter((z) => lufs(z) > relGate)));
}

/** In place: multiplies by `gainDb`, then a 5 ms look-ahead limiter guarantees |sample| <= ceiling. */
export function applyGainWithLimiter(pcm: PcmAudio, gainDb: number, ceilingDbfs = -1): number {
  const gain = fromDb(gainDb);
  const ceiling = fromDb(ceilingDbfs);
  const { channels, sampleRate } = pcm;
  const n = channels[0].length;
  const g = new Float32Array(n); // extra gain each sample needs so that |x * gain * g| <= ceiling
  let limitedSamples = 0;
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (const ch of channels) a = Math.max(a, Math.abs(ch[i] * gain));
    g[i] = a > ceiling ? ceiling / a : 1;
    if (a > ceiling) limitedSamples++;
  }
  // Attack (backward pass): ramp down over <= 5 ms so the gain is already low when the peak arrives.
  const attackStep = 1 / Math.max(1, Math.round(sampleRate * 0.005));
  for (let i = n - 2; i >= 0; i--) g[i] = Math.min(g[i], g[i + 1] + attackStep);
  // Release (forward pass): recover toward 1 with an ~80 ms time constant, never above the attack curve.
  const rel = 1 - Math.exp(-1 / (sampleRate * 0.08));
  for (let i = 1; i < n; i++) g[i] = Math.min(g[i], g[i - 1] + (1 - g[i - 1]) * rel);
  for (const ch of channels) for (let i = 0; i < n; i++) ch[i] *= gain * g[i];
  return limitedSamples;
}

export interface NormalizeOptions {
  /** Integrated loudness target. Default -16 LUFS for both music loops and speech. */
  targetLufs?: number;
  /** Sample-peak ceiling. Default -1 dBFS (headroom for MP3 overshoot). */
  ceilingDbfs?: number;
  /** Never boost more than this. Default 20 dB (avoids pumping up noise). */
  maxGainDb?: number;
}

/** In place: gain to the LUFS target, limiter for the peak ceiling, one correction pass for what the limiter took off. */
export function normalizeLoudness(pcm: PcmAudio, opts: NormalizeOptions = {}) {
  const { targetLufs = -16, ceilingDbfs = -1, maxGainDb = 20 } = opts;
  const beforeLufs = integratedLufs(pcm);
  if (!Number.isFinite(beforeLufs)) return { beforeLufs, afterLufs: beforeLufs, gainDb: 0, limitedSamples: 0, peakDbfs: peakDbfs(pcm) };
  const gainDb = Math.min(maxGainDb, targetLufs - beforeLufs);
  let limitedSamples = applyGainWithLimiter(pcm, gainDb, ceilingDbfs);
  const shortfall = targetLufs - integratedLufs(pcm);
  if (shortfall > 0.3 && limitedSamples > 0) limitedSamples += applyGainWithLimiter(pcm, Math.min(shortfall, 3), ceilingDbfs);
  return { beforeLufs, afterLufs: integratedLufs(pcm), gainDb, limitedSamples, peakDbfs: peakDbfs(pcm) };
}

// ---------------------------------------------------------------------------
// Synthesised demo track
// ---------------------------------------------------------------------------

export interface ToneTrackOptions {
  durationSeconds?: number; // default 20
  sampleRate?: number; // default 44100
  stereo?: boolean; // default true
  bpm?: number; // default 96 (one bar = 2.5 s)
  /** Semitones added to every note (vary per genre), default 0 = C major. */
  transpose?: number;
  /** One chord per bar: bass note + pad notes, MIDI numbers. Default I-V-vi-IV in C. */
  progression?: { bass: number; notes: number[] }[];
  kick?: boolean; // default true (soft four-on-the-floor)
  hats?: boolean; // default true (quiet off-beat noise ticks)
  arpeggio?: boolean; // default true
  /** Picks the arpeggio pattern (seed % 4) and the starting chord (seed / 4); same seed => identical bytes. */
  seed?: number;
  fadeOutSeconds?: number; // default 1.5
  kbps?: number; // default 128
  normalize?: NormalizeOptions | false; // default { targetLufs: -16, ceilingDbfs: -1 }
}

const DEFAULT_PROGRESSION = [
  { bass: 48, notes: [60, 64, 67] }, // C
  { bass: 43, notes: [59, 62, 67] }, // G (voice-led)
  { bass: 45, notes: [60, 64, 69] }, // Am
  { bass: 41, notes: [60, 65, 69] }, // F
];

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthesises the PCM for a pleasant chord loop (pad + bass + pluck arpeggio + soft kick + hats). */
export function synthesizeToneTrack(options: ToneTrackOptions = {}): PcmAudio {
  const {
    durationSeconds = 20, sampleRate = 44100, stereo = true, bpm = 96, transpose = 0,
    progression = DEFAULT_PROGRESSION, kick = true, hats = true, arpeggio = true, seed = 1,
    fadeOutSeconds = 1.5, normalize = {},
  } = options;
  const n = Math.round(durationSeconds * sampleRate);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rand = mulberry32(seed);
  const beat = 60 / bpm;
  const bar = beat * 4;

  // Adds one note. env(t) gives amplitude at t seconds after the start; pan in [-1, 1].
  const note = (start: number, dur: number, hz: number, amp: number, pan: number,
    env: (t: number) => number, harmonics: number[] = [1], detuneCents = 0) => {
    const s0 = Math.round(start * sampleRate);
    const s1 = Math.min(n, Math.round((start + dur) * sampleRate));
    const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
    const f = hz * Math.pow(2, detuneCents / 1200);
    for (let i = Math.max(0, s0); i < s1; i++) {
      const t = (i - s0) / sampleRate;
      let v = 0;
      for (let h = 0; h < harmonics.length; h++) v += harmonics[h] * Math.sin(2 * Math.PI * f * (h + 1) * t);
      v *= env(t);
      L[i] += v * gl;
      R[i] += v * gr;
    }
  };

  const bars = Math.ceil(durationSeconds / bar);
  const arpPatterns = [[0, 1, 2, 1, 0, 1, 2, 1], [0, 2, 1, 2, 0, 2, 1, 2], [2, 1, 0, 1, 2, 1, 0, 1], [0, 1, 2, 0, 1, 2, 0, 2]];
  const arp = arpPatterns[Math.abs(seed) % arpPatterns.length];
  const rotate = Math.floor(Math.abs(seed) / arpPatterns.length);
  for (let b = 0; b < bars; b++) {
    const chord = progression[(b + rotate) % progression.length];
    const t0 = b * bar;
    // Pad: slow attack, overlapping release into the next bar, two detuned voices for width.
    const padEnv = (t: number) => Math.min(1, t / 0.35) * (t > bar ? Math.max(0, 1 - (t - bar) / 0.6) : 1);
    for (const m of chord.notes) {
      const hz = midiHz(m + transpose);
      note(t0, bar + 0.6, hz, 0.07, -0.35, padEnv, [1, 0.25, 0.08], -5);
      note(t0, bar + 0.6, hz, 0.07, 0.35, padEnv, [1, 0.25, 0.08], 5);
    }
    // Bass: beats 1 and 3, decaying.
    for (const k of [0, 2]) {
      note(t0 + k * beat, beat * 1.9, midiHz(chord.bass + transpose), 0.22, 0,
        (t) => Math.min(1, t / 0.01) * Math.exp(-t / 0.5), [1, 0.35, 0.1]);
    }
    // Pluck arpeggio: eighth notes one octave up.
    if (arpeggio) {
      for (let e = 0; e < 8; e++) {
        const m = chord.notes[arp[e] % chord.notes.length] + 12 + transpose;
        note(t0 + e * (beat / 2), 0.6, midiHz(m), 0.06, e % 2 ? 0.4 : -0.4,
          (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.16), [1, 0.4, 0.15]);
      }
    }
    for (let k = 0; k < 4; k++) {
      const tb = t0 + k * beat;
      // Kick: pitch sweep 120 -> 45 Hz, integrated phase so there is no click.
      if (kick) {
        const s0 = Math.round(tb * sampleRate);
        const len = Math.round(0.35 * sampleRate);
        let phase = 0;
        for (let i = 0; i < len && s0 + i < n; i++) {
          const t = i / sampleRate;
          phase += (2 * Math.PI * (45 + 75 * Math.exp(-t / 0.035))) / sampleRate;
          const v = 0.45 * Math.sin(phase) * Math.exp(-t / 0.12) * Math.min(1, t / 0.002);
          L[s0 + i] += v;
          R[s0 + i] += v;
        }
      }
      // Hat: high-passed noise tick on the off-beat.
      if (hats) {
        const s0 = Math.round((tb + beat / 2) * sampleRate);
        const len = Math.round(0.05 * sampleRate);
        let prev = 0;
        for (let i = 0; i < len && s0 + i < n; i++) {
          const x = rand() * 2 - 1;
          const v = 0.05 * (x - prev) * Math.exp(-i / sampleRate / 0.012);
          prev = x;
          L[s0 + i] += v * 0.8;
          R[s0 + i] += v;
        }
      }
    }
  }

  // Fades: 10 ms in (no click), fadeOutSeconds out.
  const fin = Math.round(0.01 * sampleRate);
  const fout = Math.round(fadeOutSeconds * sampleRate);
  for (let i = 0; i < n; i++) {
    let g = 1;
    if (i < fin) g = i / fin;
    if (i > n - fout) g = Math.min(g, (n - i) / fout);
    L[i] *= g;
    R[i] *= g;
  }
  const pcm: PcmAudio = stereo
    ? { sampleRate, channels: [L, R] }
    : { sampleRate, channels: [L.map((v, i) => (v + R[i]) / 2)] };
  if (normalize !== false) normalizeLoudness(pcm, normalize);
  return pcm;
}

/** Synthesised demo loop as MP3 bytes (MPEG-1 Layer III CBR). */
export function generateToneTrack(options: ToneTrackOptions = {}): Uint8Array {
  return encodeMp3(synthesizeToneTrack(options), options.kbps ?? 128);
}

// ---------------------------------------------------------------------------
// WAV -> MP3
// ---------------------------------------------------------------------------

/** Parses a RIFF/WAVE file with 16-bit integer PCM (format 1, or 0xFFFE extensible with PCM subformat). */
export function parseWav(bytes: Uint8Array): PcmAudio {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("parseWav: not a RIFF/WAVE file");
  let fmt: { format: number; channels: number; sampleRate: number; bits: number; blockAlign: number } | null = null;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      let format = dv.getUint16(body, true);
      if (format === 0xfffe && size >= 40) format = dv.getUint16(body + 24, true); // SubFormat GUID first 2 bytes
      fmt = {
        format,
        channels: dv.getUint16(body + 2, true),
        sampleRate: dv.getUint32(body + 4, true),
        blockAlign: dv.getUint16(body + 12, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("parseWav: data chunk before fmt chunk");
      if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`parseWav: need 16-bit PCM, got format ${fmt.format}/${fmt.bits}-bit`);
      if (fmt.channels < 1 || fmt.channels > 2) throw new Error(`parseWav: ${fmt.channels} channels unsupported`);
      const available = Math.min(size, bytes.length - body); // streaming writers may leave size = 0xFFFFFFFF
      const frames = Math.floor(available / fmt.blockAlign);
      const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++) {
          channels[c][i] = dv.getInt16(body + i * fmt.blockAlign + c * 2, true) / 32768;
        }
      }
      return { sampleRate: fmt.sampleRate, channels };
    }
    off = body + size + (size & 1); // chunks are word-aligned
  }
  throw new Error("parseWav: no data chunk");
}

/** Linear-interpolation resampler (fine for speech; use an integer ratio such as 22050 -> 44100 when you can). */
export function resampleLinear(pcm: PcmAudio, targetRate: number): PcmAudio {
  if (pcm.sampleRate === targetRate) return pcm;
  const ratio = pcm.sampleRate / targetRate;
  const outLen = Math.floor(pcm.channels[0].length / ratio);
  const channels = pcm.channels.map((src) => {
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const x = i * ratio;
      const j = Math.floor(x);
      const frac = x - j;
      out[i] = src[j] * (1 - frac) + (src[Math.min(j + 1, src.length - 1)] ?? 0) * frac;
    }
    return out;
  });
  return { sampleRate: targetRate, channels };
}

export interface WavToMp3Options {
  /** Output sample rate. Default 44100 (matches ElevenLabs mp3_44100_128 and the music). */
  sampleRate?: number;
  /** Default 128 for 32-48 kHz, 64 for 16-24 kHz. */
  kbps?: number;
  /** Silence added before and after the speech, in seconds. Default 0.25. */
  padSeconds?: number;
  normalize?: NormalizeOptions | false; // default { targetLufs: -16, ceilingDbfs: -1 }
}

export function wavToMp3(wav: Uint8Array, options: WavToMp3Options = {}): Uint8Array {
  const { sampleRate = 44100, padSeconds = 0.25, normalize = {} } = options;
  let pcm = resampleLinear(parseWav(wav), sampleRate);
  if (padSeconds > 0) {
    const pad = Math.round(padSeconds * sampleRate);
    pcm = {
      sampleRate,
      channels: pcm.channels.map((ch) => {
        const out = new Float32Array(ch.length + 2 * pad);
        out.set(ch, pad);
        return out;
      }),
    };
  }
  if (normalize !== false) normalizeLoudness(pcm, normalize);
  const kbps = options.kbps ?? (sampleRate >= 32000 ? 128 : 64);
  return encodeMp3(pcm, kbps);
}

/** Minimal 16-bit PCM WAV writer (used to build test fixtures). */
export function encodeWav16(pcm: PcmAudio): Uint8Array {
  const ch = pcm.channels.length;
  const frames = pcm.channels[0].length;
  const dataBytes = frames * ch * 2;
  const buf = new Uint8Array(44 + dataBytes);
  const dv = new DataView(buf.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < 4; i++) buf[o + i] = s.charCodeAt(i); };
  w(0, "RIFF"); dv.setUint32(4, 36 + dataBytes, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, pcm.sampleRate, true); dv.setUint32(28, pcm.sampleRate * ch * 2, true);
  dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, dataBytes, true);
  const ints = pcm.channels.map(floatToInt16);
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) dv.setInt16(44 + (i * ch + c) * 2, ints[c][i], true);
  return buf;
}
```

## 5. music-metadata 11.16.1

- **ESM-only package** [SRC]: `"type": "module"`, exports `{ node: { import, "module-sync", types } →
  lib/index.js, default: { import, "module-sync", types } → lib/core.js }`, with no `require` condition.
  Its dependencies `file-type`, `strtok3` and `media-typer` are ESM too. Server code in Next.js is fine
  (§1.4), but mind tsx (§2).
- **Signature** [SRC]: `parseBuffer(uint8Array: Uint8Array, fileInfo?: IFileInfo | string, options?: IOptions):
  Promise<IAudioMetadata>`. `IOptions`: `duration`, `skipCovers`, `skipPostHeaders`, `includeChapters`,
  `observer`, `mkvUseIndex`.
  - `fileInfo.size` is **ignored** for buffers: strtok3 overwrites it with `uint8Array.length`.
  - A `mimeType` **forces** that parser, with no sniffing. Without one, `file-type` sniffs the first 4100 bytes.
  - Exported error classes: `CouldNotDetermineFileTypeError` and `UnsupportedFileTypeError` (also
    `UnexpectedFileContentError`, `FieldDecodingError`, `InternalParserError`); check `err.name`.
- **MP3 fields** [SRC][RUN]:
  - `format.container === "MPEG"`.
  - `format.codec` is `"MPEG 1 Layer 3" | "MPEG 2 Layer 3" | "MPEG 2.5 Layer 3"`. MP2 would be `… Layer 2`.
    For ADTS it is `container "ADTS/MPEG-4"`, `codec "AAC"`.
  - `lossless: false`.
  - `bitrate` in bit/s.
  - `sampleRate`.
  - `numberOfChannels` is 1 or 2, and joint stereo reports 2.
  - `codecProfile` is `"CBR"` or `"V0".."V9"`.
  - `tool` is `"LAME x.y"` only when a LAME tag exists; lamejs output has none.
  - `common.title` and `common.artist` come from ID3 (`undefined` when missing).
  - `quality.warnings[]` holds parse warnings.
- **Duration logic** [SRC]:
  - A Xing/Info/LAME header gives the exact duration.
  - Otherwise, if the first 3 frame bitrates are equal, it assumes **CBR, stops after 4 frames and
    estimates from file size** (`duration: true` does not change this).
  - Otherwise, only with `duration: true`, it counts every frame.

**What `parseBuffer` returns** (`{ duration: true, skipCovers: true }`) [RUN]:

| Input | `fileInfo = { mimeType: "audio/mpeg" }` | no `fileInfo` (sniff) |
| --- | --- | --- |
| lamejs 20 s stereo 128k | `MPEG`, `MPEG 1 Layer 3`, lossless false, 20.036 s, 128000, 44100 Hz, 2 ch, `CBR` | same |
| same + ID3v2.3 TIT2/TPE1 | same + `title "Emerald Groove"`, `artist "Demo Band"` | same |
| lamejs 22050 Hz mono 64k | `MPEG`, `MPEG 2 Layer 3`, 3.056 s, 64000, 22050 Hz, 1 ch | same |
| WAV renamed `.mp3` (3 s) | **no throw**: `ADTS/MPEG-4`, `AAC`, sampleRate `null`, duration `undefined`, warnings "Cannot determine bit-rate" | `WAVE`, `PCM`, lossless true, 3.000 s (plus a false-positive warning "Data chunk size exceeds file size", from a music-metadata bug) |
| 64 KB random | **no throw**: `ADTS/MPEG-2`, `AAC`, duration `undefined` | throws `CouldNotDetermineFileTypeError` "Failed to determine audio format" |
| 64 KB random starting `FF FB 90 64` | `MPEG`, `MPEG 2.5 Layer 1`, 0.064 s, warnings | same |
| ID3 tag + 64 KB random | **no throw**: `ADTS/MPEG-2`, `AAC`, 0.043 s, bitrate 3887813, title "x" | throws `CouldNotDetermineFileTypeError` |
| empty (0 B) | **no throw**: every `format` field `undefined`, `hasAudio: false` | throws `CouldNotDetermineFileTypeError` |
| first 1 KB of the MP3 | `MPEG 1 Layer 3`, **duration `undefined`** | same |
| first 50 % of the MP3 | valid, 10.005 s | same |
| 4 KB of MP3 + 300 KB random | **`MPEG 1 Layer 3`, `CBR`, 19.461 s, no warnings** | same |
| text file (3.6 KB) | **no throw**: all `undefined` (`lossless: false`, `hasAudio: true`) | throws `CouldNotDetermineFileTypeError` |

## 6. `validateMp3` / `isValidPlayableMp3`: `src/lib/audio/mp3.ts` (full code) [RUN][BUILD]

The rule, in order:

1. Reject a file that is empty or larger than `maxBytes` (50 MB for music, 10 MB for announcements).
2. **Magic bytes**: accept only a file that starts with `ID3` or with an MPEG frame sync
   (`b[0] === 0xFF && (b[1] & 0xE0) === 0xE0`). This rejects WAV, text, random data and RIFF-wrapped MP3.
3. **Frame walk**: skip the ID3v2 tag(s). Within 64 KB, find **3 consecutive Layer III frame headers**
   with the same MPEG version and sample rate, and with a valid bitrate and sample-rate index. Then walk
   every frame, resyncing like a decoder. Allowances:
   - A trailing ID3v1 tag is allowed.
   - A cut-off last frame is ignored.
   - Up to **2 % non-frame bytes** is allowed. More than that is rejected as `corrupt`.

   This step sets `durationSeconds` (frames × samples per frame / sample rate) and computes the average
   bitrate.
4. Reject if the duration is under `minDurationSeconds` (0.5 s by default).
5. **music-metadata cross-check** with `{ mimeType: "audio/mpeg" }` and `{ duration: false, skipCovers: true }`:
   - `container === "MPEG"`.
   - `codec` matches `/^MPEG (1|2|2\.5) Layer 3$/`.
   - `lossless === false`.
   - The channel count is 1 or 2.
   - Take `title` and `artist` from the tags.

```ts
// src/lib/audio/mp3.ts - validateMp3(bytes): ok + metadata, or a user-facing reason.
// Deliberately no `import "server-only"` (pure code; server-only throws when a tsx script imports it).
// music-metadata is imported dynamically: a static import breaks when tsx runs this file in CJS mode.

export type Mp3Validation =
  | {
      ok: true;
      durationSeconds: number;
      bitrateKbps: number | null;
      sampleRate: number;
      channels: 1 | 2;
      codec: string; // "MPEG 1 Layer 3" | "MPEG 2 Layer 3" | "MPEG 2.5 Layer 3"
      title: string | null;
      artist: string | null;
    }
  | { ok: false; code: Mp3RejectCode; reason: string };

export type Mp3RejectCode = "empty" | "too_large" | "not_mp3" | "corrupt" | "too_short" | "unreadable";

export interface ValidateMp3Options {
  maxBytes?: number; // default 50 MB (music bucket); use 10 MB for announcements
  minDurationSeconds?: number; // default 0.5
}

// --- MPEG audio frame header (Layer III only) ------------------------------------------

const KBPS_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const KBPS_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

interface FrameHeader {
  version: number; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  sampleRate: number;
  length: number; // bytes, including the 4-byte header
  samples: number; // 1152 (MPEG-1) or 576 (MPEG-2/2.5)
}

function readFrameHeader(b: Uint8Array, off: number): FrameHeader | null {
  if (off + 4 > b.length || b[off] !== 0xff || (b[off + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[off + 1] >> 3) & 3;
  const layer = (b[off + 1] >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const brIndex = b[off + 2] >> 4;
  const srIndex = (b[off + 2] >> 2) & 3;
  if (brIndex === 0 || brIndex === 15 || srIndex === 3) return null; // free-format / reserved
  const kbps = (version === 3 ? KBPS_V1_L3 : KBPS_V2_L3)[brIndex];
  const sampleRate = RATES[version][srIndex];
  const padding = (b[off + 2] >> 1) & 1;
  const samples = version === 3 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding;
  return { version, sampleRate, length, samples };
}

/** Byte offset just past an ID3v2 tag at `off` (handles repeated tags), else `off`. */
function skipId3v2(b: Uint8Array, off: number): number {
  while (off + 10 <= b.length && b[off] === 0x49 && b[off + 1] === 0x44 && b[off + 2] === 0x33) {
    const size = ((b[off + 6] & 0x7f) << 21) | ((b[off + 7] & 0x7f) << 14) | ((b[off + 8] & 0x7f) << 7) | (b[off + 9] & 0x7f);
    off += 10 + size + (b[off + 5] & 0x10 ? 10 : 0); // footer flag
  }
  return off;
}

/** Returns the first header when 3 consecutive, mutually consistent Layer III frame headers start at `off`. */
function chainAt(b: Uint8Array, off: number, want?: FrameHeader): FrameHeader | null {
  const first = readFrameHeader(b, off);
  if (!first || (want && (first.version !== want.version || first.sampleRate !== want.sampleRate))) return null;
  let p = off;
  let h = first;
  for (let k = 0; k < 2; k++) {
    p += h.length;
    const next = readFrameHeader(b, p);
    if (!next || next.version !== first.version || next.sampleRate !== first.sampleRate) return null;
    h = next;
  }
  return first;
}

interface FrameScan {
  frames: number;
  durationSeconds: number; // what a decoder will play (includes encoder delay/padding: +36 ms for lamejs output)
  sampleRate: number;
  audioBytes: number; // bytes covered by complete frames
  junkBytes: number; // non-frame bytes: leading garbage + resync gaps (trailing ID3v1 and a cut-off last frame excluded)
}

/** Walks every frame like a decoder would. The first 3-frame chain must start within 64 KB of the ID3v2 tag end. */
function scanFrames(b: Uint8Array): FrameScan | null {
  const start = skipId3v2(b, 0);
  let end = b.length; // a trailing ID3v1 tag (128 B starting "TAG") is not junk
  if (end - start >= 128 && b[end - 128] === 0x54 && b[end - 127] === 0x41 && b[end - 126] === 0x47) end -= 128;
  let off = start;
  let first: FrameHeader | null = null;
  while (off < Math.min(end, start + 65536) && !(first = b[off] === 0xff ? chainAt(b, off) : null)) off++;
  if (!first) return null;
  let frames = 0, samples = 0, audioBytes = 0;
  let junkBytes = off - start;
  while (off < end) {
    const h = readFrameHeader(b, off);
    if (h && h.version === first.version && h.sampleRate === first.sampleRate) {
      if (off + h.length > b.length) break; // last frame cut off (truncated upload): ignore it
      frames++;
      samples += h.samples;
      audioBytes += h.length;
      off += h.length;
      continue;
    }
    // Resync: skip ahead to the next position where a consistent 3-frame chain starts.
    // Stop once the junk alone is enough to reject the file (validateMp3 allows 2 %).
    const budget = 0.02 * (b.length - start) - junkBytes;
    let next = off + 1;
    while (next < end && next - off <= budget && !(b[next] === 0xff && chainAt(b, next, first))) next++;
    const skipped = next - off;
    junkBytes += skipped;
    off = next;
    if (skipped > budget) break;
  }
  return { frames, durationSeconds: samples / first.sampleRate, sampleRate: first.sampleRate, audioBytes, junkBytes };
}

const LAYER3_CODEC = /^MPEG (1|2|2\.5) Layer 3$/;

export async function validateMp3(bytes: Uint8Array, opts: ValidateMp3Options = {}): Promise<Mp3Validation> {
  const { maxBytes = 50 * 1024 * 1024, minDurationSeconds = 0.5 } = opts;
  if (bytes.length === 0) return { ok: false, code: "empty", reason: "The file is empty." };
  if (bytes.length > maxBytes) return { ok: false, code: "too_large", reason: `The file is larger than ${Math.round(maxBytes / 1048576)} MB.` };

  // 1. Magic bytes: ID3v2 tag or an MPEG audio frame sync at byte 0.
  const startsId3 = bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const startsSync = bytes.length >= 4 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (!startsId3 && !startsSync) return { ok: false, code: "not_mp3", reason: "This is not an MP3 file." };

  // 2. Frame walk: a real Layer III stream right after the tag, and almost no garbage between frames.
  const scan = scanFrames(bytes);
  if (!scan || scan.frames === 0) return { ok: false, code: "not_mp3", reason: "This is not an MP3 (MPEG Layer III) file." };
  if (scan.junkBytes > 0.02 * (scan.audioBytes + scan.junkBytes)) {
    return { ok: false, code: "corrupt", reason: "The MP3 file is damaged (unreadable audio data)." };
  }
  if (scan.durationSeconds < minDurationSeconds) {
    return { ok: false, code: "too_short", reason: `The audio must be at least ${minDurationSeconds} seconds long.` };
  }

  // 3. music-metadata cross-check + tags. mimeType forces its MPEG parser (no sniffing) - fine after step 2.
  let meta;
  try {
    const { parseBuffer } = await import("music-metadata");
    // duration: false - our frame walk is the duration source; music-metadata only estimates CBR length from file size.
    meta = await parseBuffer(bytes, { mimeType: "audio/mpeg" }, { duration: false, skipCovers: true });
  } catch {
    return { ok: false, code: "unreadable", reason: "The MP3 file could not be read." };
  }
  const f = meta.format;
  if (f.container !== "MPEG" || !f.codec || !LAYER3_CODEC.test(f.codec) || f.lossless !== false ||
      (f.numberOfChannels !== 1 && f.numberOfChannels !== 2)) {
    return { ok: false, code: "not_mp3", reason: "This is not an MP3 (MPEG Layer III) file." };
  }
  return {
    ok: true,
    // Frame count is what the browser will actually play; music-metadata's CBR duration is a file-size estimate.
    durationSeconds: Math.round(scan.durationSeconds * 100) / 100,
    bitrateKbps: Math.round((scan.audioBytes * 8) / scan.durationSeconds / 1000),
    sampleRate: scan.sampleRate,
    channels: f.numberOfChannels as 1 | 2,
    codec: f.codec,
    title: meta.common.title?.trim() || null,
    artist: meta.common.artist?.trim() || null,
  };
}

export async function isValidPlayableMp3(bytes: Uint8Array): Promise<boolean> {
  return (await validateMp3(bytes)).ok;
}
```

**Results** [RUN]. The same outcomes came back through the Next.js route handler [BUILD].

| Input | Result |
| --- | --- |
| lamejs 20 s stereo | ok: 20.04 s, 128 kbps, 44100 Hz, 2 ch, `MPEG 1 Layer 3` |
| lamejs + ID3v2.3 | ok, `title "Emerald Groove"`, `artist "Demo Band"` |
| lamejs 22050 Hz mono 64k | ok: 3.06 s, `MPEG 2 Layer 3` |
| lamejs + ID3v1 trailer / + 2 KB APE-like trailer | ok, 20.04 s (the trailer does not inflate the duration) |
| 128k + 192k frames concatenated (no Xing) | ok: 8.1 s, 160 kbps average |
| first 50 % of an MP3 | ok, 10 s |
| lamejs 0.3 s | `too_short` |
| first 1 KB of an MP3 | `too_short` |
| WAV renamed, text, 64 KB random | `not_mp3` "This is not an MP3 file." |
| random starting `FF FB`, ID3 + random | `not_mp3` "This is not an MP3 (MPEG Layer III) file." |
| empty | `empty` |
| 4 KB MP3 + 300 KB random | `corrupt` |

**Performance** [RUN]:

- 20 s file: ~1–3 ms warm. The first call in a process costs ~140–175 ms extra, for the cold
  `import("music-metadata")`.
- 48 MB, 50-minute file: 44 ms warm, heap ~14 MB.
- 48 MB of junk after 3 frames: rejected in 7 ms (early exit).

**Wiring** (UNVERIFIED against a live Supabase): convert the downloaded object with
`new Uint8Array(await blob.arrayBuffer())` from `storage.from(bucket).download(path)`. Store:

- `durationSeconds` → `duration_seconds` / `audio_duration_seconds`
- `bitrateKbps` → `AdminTrack.bitrateKbps`
- `title` / `artist` → form defaults

On `ok: false`, return `unsupported_media` with `reason`, and delete the object.

**Known rejections, by design**:

- free-format bitrate streams
- MP3 inside RIFF/WAV
- files that change sample rate mid-stream
- files with more than 2 % junk, including very large APEv2/Lyrics3 trailers on very small files

## 7. Windows SAPI speech → WAV → MP3 [RUN]

- **Only Windows PowerShell 5.1 (`powershell.exe`) has `System.Speech`.** It is a .NET Framework
  assembly, and PowerShell 7 (`pwsh`) is not installed here [RUN]. The equivalent .NET 5+ package is
  UNVERIFIED and not needed.
- **Installed voices** (`GetInstalledVoices()`):

  | Name | Culture | Gender | Age | Id |
  | --- | --- | --- | --- | --- |
  | Microsoft David Desktop | en-US | Male | Adult | TTS_MS_EN-US_DAVID_11.0 |
  | Microsoft Zira Desktop | en-US | Female | Adult | TTS_MS_EN-US_ZIRA_11.0 |

- **What SAPI writes**: RIFF/WAVE with an 18-byte `fmt ` chunk (format 1, `cbSize` 0), mono,
  16-bit, at the requested rate. "You're listening to EmeraldBar Radio." at 22050 Hz gives 123,918 B and
  2.81 s. Raw loudness is -16.1 LUFS (dual-mono), peak -3.4 dBFS. David peaks at -0.3 dBFS, so the -1 dBFS
  limiter touches ~25 samples.
- **Timing**: the first call in a session takes ~2.1–2.2 s (cold .NET and `Add-Type`), and later calls
  ~0.55 s. `wavToMp3` on the 2.8 s clip takes 130–280 ms.
- **Output**: `wavToMp3` (default) gives 53,498 B, `MPEG 1 Layer 3`, 44100 Hz, 128 kbps, 1 ch, 3.34 s
  (0.25 s padding at each end), and `validateMp3` → ok. With `{ sampleRate: 22050 }` it gives
  `MPEG 2 Layer 3`, 64 kbps, 26,958 B, also valid. Both decode in Chromium [BROWSER].
- A bad voice name makes `SelectVoice` throw, and the Node wrapper returns `null` (≈ 0.6 s). Text is passed
  through an environment variable, so quotes, `$()`, `&` and non-ASCII are spoken literally with no
  injection [RUN].

**One-liner** (Windows PowerShell 5.1; `''` escapes the apostrophe) [RUN]:

```powershell
Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft Zira Desktop'); $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); $s.SetOutputToWaveFile("$PWD\emeraldbar.wav", $f); $s.Speak('You''re listening to EmeraldBar Radio.'); $s.Dispose()
```

To list voices:
`Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo } | ft Name, Culture, Gender, Age`

**Script form**. Run it from Git Bash or cmd as
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/lib/sapi-tts.ps1 -Text "You're listening to EmeraldBar Radio." -OutFile C:\abs\path\emeraldbar.wav`
(it prints `voice|bytes`) [RUN]:

```powershell
# Windows-only: speak text to a 16-bit PCM mono WAV with the built-in SAPI voices (System.Speech, .NET Framework).
# Run with Windows PowerShell 5.1 (powershell.exe). PowerShell 7 (pwsh) does not ship System.Speech.
param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$Voice = "",          # e.g. "Microsoft Zira Desktop"; empty = first female en-US voice, else default
  [int]$Rate = 0,               # -10..10
  [int]$SampleRate = 22050
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($Voice) { $synth.SelectVoice($Voice) }
  else {
    try { $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female, [System.Speech.Synthesis.VoiceAge]::Adult, 0, [System.Globalization.CultureInfo]::GetCultureInfo("en-US")) } catch { }
  }
  $synth.Rate = $Rate
  $synth.Volume = 100
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo($SampleRate, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile([System.IO.Path]::GetFullPath($OutFile), $format)
  $synth.Speak($Text)
  $synth.SetOutputToNull()   # closes and flushes the WAV file
  Write-Output ("{0}|{1}" -f $synth.Voice.Name, (Get-Item $OutFile).Length)
} finally {
  $synth.Dispose()
}
```

**Node wrapper**. It embeds the same script, passed as `-EncodedCommand`, so it needs no `.ps1` file and no
execution-policy change [RUN]:

```ts
// scripts/lib/sapi.ts - Windows SAPI text-to-speech to a 16-bit mono WAV via Windows PowerShell 5.1.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Text, voice and path travel in environment variables, so no quoting/injection issues.
const SAPI_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($env:SAPI_VOICE) { $s.SelectVoice($env:SAPI_VOICE) }
  $s.Rate = [int]$env:SAPI_RATE
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo([int]$env:SAPI_SAMPLE_RATE, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $s.SetOutputToWaveFile($env:SAPI_OUT, $fmt)
  $s.Speak($env:SAPI_TEXT)
  $s.SetOutputToNull()
  [Console]::Out.Write($s.Voice.Name)
} finally { $s.Dispose() }
`;

export interface SapiOptions {
  voice?: string; // "Microsoft Zira Desktop" | "Microsoft David Desktop" | ...
  rate?: number; // -10..10
  sampleRate?: number; // default 22050
}

/** Returns WAV bytes, or null when SAPI is unavailable (non-Windows, no voices, policy). */
export async function sapiToWav(text: string, opts: SapiOptions = {}): Promise<{ wav: Uint8Array; voice: string } | null> {
  if (process.platform !== "win32") return null;
  const dir = await mkdtemp(join(tmpdir(), "sapi-"));
  const out = join(dir, "speech.wav");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(SAPI_PS, "utf16le").toString("base64")],
      {
        env: { ...process.env, SAPI_TEXT: text, SAPI_OUT: out, SAPI_VOICE: opts.voice ?? "", SAPI_RATE: String(opts.rate ?? 0), SAPI_SAMPLE_RATE: String(opts.sampleRate ?? 22050) },
        timeout: 60_000,
        windowsHide: true,
      },
    );
    return { wav: new Uint8Array(await readFile(out)), voice: stdout.trim() };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

## 8. Loudness: normalise the PCM before encoding

**Method** (in `scripts/lib/audio.ts`):

1. `integratedLufs(pcm)` implements ITU-R BS.1770-4: a K-weighting pre-filter (high shelf plus high-pass,
   with libebur128's sample-rate-independent coefficients), 400 ms blocks with 75 % overlap, an absolute
   gate at -70 LUFS and a relative gate at -10 LU. Mono is counted as dual-mono (×2 power, +3.01 LU),
   because the browser sends a mono file to both speakers.
2. `normalizeLoudness(pcm, { targetLufs = -16, ceilingDbfs = -1 })` applies gain toward the target.
3. A 5 ms look-ahead, 80 ms-release brick-wall limiter then guarantees |sample| ≤ ceiling.
4. One correction pass (at most +3 dB) makes up for the loudness the limiter removed.

**Checked against the BS.1770 reference and real material** [RUN]:

| Signal | Result |
| --- | --- |
| 997 Hz sine, 0 dBFS, left channel only (reference -3.01 LUFS) | -3.01 |
| same, both channels / mono as dual-mono | 0.00 / 0.00 |
| 997 Hz, -20 dBFS stereo at 44.1 kHz | -20.00 |
| Demo loop: raw → normalised | -15.76 → **-16.00 LUFS**, peak -2.93 dBFS, 0 samples limited |
| SAPI Zira 22050 Hz: raw → normalised | -16.14 → **-16.00**, peak -3.24 |
| SAPI David 44100 Hz: raw → normalised | -15.92 → **-16.06**, peak -1.00 (25 samples limited) |
| Stress: David pushed to -10 LUFS | reaches only **-11.64**. A simple limiter cannot make speech that hot, so do not target above ~-14 LUFS |
| Chime placeholder | -16.0 |

`integratedLufs` takes ~80 ms for 60 s of stereo.

**Why not plain RMS.** At an identical gated RMS of -18 dBFS, the demo loop measured -16.8 LUFS and SAPI
speech -18.9 LUFS as a single channel (-15.9 as dual-mono) [RUN]. RMS ignores both the ear's frequency
weighting and the fact that mono is played on two speakers, so the error depends on the material. The
BS.1770 meter is ~40 lines and matches the reference exactly.

**Why -16 LUFS for everything.**

- Announcements and music play **sequentially**. They are never mixed together, so they should simply
  match.
- The player then applies `MUSIC_GAIN = 0.85` (-1.4 dB) to music and `announcement_volume` (default 1.0)
  to speech, which puts voice ~1.4 dB above music.
- On iPhone, element volume is locked, so both play at the file level, which is still matched.
- If the real catalogue is mastered hot (typically -8 to -14 LUFS), raise the single target to -14.
  Do not go higher (see the stress row).

**Not covered.** Admin-uploaded tracks and ElevenLabs MP3s cannot be normalised server-side: no MP3
decoder is installed, and lamejs only encodes. One option (UNVERIFIED) is to measure in the admin's
browser at upload (`decodeAudioData` + `integratedLufs`), store a per-item gain, and apply
`min(1, 10^((target − lufs)/20))` at playback. Element volume cannot go above 1, and the gain has no effect
on iPhone.

## 9. Demo generator sketch: `scripts/generate-demo-audio.ts` [RUN]

This ran end to end in the project-like layout: 6 loops (3 genres × 2), 2 SAPI announcements and the chime
path, all passing `validateMp3`, in 14.6–18.4 s total. All the files decode in Chromium [BROWSER]. It writes a
Latin-1 ID3v2.3 `TIT2`/`TPE1` tag, so the synthetic label also survives an upload through the admin UI.
music-metadata reads it back [RUN][BUILD]. Change `OUT` to `supabase/seed/audio`. The genre list and the
announcement texts are placeholders for the seed script to own.

```ts
// scripts/generate-demo-audio.ts (npm run demo:audio) - sketch. ESM mode via scripts/package.json.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeMp3, generateToneTrack, normalizeLoudness, wavToMp3, type PcmAudio } from "./lib/audio";
import { sapiToWav } from "./lib/sapi";
import { validateMp3 } from "../src/lib/audio/mp3";

const OUT = join(process.cwd(), "out", "seed", "audio"); // real script: supabase/seed/audio

// Latin-1 ID3v2.3 TIT2/TPE1 tag, so titles survive an upload through the admin UI too.
function id3v23(title: string, artist: string): Uint8Array {
  const frames = [["TIT2", title], ["TPE1", artist]].map(([id, text]) => {
    const f = new Uint8Array(11 + text.length);
    for (let i = 0; i < 4; i++) f[i] = id.charCodeAt(i);
    new DataView(f.buffer).setUint32(4, 1 + text.length); // v2.3 frame size: plain big-endian
    for (let i = 0; i < text.length; i++) f[11 + i] = text.charCodeAt(i) & 0xff; // f[10] = 0: ISO-8859-1
    return f;
  });
  const size = frames.reduce((n, f) => n + f.length, 0);
  const tag = new Uint8Array(10 + size);
  tag.set([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  let o = 10;
  for (const f of frames) { tag.set(f, o); o += f.length; }
  return tag;
}
const withTag = (tag: Uint8Array, mp3: Uint8Array) => { const out = new Uint8Array(tag.length + mp3.length); out.set(tag); out.set(mp3, tag.length); return out; };

// Two-tone chime used when SAPI is unavailable (clearly not speech).
function chime(sampleRate = 44100): PcmAudio {
  const x = new Float32Array(Math.round(2.2 * sampleRate));
  for (const [start, hz] of [[0.25, 659.25], [0.85, 523.25]] as const) {
    const s0 = Math.round(start * sampleRate);
    for (let i = s0; i < x.length; i++) {
      const t = (i - s0) / sampleRate;
      x[i] += 0.3 * Math.exp(-t / 0.45) * Math.min(1, t / 0.005) * (Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(4 * Math.PI * hz * t));
    }
  }
  return { sampleRate, channels: [x] };
}

const GENRES = [
  { slug: "lounge", bpm: 84, transpose: -3 },
  { slug: "jazz", bpm: 92, transpose: 2 },
  { slug: "pop", bpm: 104, transpose: 0 },
];
const ANNOUNCEMENTS = [
  { file: "emeraldbar-welcome", text: "You're listening to EmeraldBar Radio." },
  { file: "hotel-aurora-breakfast", text: "Welcome to Hotel Aurora. Breakfast is served until ten thirty." },
];

await mkdir(OUT, { recursive: true });
const t0 = performance.now();
for (const [gi, g] of GENRES.entries()) {
  for (let k = 1; k <= 2; k++) {
    const title = `Demo loop ${g.slug} ${k} (synthetic)`;
    const mp3 = withTag(id3v23(title, "Venue Radio demo"), generateToneTrack({ bpm: g.bpm, transpose: g.transpose, seed: gi * 10 + k }));
    const v = await validateMp3(mp3);
    if (!v.ok) throw new Error(`${title}: ${v.reason}`);
    await writeFile(join(OUT, `${g.slug}-${k}.mp3`), mp3);
    console.log(`${g.slug}-${k}.mp3  ${v.durationSeconds}s  "${v.title}"`);
  }
}
for (const a of ANNOUNCEMENTS) {
  const speech = await sapiToWav(a.text, { voice: "Microsoft Zira Desktop" });
  let mp3: Uint8Array;
  if (speech) mp3 = wavToMp3(speech.wav);
  else {
    const pcm = chime();
    normalizeLoudness(pcm);
    mp3 = encodeMp3(pcm, 128);
  }
  const tagged = withTag(id3v23(speech ? a.text : `[chime placeholder] ${a.text}`, speech ? `SAPI ${speech.voice}` : "placeholder"), mp3);
  const v = await validateMp3(tagged, { maxBytes: 10 * 1024 * 1024 });
  if (!v.ok) throw new Error(`${a.file}: ${v.reason}`);
  await writeFile(join(OUT, `${a.file}.mp3`), tagged);
  console.log(`${a.file}.mp3  ${v.durationSeconds}s  ${speech ? speech.voice : "chime"}`);
}
{ // chime path check
  const pcm = chime(); const r = normalizeLoudness(pcm); const mp3 = encodeMp3(pcm, 128);
  console.log("chime:", JSON.stringify(await validateMp3(mp3)), `LUFS ${r.afterLufs.toFixed(1)}`);
}
console.log(`total ${(performance.now() - t0).toFixed(0)} ms`);
```

## 10. Reproducing

In the scratchpad, `node_modules` was a directory junction to the project's `node_modules`. It has
since been removed; recreate it with `cmd /c mklink /J node_modules "C:\Users\PC\Desktop\Music Radio\node_modules"`.
Remove it with `cmd /c rmdir node_modules`, **never** a recursive delete, which could follow the junction.

Then run:

- `npx tsx scripts/generate-demo-audio.ts`
- `npx tsx scripts/spike/run-validate.ts` (the fixture table in §6)
- `npx tsx scripts/spike/probe-mm.ts` (the table in §5)
- `npx tsx scripts/spike/run-sapi.ts`
- `npx tsx scripts/spike/loudness-check.ts`
- `npx tsx scripts/spike/mm-vbr-bench.ts` (music-metadata's CBR duration misestimate)
- `npx vitest run --config vitest.config.mjs`
