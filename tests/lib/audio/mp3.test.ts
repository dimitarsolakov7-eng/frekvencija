import { beforeAll, describe, expect, it } from "vitest";
import { fileNameToTitle, validateMp3, type Mp3Validation } from "@/lib/audio/mp3";
import {
  apeV2Tag,
  asciiBytes,
  concatBytes,
  encodeToneMp3,
  id3v1Tag,
  id3v23Tag,
  id3v2Header,
  mpegFrameOffsets,
  randomBytes,
  riffWrappedMp3,
  samplesPerFrame,
  vbriInfoFrame,
  wavFile,
  xingInfoFrame,
} from "../../fixtures/audio";

/** Duration a decoder plays for a tag-free stream: frames × samples per frame / sample rate. */
function frameDuration(mp3: Uint8Array, sampleRate: number): number {
  return (mpegFrameOffsets(mp3).length * samplesPerFrame(mp3)) / sampleRate;
}

/** Results are rounded to 0.01 s, so allow that rounding on top of float noise. */
function expectDuration(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.0051);
}

function expectOk(result: Mp3Validation) {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.reason}`);
  return result;
}

function expectRejected(result: Mp3Validation, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
    expect(result.reason.length).toBeGreaterThan(10);
  }
}

let stereo: Uint8Array; // 3 s, 44.1 kHz, 128 kbps
let mono: Uint8Array; // 1.5 s, 22.05 kHz, 64 kbps (MPEG-2)

beforeAll(() => {
  stereo = encodeToneMp3({ seconds: 3 });
  mono = encodeToneMp3({ seconds: 1.5, sampleRate: 22050, channels: 1, kbps: 64 });
});

describe("validateMp3: valid files", () => {
  it("accepts a CBR MPEG-1 stereo file with the frame-derived duration", async () => {
    const result = expectOk(await validateMp3(stereo));
    expect(result.durationSeconds).toBeGreaterThan(2.9);
    expect(Math.abs(result.durationSeconds - 3)).toBeLessThanOrEqual(0.1);
    expectDuration(result.durationSeconds, frameDuration(stereo, 44100));
    expect(result).toMatchObject({
      bitrateKbps: 128,
      sampleRateHz: 44100,
      channels: 2,
      codec: "MPEG 1 Layer 3",
      title: null,
      artist: null,
    });
  });

  it("accepts MPEG-2 mono at 22.05 kHz", async () => {
    const result = expectOk(await validateMp3(mono));
    expect(Math.abs(result.durationSeconds - 1.5)).toBeLessThanOrEqual(0.1);
    expect(result).toMatchObject({ bitrateKbps: 64, sampleRateHz: 22050, channels: 1, codec: "MPEG 2 Layer 3" });
  });

  it("reads title and artist from an ID3v2 tag without changing the duration", async () => {
    const plain = expectOk(await validateMp3(stereo));
    const tagged = expectOk(await validateMp3(concatBytes(id3v23Tag("Emerald Groove", "Demo Band"), stereo)));
    expect(tagged.title).toBe("Emerald Groove");
    expect(tagged.artist).toBe("Demo Band");
    expect(tagged.durationSeconds).toBe(plain.durationSeconds);
  });

  it("skips repeated ID3v2 tags", async () => {
    const result = expectOk(await validateMp3(concatBytes(id3v23Tag("First", "A"), id3v23Tag("Second", "B"), stereo)));
    expectDuration(result.durationSeconds, frameDuration(stereo, 44100));
  });

  it("accepts a trailing ID3v1 tag and reads it", async () => {
    const result = expectOk(await validateMp3(concatBytes(stereo, id3v1Tag("Old Tag Title", "Old Artist"))));
    expectDuration(result.durationSeconds, frameDuration(stereo, 44100));
    expect(result.title).toBe("Old Tag Title");
    expect(result.artist).toBe("Old Artist");
  });

  it("does not count a large APEv2 tag as junk", async () => {
    const tag = apeV2Tag("Ape Title", Math.round(stereo.length * 0.2)); // far above the 2 % junk budget
    const result = expectOk(await validateMp3(concatBytes(stereo, tag)));
    expectDuration(result.durationSeconds, frameDuration(stereo, 44100));
  });

  it("accepts APEv2 followed by ID3v1", async () => {
    const result = expectOk(await validateMp3(concatBytes(stereo, apeV2Tag("Ape Title", 4000), id3v1Tag("T", "A"))));
    expectDuration(result.durationSeconds, frameDuration(stereo, 44100));
  });

  it("excludes a LAME Info frame from the duration and applies its encoder delay/padding", async () => {
    const frames = mpegFrameOffsets(stereo).length;
    const lame = { delay: 576, padding: 1000 };
    const result = expectOk(await validateMp3(concatBytes(xingInfoFrame(frames, lame), stereo)));
    expectDuration(result.durationSeconds, (frames * 1152 - lame.delay - lame.padding) / 44100);
    expect(result.bitrateKbps).toBe(128);
  });

  it("excludes a VBRI frame from the duration", async () => {
    const frames = mpegFrameOffsets(stereo).length;
    const result = expectOk(await validateMp3(concatBytes(vbriInfoFrame(frames), stereo)));
    expectDuration(result.durationSeconds, (frames * 1152) / 44100);
  });

  it("sums mixed bitrates exactly (no file-size estimate)", async () => {
    const low = encodeToneMp3({ seconds: 1, kbps: 128 });
    const high = encodeToneMp3({ seconds: 1, kbps: 192 });
    const result = expectOk(await validateMp3(concatBytes(low, high)));
    expectDuration(result.durationSeconds, frameDuration(low, 44100) + frameDuration(high, 44100));
    expect(result.bitrateKbps).toBeGreaterThan(128);
    expect(result.bitrateKbps).toBeLessThan(192);
  });

  it("tolerates a little junk between frames (under 2 %)", async () => {
    const long = encodeToneMp3({ seconds: 6 });
    const boundary = mpegFrameOffsets(long)[100];
    const junk = randomBytes(Math.floor(long.length * 0.005), 3).map((byte) => byte & 0x7f); // no 0xFF sync bytes
    const result = expectOk(await validateMp3(concatBytes(long.subarray(0, boundary), junk, long.subarray(boundary))));
    expectDuration(result.durationSeconds, frameDuration(long, 44100));
  });

  it("accepts a file cut mid-stream when no header declares its length (the tail frame is dropped)", async () => {
    const half = stereo.subarray(0, Math.floor(stereo.length / 2) + 100);
    const result = expectOk(await validateMp3(half));
    expect(Math.abs(result.durationSeconds - 1.5)).toBeLessThanOrEqual(0.1);
  });

  it("cleans and caps tag text", async () => {
    const longTitle = `  Loud\u0001Title   ${"x".repeat(300)}`;
    const result = expectOk(await validateMp3(concatBytes(id3v23Tag(longTitle, "  Spaced   Artist "), stereo)));
    expect(result.title?.startsWith("Loud Title x")).toBe(true);
    expect(result.title?.length).toBeLessThanOrEqual(200);
    expect(result.artist).toBe("Spaced Artist");
  });
});

describe("validateMp3: rejections", () => {
  it("rejects an empty file", async () => {
    expectRejected(await validateMp3(new Uint8Array()), "empty");
  });

  it("rejects files over the size limit", async () => {
    expectRejected(await validateMp3(stereo, { maxBytes: 1024 }), "too_large");
  });

  it("rejects a WAV file renamed to .mp3", async () => {
    expectRejected(await validateMp3(wavFile(3)), "not_mp3");
  });

  it("rejects an MP3 wrapped in a RIFF/WAVE container", async () => {
    expectRejected(await validateMp3(riffWrappedMp3(stereo)), "not_mp3");
  });

  it("rejects a text file", async () => {
    expectRejected(await validateMp3(asciiBytes("This is definitely not audio.\n".repeat(120))), "not_mp3");
  });

  it("rejects random bytes", async () => {
    const bytes = randomBytes(64 * 1024, 11);
    bytes[0] = 0x00;
    expectRejected(await validateMp3(bytes), "not_mp3");
  });

  it("rejects random bytes that start with a valid-looking frame header", async () => {
    const bytes = randomBytes(64 * 1024, 12);
    bytes.set([0xff, 0xfb, 0x90, 0x64]);
    expectRejected(await validateMp3(bytes), "not_mp3");
  });

  it("rejects an ID3 tag followed by random bytes", async () => {
    expectRejected(await validateMp3(concatBytes(id3v23Tag("x", "y"), randomBytes(64 * 1024, 13))), "not_mp3");
  });

  it("rejects MPEG Layer II frames", async () => {
    const bytes = randomBytes(8 * 1024, 14);
    bytes.set([0xff, 0xfd, 0x90, 0x04]); // Layer II header bits
    expectRejected(await validateMp3(bytes), "not_mp3");
  });

  it("rejects 4 KB of MP3 followed by garbage as corrupt", async () => {
    const bytes = concatBytes(stereo.subarray(0, 4096), randomBytes(300 * 1024, 15));
    expectRejected(await validateMp3(bytes), "corrupt");
  });

  it("rejects more than 2 % junk between frames as corrupt", async () => {
    const long = encodeToneMp3({ seconds: 6 });
    const boundary = mpegFrameOffsets(long)[100];
    const junk = randomBytes(Math.floor(long.length * 0.04), 16).map((byte) => byte & 0x7f);
    expectRejected(await validateMp3(concatBytes(long.subarray(0, boundary), junk, long.subarray(boundary))), "corrupt");
  });

  it("rejects a file that ends before its Info header says it should", async () => {
    const frames = mpegFrameOffsets(stereo).length;
    const full = concatBytes(xingInfoFrame(frames, { delay: 576, padding: 500 }), stereo);
    expectRejected(await validateMp3(full.subarray(0, Math.floor(full.length / 2))), "truncated");
  });

  it("rejects a file whose ID3v2 tag runs past the end of the data", async () => {
    expectRejected(await validateMp3(concatBytes(id3v2Header(5000), randomBytes(100, 17))), "truncated");
  });

  it("rejects the first kilobyte of an MP3 as too short", async () => {
    expectRejected(await validateMp3(stereo.subarray(0, 1024)), "too_short");
  });

  it("rejects audio shorter than 0.5 s", async () => {
    expectRejected(await validateMp3(encodeToneMp3({ seconds: 0.3 })), "too_short");
  });

  it("honours a custom minimum duration", async () => {
    expectRejected(await validateMp3(stereo, { minDurationSeconds: 10 }), "too_short");
  });
});

describe("fileNameToTitle", () => {
  it.each([
    ["Blue Moon.mp3", "Blue Moon"],
    ["C:\\Music\\01 - Blue_Moon.mp3", "Blue Moon"],
    ["/uploads/07. Night  Drive.MP3", "Night Drive"],
    ["03 Intro.mp3", "Intro"],
    ["99 Luftballons.mp3", "99 Luftballons"],
    ["1999.mp3", "1999"],
    ["7 Rings.mp3", "7 Rings"],
    ["my.song.name.mp3", "my.song.name"],
    [".mp3", "Untitled"],
    ["   .mp3", "Untitled"],
    ["", "Untitled"],
  ])("%s → %s", (fileName, expected) => {
    expect(fileNameToTitle(fileName)).toBe(expected);
  });

  it("caps the title at 200 characters", () => {
    expect(fileNameToTitle(`${"a".repeat(300)}.mp3`)).toHaveLength(200);
  });
});
