import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_BUSINESSES, demoAnnouncementsFor, listDemoTracks } from "../lib/demo-catalog";
import { ManifestError, loadManifestAudio, manifestSchema, readManifest, type DemoAudioManifest } from "../lib/manifest";
import { inspectGeneratedMp3 } from "../lib/mp3-check";

describe("committed demo audio (supabase/seed/audio)", () => {
  it("has a valid manifest that matches the demo catalogue", async () => {
    const manifest = await readManifest();
    expect(manifest.synthetic).toBe(true);
    const tracks = manifest.entries.filter((entry) => entry.kind === "track");
    const announcements = manifest.entries.filter((entry) => entry.kind === "announcement");
    expect(tracks.map((entry) => entry.title)).toEqual(listDemoTracks().map((track) => track.title));
    expect(announcements.map((entry) => [entry.business, entry.templateKey, entry.text])).toEqual(
      DEMO_BUSINESSES.flatMap((business) => demoAnnouncementsFor(business).map((a) => [business.key, a.templateKey, a.text])),
    );
    for (const entry of manifest.entries) {
      expect(entry.synthetic).toBe(true);
      expect(entry.artist).toMatch(/Test Signal$/);
    }
    for (const entry of tracks) {
      expect(entry.durationSeconds, entry.id).toBeGreaterThanOrEqual(20);
      expect(entry.durationSeconds, entry.id).toBeLessThanOrEqual(40);
    }
  });

  it("lists files that exist, are unchanged and are clean MP3 frame streams", async () => {
    const manifest = await readManifest();
    const audio = await loadManifestAudio(manifest);
    expect(audio.size).toBe(manifest.entries.length);
    for (const entry of manifest.entries) {
      const report = inspectGeneratedMp3(audio.get(entry.id)!);
      expect(report.channels).toBe(entry.channels);
      expect(report.sampleRate).toBe(entry.sampleRateHz);
      expect(Math.abs(report.durationSeconds - entry.durationSeconds)).toBeLessThan(0.011);
    }
  });
});

describe("manifest validation", () => {
  const entry = {
    kind: "track" as const,
    id: "test-loop-01-house",
    file: "music/test-loop-01-house.mp3",
    title: "Test Loop 01 — House (synthetic)",
    artist: "Frekvencija Test Signal",
    durationSeconds: 20.1,
    bytes: 3,
    sha256: "a".repeat(64),
    bitrateKbps: 96,
    sampleRateHz: 44100,
    channels: 1 as const,
    synthetic: true as const,
    genre: "house",
    generator: "synthetic-tones" as const,
    style: { mood: "bright", bpm: 122, key: "C" },
  };
  const manifest = (entries: unknown[]) => ({ version: 1, synthetic: true, notice: "synthetic", entries });

  it("rejects duplicate ids, mismatched paths and unlabelled entries", () => {
    expect(manifestSchema.safeParse(manifest([entry])).success).toBe(true);
    expect(manifestSchema.safeParse(manifest([entry, entry])).success).toBe(false);
    expect(manifestSchema.safeParse(manifest([{ ...entry, file: "music/other.mp3" }])).success).toBe(false);
    expect(manifestSchema.safeParse(manifest([{ ...entry, file: "../escape.mp3" }])).success).toBe(false);
    expect(manifestSchema.safeParse(manifest([{ ...entry, synthetic: false }])).success).toBe(false);
  });

  it("tells the user to run demo:audio when files are missing or changed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "venue-radio-manifest-"));
    try {
      await expect(readManifest(join(dir, "manifest.json"))).rejects.toThrow(/npm run demo:audio/);
      const parsed = manifestSchema.parse(manifest([entry])) as DemoAudioManifest;
      await expect(loadManifestAudio(parsed, dir)).rejects.toThrow(/missing.*npm run demo:audio/);
      await mkdir(join(dir, "music"));
      await writeFile(join(dir, "music", "test-loop-01-house.mp3"), "abc");
      await expect(loadManifestAudio(parsed, dir)).rejects.toThrow(ManifestError);
      await expect(loadManifestAudio(parsed, dir)).rejects.toThrow(/does not match/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
