import { describe, expect, it } from "vitest";
import { validateMp3 } from "../../src/lib/audio/mp3";
import { describeToneTrack, generateToneTrack, synthesizeChime, synthesizeToneTrack } from "../lib/audio-synth";
import { DEMO_BUSINESSES, DEMO_GENRES, demoAnnouncementsFor, listDemoTracks } from "../lib/demo-catalog";
import { renderDemoAnnouncement } from "../lib/demo-audio";
import { buildId3v23Tag, withId3Tag } from "../lib/id3";
import { inspectGeneratedMp3 } from "../lib/mp3-check";
import { encodeMp3, encodeWav16, parseWav, wavToMp3 } from "../lib/mp3-encode";
import { integratedLufs, normalizeLoudness, peakDbfs, type PcmAudio } from "../lib/pcm";
import { chooseVoice } from "../lib/sapi";

function sine(hz: number, seconds: number, amplitude: number, channels: 1 | 2, sampleRate = 44100): PcmAudio {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return { sampleRate, channels: channels === 1 ? [samples] : [samples, samples.slice()] };
}

const houseStyle = DEMO_GENRES.find((genre) => genre.slug === "house")!.style!;

describe("encodeMp3 input validation", () => {
  const ok = sine(440, 0.5, 0.3, 1);

  it("rejects typed arrays other than Float32Array (lamejs would silently emit nothing)", () => {
    const int16 = { sampleRate: 44100, channels: [new Int16Array(1000)] } as unknown as PcmAudio;
    expect(() => encodeMp3(int16)).toThrow(/Float32Array/);
  });

  it("rejects invalid sample rates, bitrates, channel counts, lengths and NaN", () => {
    expect(() => encodeMp3({ ...ok, sampleRate: 12345 })).toThrow(/sample rate/);
    expect(() => encodeMp3(ok, 100)).toThrow(/not a valid/);
    expect(() => encodeMp3({ sampleRate: 22050, channels: ok.channels }, 192)).toThrow(/MPEG-2/);
    expect(() => encodeMp3({ sampleRate: 44100, channels: [] })).toThrow(/1 or 2 channels/);
    expect(() => encodeMp3({ sampleRate: 44100, channels: [new Float32Array(10), new Float32Array(11)] })).toThrow(/lengths differ/);
    expect(() => encodeMp3({ sampleRate: 44100, channels: [new Float32Array(0)] })).toThrow(/no samples/);
    expect(() => encodeMp3({ sampleRate: 44100, channels: [Float32Array.from([0, Number.NaN])] })).toThrow(/finite/);
  });

  it("encodes clean CBR frames with the requested format", () => {
    const report = inspectGeneratedMp3(encodeMp3(sine(440, 2, 0.3, 1), 96));
    expect(report).toMatchObject({ sampleRate: 44100, channels: 1, bitrateKbps: 96, mpegVersion: "1", tagBytes: 0 });
    expect(report.durationSeconds).toBeGreaterThanOrEqual(2);
    expect(report.durationSeconds).toBeLessThan(2.1);
  });
});

describe("loudness", () => {
  it("matches the BS.1770 reference levels", () => {
    expect(integratedLufs(sine(997, 3, 0.1, 2))).toBeCloseTo(-20, 1);
    expect(integratedLufs(sine(997, 3, 1, 1))).toBeCloseTo(0, 1); // mono counts as dual-mono
  });

  it("normalises to -16 LUFS with a -1 dBFS ceiling, limiting when needed", () => {
    const quiet = sine(220, 3, 0.03, 1);
    const result = normalizeLoudness(quiet);
    expect(result.afterLufs).toBeCloseTo(-16, 1);
    expect(peakDbfs(quiet)).toBeLessThanOrEqual(-1 + 1e-6);

    const spiky = sine(220, 3, 0.05, 1);
    spiky.channels[0][44100] = 0.99; // a single peak that plain gain would push far above the ceiling
    normalizeLoudness(spiky);
    expect(peakDbfs(spiky)).toBeLessThanOrEqual(-1 + 1e-6);
  });
});

describe("synthesised tone tracks", () => {
  const options = { style: houseStyle, seed: 42, durationSeconds: 4, channels: 1 as const, kbps: 96 };

  it("is deterministic per seed and differs between seeds", () => {
    const a = Buffer.from(generateToneTrack(options));
    expect(Buffer.from(generateToneTrack(options)).equals(a)).toBe(true);
    expect(Buffer.from(generateToneTrack({ ...options, seed: 43 })).equals(a)).toBe(false);
  });

  it("is loudness-normalised and whole bars long", () => {
    const pcm = synthesizeToneTrack(options);
    const { durationSeconds, bars, bpm } = describeToneTrack(options);
    expect(integratedLufs(pcm)).toBeCloseTo(-16, 1);
    expect(peakDbfs(pcm)).toBeLessThanOrEqual(-1 + 1e-6);
    expect(pcm.channels[0].length / 44100).toBeCloseTo(durationSeconds, 3);
    expect(durationSeconds).toBeCloseTo(bars * (240 / bpm), 6);
  });

  it("renders every genre style without clipping", () => {
    for (const genre of DEMO_GENRES) {
      if (!genre.style) continue;
      const pcm = synthesizeToneTrack({ style: genre.style, seed: 7, durationSeconds: 3, channels: 1 });
      expect(peakDbfs(pcm), genre.slug).toBeLessThanOrEqual(-1 + 1e-6);
      expect(integratedLufs(pcm), genre.slug).toBeCloseTo(-16, 0);
    }
  });
});

describe("WAV → MP3", () => {
  it("round-trips a 22.05 kHz mono WAV (SAPI's format) to 44.1 kHz / 128 kbps with 0.25 s padding", () => {
    const wav = encodeWav16(sine(300, 1.5, 0.2, 1, 22050));
    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(22050);
    expect(parsed.channels[0].length).toBe(33075);
    const report = inspectGeneratedMp3(wavToMp3(wav));
    expect(report).toMatchObject({ sampleRate: 44100, channels: 1, bitrateKbps: 128 });
    expect(report.durationSeconds).toBeGreaterThanOrEqual(2);
    expect(report.durationSeconds).toBeLessThan(2.1);
  });

  it("rejects non-WAV input and unsupported sample formats", () => {
    expect(() => parseWav(new TextEncoder().encode("definitely not a wav file"))).toThrow(/RIFF/);
    const eightBit = encodeWav16(sine(300, 0.1, 0.2, 1));
    new DataView(eightBit.buffer).setUint16(34, 8, true);
    expect(() => parseWav(eightBit)).toThrow(/16-bit/);
    expect(() => wavToMp3("RIFF" as unknown as Uint8Array)).toThrow(/Uint8Array/);
  });
});

describe("ID3 tags", () => {
  it("are read back by the app's validator, including non-Latin-1 text", async () => {
    const mp3 = encodeMp3(sine(440, 1, 0.3, 1), 96);
    const tagged = withId3Tag(mp3, { title: "Test Loop 01 — House (synthetic)", artist: "Café Test Signal", album: "demo", comment: "synthetic" });
    const result = await validateMp3(tagged);
    expect(result).toMatchObject({ ok: true, title: "Test Loop 01 — House (synthetic)", artist: "Café Test Signal" });
    expect(inspectGeneratedMp3(tagged).tagBytes).toBe(buildId3v23Tag({ title: "Test Loop 01 — House (synthetic)", artist: "Café Test Signal", album: "demo", comment: "synthetic" }).length);
  });
});

describe("demo catalogue", () => {
  it("has the requested loops per genre, unique ids/titles, all 20–40 s", () => {
    const tracks = listDemoTracks();
    const perGenre = Object.fromEntries(DEMO_GENRES.map((genre) => [genre.slug, tracks.filter((t) => t.genre.slug === genre.slug).length]));
    expect(perGenre).toEqual({ house: 6, "deep-house": 3, lounge: 4, jazz: 3, pop: 0, rock: 0, rnb: 0, "balkan-hits": 2, chillout: 3 });
    expect(new Set(tracks.map((t) => t.id)).size).toBe(21);
    expect(new Set(tracks.map((t) => t.title)).size).toBe(21);
    for (const track of tracks) {
      expect(track.title).toMatch(/^Test Loop \d{2} — .+ \(synthetic\)$/);
      const { durationSeconds } = describeToneTrack({ style: track.genre.style, seed: track.seed, durationSeconds: track.targetSeconds });
      expect(durationSeconds, track.id).toBeGreaterThanOrEqual(20);
      expect(durationSeconds, track.id).toBeLessThanOrEqual(40);
    }
  });

  it("renders each venue's announcements from the app's templates", () => {
    const [emerald, aurora] = DEMO_BUSINESSES.map((business) => demoAnnouncementsFor(business));
    expect(emerald.map((a) => [a.templateKey, a.placement, a.text, a.spokenText])).toEqual([
      ["welcome_enjoy", "welcome", "Welcome to EmeraldBar. Enjoy the music.", "Welcome to Emerald Bar. Enjoy the music."],
      ["station_listening", "rotation", "You’re listening to EmeraldBar Radio.", "You’re listening to Emerald Bar Radio."],
      ["good_music", "rotation", "Good music. Good company. This is EmeraldBar Radio.", "Good music. Good company. This is Emerald Bar Radio."],
    ]);
    expect(aurora.map((a) => [a.placement, a.text, a.spokenText])).toEqual([
      ["welcome", "Welcome to Hotel Aurora. Enjoy the music.", null],
      ["rotation", "You’re listening to Hotel Aurora Radio.", null],
      ["rotation", "Good music. Good company. This is Hotel Aurora Radio.", null],
    ]);
  });
});

describe("chime placeholders", () => {
  it("are distinct per venue and announcement, verified, and clearly labelled", async () => {
    const hashes = new Set<string>();
    for (const business of DEMO_BUSINESSES) {
      for (const announcement of demoAnnouncementsFor(business)) {
        const { entry, bytes, fallbackReason } = await renderDemoAnnouncement(announcement, business, { kind: "chime", reason: "test" });
        expect(fallbackReason).toBeNull();
        expect(entry).toMatchObject({ generator: "chime-placeholder", voice: null, synthetic: true, channels: 1, sampleRateHz: 44100, bitrateKbps: 128 });
        expect(entry.title).toMatch(/^Chime placeholder — .+ \(not speech\)$/);
        expect(entry.bytes).toBe(bytes.length);
        hashes.add(entry.sha256);
      }
    }
    expect(hashes.size).toBe(6);
  });

  it("are loudness-normalised", () => {
    const pcm = synthesizeChime({ notesHz: [659.26, 783.99], spacingSeconds: 0.32, timbre: "bell" });
    expect(integratedLufs(pcm)).toBeCloseTo(-16, 0);
    expect(peakDbfs(pcm)).toBeLessThanOrEqual(-1 + 1e-6);
  });
});

describe("SAPI voice choice", () => {
  const installed = [
    { name: "Microsoft David Desktop", culture: "en-US", gender: "Male" },
    { name: "Microsoft Zira Desktop", culture: "en-US", gender: "Female" },
  ];
  it("prefers the named voice, then a partial match, then an English voice", () => {
    expect(chooseVoice("Microsoft Zira Desktop", installed)).toBe("Microsoft Zira Desktop");
    expect(chooseVoice("david", installed)).toBe("Microsoft David Desktop");
    expect(chooseVoice("Microsoft Hazel Desktop", installed)).toBe("Microsoft David Desktop");
    expect(chooseVoice("anything", [])).toBeNull();
  });
});
