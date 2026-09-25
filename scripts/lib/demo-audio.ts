// Rendering + verification of the individual demo audio files (used by scripts/generate-demo-audio.ts).
import { validateMp3 } from "../../src/lib/audio/mp3";
import { describeToneTrack, generateToneTrack, keyName, synthesizeChime } from "./audio-synth";
import {
  DEMO_ALBUM,
  DEMO_ARTIST,
  SYNTHETIC_NOTICE,
  type DemoAnnouncement,
  type DemoBusiness,
  type DemoTrack,
} from "./demo-catalog";
import { withId3Tag } from "./id3";
import type { AnnouncementManifestEntry, TrackManifestEntry } from "./manifest";
import { sha256Hex } from "./manifest";
import { inspectGeneratedMp3 } from "./mp3-check";
import { encodeMp3 } from "./mp3-encode";
import { SapiError, speakToMp3 } from "./sapi";

/** Mono 96 kbps keeps the repository small; the loops are test signals, not hi-fi music. */
export const TRACK_FORMAT = { sampleRate: 44100, channels: 1, kbps: 96 } as const;
/** Same shape as ElevenLabs mp3_44100_128 (mono). */
export const ANNOUNCEMENT_FORMAT = { sampleRate: 44100, channels: 1, kbps: 128 } as const;
/** Bucket limits (docs/ARCHITECTURE.md §5.6). */
const MUSIC_MAX_BYTES = 50 * 1024 * 1024;
const ANNOUNCEMENT_MAX_BYTES = 10 * 1024 * 1024;
/** lamejs adds up to ~2 frames of encoder delay/padding; anything beyond means the encode went wrong. */
const DURATION_TOLERANCE_SECONDS = 0.1;

export interface Mp3Expectations {
  title: string;
  artist: string;
  sampleRate: number;
  channels: 1 | 2;
  kbps: number;
  maxBytes: number;
  /** Synthesised length; the decoded length must match within 0.1 s. */
  durationSeconds: number;
}

export interface VerifiedMp3 {
  /** As validateMp3() reports it (the value the upload flow would store). */
  durationSeconds: number;
  bitrateKbps: number;
  sampleRateHz: number;
  channels: 1 | 2;
}

/**
 * Two independent checks: our strict frame walk (format + no junk + exact length) and the project's
 * upload validator (validateMp3, incl. its music-metadata codec check and tag read-back).
 */
export async function verifyDemoMp3(bytes: Uint8Array, expected: Mp3Expectations): Promise<VerifiedMp3> {
  const report = inspectGeneratedMp3(bytes);
  const problems: string[] = [];
  if (report.sampleRate !== expected.sampleRate) problems.push(`sample rate ${report.sampleRate} Hz ≠ ${expected.sampleRate} Hz`);
  if (report.channels !== expected.channels) problems.push(`${report.channels} channel(s) ≠ ${expected.channels}`);
  if (report.bitrateKbps !== expected.kbps) problems.push(`average bitrate ${report.bitrateKbps} kbps ≠ ${expected.kbps} kbps`);
  if (Math.abs(report.durationSeconds - expected.durationSeconds) > DURATION_TOLERANCE_SECONDS) {
    problems.push(`decoded length ${report.durationSeconds.toFixed(3)} s ≠ synthesised ${expected.durationSeconds.toFixed(3)} s`);
  }

  const validation = await validateMp3(bytes, { maxBytes: expected.maxBytes });
  if (!validation.ok) {
    problems.push(`validateMp3 rejected it (${validation.code}): ${validation.reason}`);
  } else {
    if (validation.title !== expected.title) problems.push(`title tag reads back as ${JSON.stringify(validation.title)}`);
    if (validation.artist !== expected.artist) problems.push(`artist tag reads back as ${JSON.stringify(validation.artist)}`);
    if (Math.abs(validation.durationSeconds - report.durationSeconds) > 0.011) {
      problems.push(`validateMp3 duration ${validation.durationSeconds} s disagrees with the frame walk (${report.durationSeconds.toFixed(3)} s)`);
    }
  }
  if (problems.length > 0 || !validation.ok) throw new Error(`"${expected.title}" failed verification: ${problems.join("; ")}`);
  return {
    durationSeconds: validation.durationSeconds,
    bitrateKbps: validation.bitrateKbps ?? report.bitrateKbps,
    sampleRateHz: validation.sampleRateHz ?? report.sampleRate,
    channels: validation.channels ?? report.channels,
  };
}

export interface RenderedTrack {
  bytes: Uint8Array;
  entry: TrackManifestEntry;
}

/** Synthesises, tags and verifies one demo loop. */
export async function renderDemoTrack(track: DemoTrack): Promise<RenderedTrack> {
  const options = {
    style: track.genre.style,
    seed: track.seed,
    durationSeconds: track.targetSeconds,
    sampleRate: TRACK_FORMAT.sampleRate,
    channels: TRACK_FORMAT.channels,
    kbps: TRACK_FORMAT.kbps,
  };
  const variation = describeToneTrack(options);
  const bytes = withId3Tag(generateToneTrack(options), {
    title: track.title,
    artist: DEMO_ARTIST,
    album: DEMO_ALBUM,
    comment: SYNTHETIC_NOTICE,
  });
  const verified = await verifyDemoMp3(bytes, {
    title: track.title,
    artist: DEMO_ARTIST,
    sampleRate: TRACK_FORMAT.sampleRate,
    channels: TRACK_FORMAT.channels,
    kbps: TRACK_FORMAT.kbps,
    maxBytes: MUSIC_MAX_BYTES,
    durationSeconds: variation.durationSeconds,
  });
  return {
    bytes,
    entry: {
      kind: "track",
      id: track.id,
      file: `music/${track.id}.mp3`,
      title: track.title,
      artist: DEMO_ARTIST,
      genre: track.genre.slug,
      durationSeconds: verified.durationSeconds,
      bytes: bytes.length,
      sha256: sha256Hex(bytes),
      bitrateKbps: verified.bitrateKbps,
      sampleRateHz: verified.sampleRateHz,
      channels: verified.channels,
      generator: "synthetic-tones",
      style: { mood: track.genre.style.mood, bpm: variation.bpm, key: keyName(variation.key) },
      synthetic: true,
    },
  };
}

/** How announcements are voiced in this run. */
export type SpeechSource = { kind: "sapi"; voice: string } | { kind: "chime"; reason: string };

export interface RenderedAnnouncement {
  bytes: Uint8Array;
  entry: AnnouncementManifestEntry;
  /** Set when SAPI was requested but failed for this file and a chime placeholder was used instead. */
  fallbackReason: string | null;
}

/** SAPI reads straight ASCII apostrophes more reliably than the typographic ones the templates use. */
function speakableText(announcement: DemoAnnouncement): string {
  return (announcement.spokenText ?? announcement.text).replace(/[‘’]/g, "'");
}

/** Speaks (or, without SAPI, chimes), tags and verifies one demo announcement. */
export async function renderDemoAnnouncement(
  announcement: DemoAnnouncement,
  business: DemoBusiness,
  speech: SpeechSource,
): Promise<RenderedAnnouncement> {
  let mp3: Uint8Array | null = null;
  let voice: string | null = null;
  let fallbackReason: string | null = null;
  if (speech.kind === "sapi") {
    try {
      const spoken = await speakToMp3(speakableText(announcement), { voice: speech.voice });
      mp3 = spoken.mp3;
      voice = spoken.voice;
    } catch (error) {
      if (!(error instanceof SapiError)) throw error;
      fallbackReason = error.message;
    }
  }
  if (!mp3) {
    mp3 = encodeMp3(synthesizeChime({ ...announcement.chime, sampleRate: ANNOUNCEMENT_FORMAT.sampleRate }), ANNOUNCEMENT_FORMAT.kbps);
  }
  const generator = voice ? "windows-sapi" : "chime-placeholder";
  const title = voice
    ? `Demo announcement — ${business.name}: ${announcement.label} (computer voice)`
    : `Chime placeholder — ${business.name}: ${announcement.label} (not speech)`;
  const comment = voice
    ? `${SYNTHETIC_NOTICE} Spoken by the Windows SAPI voice "${voice}": "${speakableText(announcement)}"`
    : `${SYNTHETIC_NOTICE} Placeholder chime standing in for: "${announcement.text}"`;
  const bytes = withId3Tag(mp3, { title, artist: DEMO_ARTIST, album: DEMO_ALBUM, comment });
  const frames = inspectGeneratedMp3(bytes);
  const verified = await verifyDemoMp3(bytes, {
    title,
    artist: DEMO_ARTIST,
    sampleRate: ANNOUNCEMENT_FORMAT.sampleRate,
    channels: ANNOUNCEMENT_FORMAT.channels,
    kbps: ANNOUNCEMENT_FORMAT.kbps,
    maxBytes: ANNOUNCEMENT_MAX_BYTES,
    // Speech length is only known after synthesis; the frame walk inside verifyDemoMp3 re-checks structure.
    durationSeconds: frames.durationSeconds,
  });
  return {
    bytes,
    fallbackReason,
    entry: {
      kind: "announcement",
      id: announcement.id,
      file: `announcements/${announcement.id}.mp3`,
      title,
      artist: DEMO_ARTIST,
      business: business.key,
      templateKey: announcement.templateKey,
      placement: announcement.placement,
      text: announcement.text,
      spokenText: announcement.spokenText,
      durationSeconds: verified.durationSeconds,
      bytes: bytes.length,
      sha256: sha256Hex(bytes),
      bitrateKbps: verified.bitrateKbps,
      sampleRateHz: verified.sampleRateHz,
      channels: verified.channels,
      generator,
      voice,
      synthetic: true,
    },
  };
}
