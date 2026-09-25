// npm run demo:audio [-- --no-sapi]
//
// Generates the clearly labelled demo audio into supabase/seed/audio/:
//   music/*.mp3          synthetic tone loops (NOT real music), 20–40 s each, mono 96 kbps
//   announcements/*.mp3  per-venue announcements spoken by Windows SAPI, or chime placeholders
//   manifest.json        what each file is (read by `npm run seed:dev` and the dev audio route)
// Every file is loudness-normalised to -16 LUFS / -1 dBFS, ID3-tagged as synthetic, and verified
// with a strict frame walk plus the app's own upload validator before it is written.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEMO_BUSINESSES, SYNTHETIC_NOTICE, demoAnnouncementsFor, listDemoTracks } from "./lib/demo-catalog";
import { renderDemoAnnouncement, renderDemoTrack, type SpeechSource } from "./lib/demo-audio";
import { MANIFEST_VERSION, absoluteAudioPath, writeManifest, type ManifestEntry } from "./lib/manifest";
import { SEED_ANNOUNCEMENTS_DIR, SEED_MANIFEST_PATH, SEED_MUSIC_DIR, displayPath } from "./lib/paths";
import { chooseVoice, probeSapi, type SapiProbe } from "./lib/sapi";
import { formatBytes, formatTable } from "./lib/table";

const USAGE = `Usage: npm run demo:audio [-- --no-sapi]

Writes synthetic demo loops and demo announcements to supabase/seed/audio/.
  --no-sapi   Use chime placeholders instead of Windows SAPI speech.
  --help      Show this help.`;

function parseCli(argv: string[]): { noSapi: boolean } | null {
  const { values } = parseArgs({
    args: argv,
    options: { "no-sapi": { type: "boolean", default: false }, help: { type: "boolean", default: false } },
    strict: true,
    allowPositionals: false,
  });
  return values.help ? null : { noSapi: values["no-sapi"] };
}

/** Deletes generated MP3s that are not part of this run (e.g. after a catalogue change). */
async function removeStaleFiles(dir: string, keep: Set<string>): Promise<string[]> {
  const removed: string[] = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if (name.toLowerCase().endsWith(".mp3") && !keep.has(path)) {
      await rm(path);
      removed.push(displayPath(path));
    }
  }
  return removed;
}

async function main(): Promise<void> {
  let cli: { noSapi: boolean } | null;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (!cli) {
    console.log(USAGE);
    return;
  }

  const started = performance.now();
  await mkdir(SEED_MUSIC_DIR, { recursive: true });
  await mkdir(SEED_ANNOUNCEMENTS_DIR, { recursive: true });
  const entries: ManifestEntry[] = [];
  const rows: string[][] = [];

  console.log("Generating synthetic demo loops (test signals, not real music)…");
  for (const track of listDemoTracks()) {
    const { bytes, entry } = await renderDemoTrack(track);
    await writeFile(absoluteAudioPath(entry), bytes);
    entries.push(entry);
    rows.push([entry.file, `${entry.durationSeconds.toFixed(2)} s`, formatBytes(entry.bytes), `${track.genre.name}, ${entry.style.mood}, ${entry.style.bpm} bpm, key ${entry.style.key}`]);
    console.log(`  ok  ${entry.file}  ${entry.durationSeconds.toFixed(2)} s  ${formatBytes(entry.bytes)}`);
  }

  const probe: SapiProbe = cli.noSapi ? { available: false, reason: "--no-sapi was passed" } : await probeSapi();
  if (probe.available) {
    console.log(`\nSpeaking demo announcements with Windows SAPI (voices: ${probe.voices.map((v) => v.name).join(", ")})…`);
  } else {
    console.log(`\nWindows SAPI not used (${probe.reason}): writing clearly labelled CHIME PLACEHOLDERS instead of speech…`);
  }
  const fallbacks: string[] = [];
  for (const business of DEMO_BUSINESSES) {
    const voice = probe.available ? chooseVoice(business.sapiVoice, probe.voices) : null;
    const speech: SpeechSource = voice ? { kind: "sapi", voice } : { kind: "chime", reason: probe.available ? "no voice" : probe.reason };
    if (voice && voice !== business.sapiVoice) {
      console.log(`  note: "${business.sapiVoice}" is not installed; ${business.name} uses "${voice}"`);
    }
    for (const announcement of demoAnnouncementsFor(business)) {
      const { bytes, entry, fallbackReason } = await renderDemoAnnouncement(announcement, business, speech);
      if (fallbackReason) fallbacks.push(`${entry.file}: ${fallbackReason}`);
      await writeFile(absoluteAudioPath(entry), bytes);
      entries.push(entry);
      const how = entry.generator === "windows-sapi" ? `SAPI ${entry.voice}` : "chime placeholder";
      rows.push([entry.file, `${entry.durationSeconds.toFixed(2)} s`, formatBytes(entry.bytes), `${business.name} ${entry.placement}: "${entry.text}" (${how})`]);
      console.log(`  ok  ${entry.file}  ${entry.durationSeconds.toFixed(2)} s  ${formatBytes(entry.bytes)}  ${how}`);
    }
  }

  const keep = new Set(entries.map((entry) => absoluteAudioPath(entry)));
  const removed = [...(await removeStaleFiles(SEED_MUSIC_DIR, keep)), ...(await removeStaleFiles(SEED_ANNOUNCEMENTS_DIR, keep))];
  await writeManifest({ version: MANIFEST_VERSION, synthetic: true, notice: SYNTHETIC_NOTICE, entries });

  const tracks = entries.filter((entry) => entry.kind === "track");
  const announcements = entries.filter((entry) => entry.kind === "announcement");
  const sum = (list: ManifestEntry[]) => list.reduce((n, entry) => n + entry.bytes, 0);
  console.log(`\n${formatTable(["File", "Length", "Size", "What"], rows)}`);
  console.log(
    `\n${tracks.length} loops (${formatBytes(sum(tracks))}) + ${announcements.length} announcements (${formatBytes(sum(announcements))}) = ${formatBytes(sum(entries))}` +
      ` in ${((performance.now() - started) / 1000).toFixed(1)} s. Manifest: ${displayPath(SEED_MANIFEST_PATH)}`,
  );
  if (removed.length > 0) console.log(`Removed stale files: ${removed.join(", ")}`);
  if (fallbacks.length > 0) {
    console.warn(`\nWARNING: SAPI failed for ${fallbacks.length} announcement(s); chime placeholders were written instead:\n  ${fallbacks.join("\n  ")}`);
  }
  console.log("All files are synthetic and labelled as such (ID3 tags + manifest). Next: npm run seed:dev -- --yes");
}

main().catch((error: unknown) => {
  console.error(`demo:audio failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
