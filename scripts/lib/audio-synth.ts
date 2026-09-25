// Synthesised demo audio: pleasant chord loops per genre style and chime placeholders.
// Everything here is deterministic: the same options produce byte-identical MP3s.
// Built on the verified loop synth in docs/research/audio-tooling.md §4, extended with per-genre
// styles (tempo, key, groove, timbre). "Pleasant" is by construction only: consonant voicings, soft
// envelopes, no clipping (loudness-normalised to -16 LUFS, -1 dBFS peak).
import { encodeMp3 } from "./mp3-encode";
import { downmixToMono, normalizeLoudness, type NormalizeOptions, type PcmAudio } from "./pcm";

/** One chord per bar: bass note + pad voicing, as MIDI numbers in C (the style's key transposes them). */
export interface Chord {
  bass: number;
  notes: number[];
}

export type KickPattern = "four-on-the-floor" | "half-time" | "none";
export type HatPattern = "offbeat" | "swing-ride" | "shaker" | "none";
export type BassPattern = "pulse" | "offbeat" | "walking" | "sustained" | "oom-pah";
export type ArpeggioPattern = "eighths" | "sixteenths" | "swing-eighths" | "none";

export interface Timbre {
  /** Relative harmonic amplitudes of the pad voice (index 0 = fundamental). */
  padHarmonics: number[];
  padLevel: number;
  padAttackSeconds: number;
  /** Harmonics of the plucked voice used for arpeggios and chord stabs. */
  pluckHarmonics: number[];
  pluckLevel: number;
  pluckDecaySeconds: number;
}

export interface MusicStyle {
  /** Descriptive label, recorded in the manifest ("bright", "deep", ...). */
  mood: string;
  bpm: number;
  /** Semitones relative to C. */
  key: number;
  progression: Chord[];
  kick: KickPattern;
  hats: HatPattern;
  bass: BassPattern;
  arpeggio: ArpeggioPattern;
  /** Short chord hits on beats 2 and 4. */
  chordStabs: boolean;
  timbre: Timbre;
}

export interface ToneTrackOptions {
  style: MusicStyle;
  /** Varies key offset, tempo, chord rotation, arpeggio shape and dynamics. Same seed ⇒ same bytes. */
  seed: number;
  /** Target length; rounded to whole bars. */
  durationSeconds: number;
  sampleRate?: number; // default 44100
  channels?: 1 | 2; // default 2
  kbps?: number; // default 128
  fadeOutSeconds?: number; // default 1.5
  normalize?: NormalizeOptions | false; // default -16 LUFS / -1 dBFS
}

/** What the seed actually chose, for logging and the manifest. */
export interface ToneTrackVariation {
  bpm: number;
  /** Final key in semitones relative to C (style key + seed offset). */
  key: number;
  bars: number;
  durationSeconds: number;
}

const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export function keyName(semitonesFromC: number): string {
  return KEY_NAMES[((semitonesFromC % 12) + 12) % 12];
}

const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Small, fast, deterministic PRNG (mulberry32). */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ARPEGGIO_SHAPES = [
  [0, 1, 2, 1, 0, 1, 2, 1],
  [0, 2, 1, 2, 0, 2, 1, 2],
  [2, 1, 0, 1, 2, 1, 0, 1],
  [0, 1, 2, 3, 2, 1, 0, 2],
];
/** Seed key offsets stay close to the style's key so each genre keeps its character. */
const KEY_OFFSETS = [0, 2, -2, 5, -3, 3];
/** Every note and kick fades out over its last 10 ms. */
const END_FADE_SECONDS = 0.01;

/** Stereo mix buffer with helpers for adding notes and percussion. */
class Mixer {
  readonly left: Float32Array;
  readonly right: Float32Array;

  constructor(
    readonly sampleRate: number,
    readonly length: number,
  ) {
    this.left = new Float32Array(length);
    this.right = new Float32Array(length);
  }

  /**
   * Adds a harmonic tone; `envelope(t)` gives the amplitude t seconds after `start`; pan in [-1, 1].
   * The last 10 ms are faded out so a note cut off mid-decay never clicks.
   */
  tone(start: number, duration: number, hz: number, amp: number, pan: number, envelope: (t: number) => number, harmonics: number[], detuneCents = 0): void {
    const { sampleRate, length, left, right } = this;
    const s0 = Math.round(start * sampleRate);
    const s1 = Math.min(length, Math.round((start + duration) * sampleRate));
    const gainLeft = amp * Math.cos(((pan + 1) * Math.PI) / 4);
    const gainRight = amp * Math.sin(((pan + 1) * Math.PI) / 4);
    const f = hz * Math.pow(2, detuneCents / 1200);
    const nyquist = sampleRate / 2;
    for (let i = Math.max(0, s0); i < s1; i++) {
      const t = (i - s0) / sampleRate;
      let v = 0;
      for (let h = 0; h < harmonics.length; h++) {
        if (f * (h + 1) < nyquist) v += harmonics[h] * Math.sin(2 * Math.PI * f * (h + 1) * t);
      }
      v *= envelope(t) * Math.min(1, (duration - t) / END_FADE_SECONDS);
      left[i] += v * gainLeft;
      right[i] += v * gainRight;
    }
  }

  /** Kick drum: pitch sweep 120 → 45 Hz with an integrated phase, so there is no click. */
  kick(start: number, amp: number): void {
    const { sampleRate, length, left, right } = this;
    const s0 = Math.round(start * sampleRate);
    const kickSeconds = 0.35;
    const len = Math.round(kickSeconds * sampleRate);
    let phase = 0;
    for (let i = 0; i < len && s0 + i < length; i++) {
      const t = i / sampleRate;
      phase += (2 * Math.PI * (45 + 75 * Math.exp(-t / 0.035))) / sampleRate;
      const fade = Math.min(1, t / 0.002, (kickSeconds - t) / END_FADE_SECONDS);
      const v = amp * Math.sin(phase) * Math.exp(-t / 0.12) * fade;
      left[s0 + i] += v;
      right[s0 + i] += v;
    }
  }

  /** High-passed noise burst (hats, shaker, ride). */
  noise(start: number, amp: number, decaySeconds: number, pan: number, random: () => number): void {
    const { sampleRate, length, left, right } = this;
    const s0 = Math.round(start * sampleRate);
    const len = Math.round(decaySeconds * 5 * sampleRate);
    const gainLeft = Math.cos(((pan + 1) * Math.PI) / 4);
    const gainRight = Math.sin(((pan + 1) * Math.PI) / 4);
    let previous = 0;
    for (let i = 0; i < len && s0 + i < length; i++) {
      const x = random() * 2 - 1;
      const v = amp * (x - previous) * Math.exp(-i / sampleRate / decaySeconds);
      previous = x;
      left[s0 + i] += v * gainLeft;
      right[s0 + i] += v * gainRight;
    }
  }
}

/** Chord tones of `chord` folded into the octave above its bass note, ascending. */
function bassChordTones(chord: Chord): number[] {
  const tones = chord.notes.map((note) => {
    let n = note;
    while (n >= chord.bass + 12) n -= 12;
    while (n < chord.bass) n += 12;
    return n;
  });
  return [...new Set([chord.bass, ...tones])].sort((a, b) => a - b);
}

function barLengthSeconds(bpm: number): number {
  return (60 / bpm) * 4;
}

/** Resolves the seed-dependent choices (tempo, key, whole-bar length) without synthesising anything. */
export function describeToneTrack(options: ToneTrackOptions): ToneTrackVariation {
  const random = createRandom(options.seed);
  const bpm = options.style.bpm + Math.round((random() - 0.5) * 4);
  const key = options.style.key + KEY_OFFSETS[Math.floor(random() * KEY_OFFSETS.length)];
  const bar = barLengthSeconds(bpm);
  const bars = Math.max(1, Math.round(options.durationSeconds / bar));
  return { bpm, key, bars, durationSeconds: bars * bar };
}

/** Synthesises the PCM of a demo loop in the given style. */
export function synthesizeToneTrack(options: ToneTrackOptions): PcmAudio {
  const { style, seed, sampleRate = 44100, channels = 2, fadeOutSeconds = 1.5, normalize = {} } = options;
  if (!Number.isInteger(seed)) throw new RangeError("synthesizeToneTrack: seed must be an integer");
  if (!(options.durationSeconds > 0)) throw new RangeError("synthesizeToneTrack: durationSeconds must be > 0");
  if (style.progression.length === 0) throw new RangeError("synthesizeToneTrack: the progression is empty");

  const { bpm, key, bars, durationSeconds } = describeToneTrack(options);
  // Independent streams derived from the seed: arrangement/dynamics, and noise for the percussion.
  const random = createRandom(seed ^ 0x2545f491);
  const rotation = Math.floor(random() * style.progression.length);
  const shape = ARPEGGIO_SHAPES[Math.floor(random() * ARPEGGIO_SHAPES.length)];
  const noiseRandom = createRandom(seed ^ 0x5eed);
  const velocity = () => 0.88 + random() * 0.24;

  const mix = new Mixer(sampleRate, Math.round(durationSeconds * sampleRate));
  const beat = 60 / bpm;
  const bar = beat * 4;
  const { timbre } = style;
  const chordAt = (b: number): Chord => style.progression[(b + rotation) % style.progression.length];
  const pluckEnvelope = (decay: number) => (t: number) => Math.min(1, t / 0.004) * Math.exp(-t / decay);

  for (let b = 0; b < bars; b++) {
    const chord = chordAt(b);
    const next = chordAt(b + 1);
    const t0 = b * bar;

    // Pad: slow attack, release overlapping into the next bar, two detuned voices for width.
    const padEnvelope = (t: number) =>
      Math.min(1, t / timbre.padAttackSeconds) * (t > bar ? Math.max(0, 1 - (t - bar) / 0.6) : 1);
    for (const note of chord.notes) {
      const hz = midiHz(note + key);
      mix.tone(t0, bar + 0.6, hz, timbre.padLevel, -0.35, padEnvelope, timbre.padHarmonics, -5);
      mix.tone(t0, bar + 0.6, hz, timbre.padLevel, 0.35, padEnvelope, timbre.padHarmonics, 5);
    }

    // Bass.
    const bassHarmonics = [1, 0.35, 0.1];
    const bassNote = (start: number, duration: number, midi: number, amp: number, decay: number) =>
      mix.tone(start, duration, midiHz(midi + key), amp * velocity(), 0, (t) => Math.min(1, t / 0.01) * Math.exp(-t / decay), bassHarmonics);
    const tones = bassChordTones(chord);
    switch (style.bass) {
      case "pulse":
        for (const k of [0, 2]) bassNote(t0 + k * beat, beat * 1.9, chord.bass, 0.22, 0.5);
        break;
      case "offbeat":
        for (let k = 0; k < 4; k++) bassNote(t0 + (k + 0.5) * beat, beat * 0.45, chord.bass + (k === 3 ? 12 : 0), 0.2, 0.14);
        break;
      case "walking": {
        const approach = next.bass + (random() < 0.5 ? -1 : 1);
        const line = [chord.bass, tones[1] ?? chord.bass + 7, tones[2] ?? chord.bass + 7, approach];
        line.forEach((midi, k) => bassNote(t0 + k * beat, beat * 0.95, midi, 0.2, 0.35));
        break;
      }
      case "sustained":
        bassNote(t0, bar, chord.bass, 0.16, 1.6);
        break;
      case "oom-pah":
        // Root on beat 1, the fifth below on beat 3 (the chord stabs supply the "pah").
        bassNote(t0, beat * 0.9, chord.bass, 0.22, 0.25);
        bassNote(t0 + 2 * beat, beat * 0.9, chord.bass - 5, 0.2, 0.25);
        break;
    }

    // Arpeggio: plucked chord tones one octave above the pad.
    if (style.arpeggio !== "none") {
      const perBar = style.arpeggio === "sixteenths" ? 16 : 8;
      const level = style.arpeggio === "sixteenths" ? timbre.pluckLevel * 0.7 : timbre.pluckLevel;
      for (let e = 0; e < perBar; e++) {
        const pairStart = Math.floor(e / 2) * (bar / (perBar / 2));
        const offset = e % 2 === 0 ? 0 : (bar / (perBar / 2)) * (style.arpeggio === "swing-eighths" ? 2 / 3 : 1 / 2);
        const midi = chord.notes[shape[e % shape.length] % chord.notes.length] + 12 + key;
        mix.tone(t0 + pairStart + offset, timbre.pluckDecaySeconds * 4, midiHz(midi), level * velocity(), e % 2 ? 0.4 : -0.4, pluckEnvelope(timbre.pluckDecaySeconds), timbre.pluckHarmonics);
      }
    }

    // Chord stabs on beats 2 and 4.
    if (style.chordStabs) {
      for (const k of [1, 3]) {
        for (const note of chord.notes) {
          mix.tone(t0 + k * beat, 0.5, midiHz(note + 12 + key), timbre.pluckLevel * 0.7 * velocity(), 0.15, pluckEnvelope(0.12), timbre.pluckHarmonics);
        }
      }
    }

    // Drums.
    for (let k = 0; k < 4; k++) {
      const tb = t0 + k * beat;
      if (style.kick === "four-on-the-floor") mix.kick(tb, 0.45);
      else if (style.kick === "half-time" && k % 2 === 0) mix.kick(tb, 0.32);

      switch (style.hats) {
        case "offbeat":
          mix.noise(tb + beat / 2, 0.05 * velocity(), 0.012, 0.2, noiseRandom);
          break;
        case "shaker":
          for (let s = 0; s < 4; s++) mix.noise(tb + (s * beat) / 4, (s === 2 ? 0.035 : 0.018) * velocity(), 0.008, 0.3, noiseRandom);
          break;
        case "swing-ride":
          mix.noise(tb, 0.03 * velocity(), 0.05, 0.35, noiseRandom);
          if (k % 2 === 1) mix.noise(tb + (beat * 2) / 3, 0.022 * velocity(), 0.04, 0.35, noiseRandom);
          break;
        case "none":
          break;
      }
    }
  }

  // Fades: 10 ms in (no click), fadeOutSeconds out.
  const fadeIn = Math.round(0.01 * sampleRate);
  const fadeOut = Math.round(Math.min(fadeOutSeconds, durationSeconds / 2) * sampleRate);
  for (let i = 0; i < mix.length; i++) {
    let g = 1;
    if (i < fadeIn) g = i / fadeIn;
    if (i > mix.length - fadeOut) g = Math.min(g, (mix.length - i) / fadeOut);
    mix.left[i] *= g;
    mix.right[i] *= g;
  }

  const stereo: PcmAudio = { sampleRate, channels: [mix.left, mix.right] };
  const pcm = channels === 1 ? downmixToMono(stereo) : stereo;
  if (normalize !== false) normalizeLoudness(pcm, normalize);
  return pcm;
}

/** A synthesised demo loop as MP3 bytes (CBR MPEG Layer III, no tags). */
export function generateToneTrack(options: ToneTrackOptions): Uint8Array {
  return encodeMp3(synthesizeToneTrack(options), options.kbps ?? 128);
}

// ---------------------------------------------------------------------------
// Chime placeholder (used instead of speech when Windows SAPI is unavailable)
// ---------------------------------------------------------------------------

export interface ChimeOptions {
  /** Note frequencies in Hz, played in order. */
  notesHz: number[];
  /** Seconds between note onsets. */
  spacingSeconds: number;
  /** "bell": bright, long ring; "marimba": warm, short. */
  timbre: "bell" | "marimba";
  sampleRate?: number; // default 44100
}

/** A short mono chime melody, loudness-normalised. Clearly not speech. */
export function synthesizeChime(options: ChimeOptions): PcmAudio {
  const { notesHz, spacingSeconds, timbre, sampleRate = 44100 } = options;
  if (notesHz.length === 0) throw new RangeError("synthesizeChime: needs at least one note");
  const lead = 0.25;
  const decay = timbre === "bell" ? 0.55 : 0.25;
  const harmonics = timbre === "bell" ? [1, 0.45, 0, 0.25, 0, 0.12] : [1, 0, 0, 0.35];
  const total = lead + (notesHz.length - 1) * spacingSeconds + decay * 5 + 0.25;
  const mix = new Mixer(sampleRate, Math.round(total * sampleRate));
  notesHz.forEach((hz, index) => {
    mix.tone(lead + index * spacingSeconds, decay * 5, hz, 0.3, 0, (t) => Math.min(1, t / 0.005) * Math.exp(-t / decay), harmonics);
  });
  const pcm = downmixToMono({ sampleRate, channels: [mix.left, mix.right] });
  normalizeLoudness(pcm);
  return pcm;
}
