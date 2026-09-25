// Planar float PCM plus loudness measurement/normalisation (ITU-R BS.1770-4), verified in
// docs/research/audio-tooling.md §8: every generated asset is normalised to -16 LUFS integrated with
// a -1 dBFS sample-peak ceiling.

/** Planar float PCM. Samples are in [-1, 1]; `channels.length` is 1 (mono) or 2 (stereo). */
export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export const TARGET_LUFS = -16;
export const PEAK_CEILING_DBFS = -1;

const toDb = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fromDb = (db: number): number => Math.pow(10, db / 20);

export function durationSeconds(pcm: PcmAudio): number {
  return (pcm.channels[0]?.length ?? 0) / pcm.sampleRate;
}

/** Averages the channels into one (no-op for mono). */
export function downmixToMono(pcm: PcmAudio): PcmAudio {
  if (pcm.channels.length === 1) return pcm;
  const [left, right] = pcm.channels;
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (left[i] + right[i]) / 2;
  return { sampleRate: pcm.sampleRate, channels: [mono] };
}

export function peakDbfs(pcm: PcmAudio): number {
  let peak = 0;
  for (const channel of pcm.channels) {
    for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
  }
  return toDb(peak);
}

interface Biquad {
  b: [number, number, number];
  a: [number, number];
}

function runBiquad(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b[0] * x[i] + f.b[1] * x1 + f.b[2] * x2 - f.a[0] * y1 - f.a[1] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Integrated loudness per ITU-R BS.1770-4: K-weighting, 400 ms blocks with 75 % overlap, -70 LUFS
 * absolute gate and -10 LU relative gate. Mono is measured as dual-mono (+3.01 LU) because browsers
 * play a mono file on both speakers. Returns -Infinity for silence or audio shorter than one block.
 */
export function integratedLufs(pcm: PcmAudio): number {
  const fs = pcm.sampleRate;
  // Stage 1: high shelf (+4 dB above ~1.7 kHz). Stage 2: high-pass (~38 Hz). Coefficients as in libebur128.
  let k = Math.tan((Math.PI * 1681.974450955533) / fs);
  const q1 = 0.7071752369554196;
  const vh = Math.pow(10, 3.999843853973347 / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  let a0 = 1 + k / q1 + k * k;
  const shelf: Biquad = {
    b: [(vh + (vb * k) / q1 + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q1 + k * k) / a0],
    a: [(2 * (k * k - 1)) / a0, (1 - k / q1 + k * k) / a0],
  };
  k = Math.tan((Math.PI * 38.13547087602444) / fs);
  const q2 = 0.5003270373238773;
  a0 = 1 + k / q2 + k * k;
  const highpass: Biquad = { b: [1, -2, 1], a: [(2 * (k * k - 1)) / a0, (1 - k / q2 + k * k) / a0] };

  const weighted = pcm.channels.map((channel) => runBiquad(runBiquad(channel, shelf), highpass));
  const channelWeight = pcm.channels.length === 1 ? 2 : 1; // dual-mono
  const block = Math.round(0.4 * fs);
  const hop = Math.round(0.1 * fs);
  const blocks: number[] = [];
  for (let s = 0; s + block <= weighted[0].length; s += hop) {
    let z = 0;
    for (const channel of weighted) {
      let meanSquare = 0;
      for (let i = s; i < s + block; i++) meanSquare += channel[i] * channel[i];
      z += (channelWeight * meanSquare) / block;
    }
    blocks.push(z);
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const aboveAbsolute = blocks.filter((z) => lufs(z) > -70);
  if (aboveAbsolute.length === 0) return -Infinity;
  const relativeGate = lufs(mean(aboveAbsolute)) - 10;
  return lufs(mean(aboveAbsolute.filter((z) => lufs(z) > relativeGate)));
}

/**
 * In place: multiplies by `gainDb`, then a 5 ms look-ahead brick-wall limiter (80 ms release)
 * guarantees |sample| <= ceiling. Returns how many samples needed limiting.
 */
export function applyGainWithLimiter(pcm: PcmAudio, gainDb: number, ceilingDbfs = PEAK_CEILING_DBFS): number {
  const gain = fromDb(gainDb);
  const ceiling = fromDb(ceilingDbfs);
  const { channels, sampleRate } = pcm;
  const n = channels[0].length;
  const g = new Float32Array(n); // extra gain each sample needs so that |x * gain * g| <= ceiling
  let limitedSamples = 0;
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (const channel of channels) a = Math.max(a, Math.abs(channel[i] * gain));
    g[i] = a > ceiling ? ceiling / a : 1;
    if (a > ceiling) limitedSamples++;
  }
  // Attack (backward pass): ramp down over <= 5 ms so the gain is already low when the peak arrives.
  const attackStep = 1 / Math.max(1, Math.round(sampleRate * 0.005));
  for (let i = n - 2; i >= 0; i--) g[i] = Math.min(g[i], g[i + 1] + attackStep);
  // Release (forward pass): recover toward 1 with an ~80 ms time constant, never above the attack curve.
  const release = 1 - Math.exp(-1 / (sampleRate * 0.08));
  for (let i = 1; i < n; i++) g[i] = Math.min(g[i], g[i - 1] + (1 - g[i - 1]) * release);
  for (const channel of channels) {
    for (let i = 0; i < n; i++) channel[i] *= gain * g[i];
  }
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

export interface NormalizeResult {
  beforeLufs: number;
  afterLufs: number;
  gainDb: number;
  limitedSamples: number;
  peakDbfs: number;
}

/** In place: gain to the LUFS target, limiter for the peak ceiling, one correction pass for what the limiter took off. */
export function normalizeLoudness(pcm: PcmAudio, options: NormalizeOptions = {}): NormalizeResult {
  const { targetLufs = TARGET_LUFS, ceilingDbfs = PEAK_CEILING_DBFS, maxGainDb = 20 } = options;
  const beforeLufs = integratedLufs(pcm);
  if (!Number.isFinite(beforeLufs)) {
    return { beforeLufs, afterLufs: beforeLufs, gainDb: 0, limitedSamples: 0, peakDbfs: peakDbfs(pcm) };
  }
  const gainDb = Math.min(maxGainDb, targetLufs - beforeLufs);
  let limitedSamples = applyGainWithLimiter(pcm, gainDb, ceilingDbfs);
  const shortfall = targetLufs - integratedLufs(pcm);
  if (shortfall > 0.3 && limitedSamples > 0) {
    limitedSamples += applyGainWithLimiter(pcm, Math.min(shortfall, 3), ceilingDbfs);
  }
  return { beforeLufs, afterLufs: integratedLufs(pcm), gainDb, limitedSamples, peakDbfs: peakDbfs(pcm) };
}
