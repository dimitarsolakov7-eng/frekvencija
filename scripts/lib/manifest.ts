// supabase/seed/audio/manifest.json: the contract between `npm run demo:audio` (writer) and
// `npm run seed:dev` / the development audio route (readers). Paths in `file` are relative to
// supabase/seed/audio and always use forward slashes.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { SEED_AUDIO_DIR, SEED_MANIFEST_PATH } from "./paths";

export const MANIFEST_VERSION = 1;

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const relativeMp3Path = z
  .string()
  .regex(/^(music|announcements)\/[a-z0-9][a-z0-9-]*\.mp3$/, "file must be music/<id>.mp3 or announcements/<id>.mp3");

const commonFields = {
  /** Unique across the manifest; the file's base name without extension. */
  id: slug,
  file: relativeMp3Path,
  title: z.string().min(1).max(200),
  artist: z.string().min(1).max(200),
  /** Frame-derived playable length as validateMp3() reports it (what the upload flow would store). */
  durationSeconds: z.number().positive(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bitrateKbps: z.number().int().positive(),
  sampleRateHz: z.number().int().positive(),
  channels: z.union([z.literal(1), z.literal(2)]),
  synthetic: z.literal(true),
};

const trackEntrySchema = z.object({
  kind: z.literal("track"),
  ...commonFields,
  /** Genre slug. */
  genre: slug,
  generator: z.literal("synthetic-tones"),
  style: z.object({ mood: z.string(), bpm: z.number().positive(), key: z.string() }),
});

const announcementEntrySchema = z.object({
  kind: z.literal("announcement"),
  ...commonFields,
  /** Demo business key ("emeraldbar", "hotel-aurora"). */
  business: slug,
  templateKey: z.string().min(1).max(64),
  placement: z.enum(["welcome", "rotation", "both"]),
  /** Display wording (announcements.text). */
  text: z.string().min(1).max(500),
  /** Pronunciation wording (announcements.spoken_text), null when identical to `text`. */
  spokenText: z.string().min(1).max(1000).nullable(),
  generator: z.enum(["windows-sapi", "chime-placeholder"]),
  /** SAPI voice that spoke it; null for chime placeholders. */
  voice: z.string().nullable(),
});

export const manifestSchema = z
  .object({
    version: z.literal(MANIFEST_VERSION),
    synthetic: z.literal(true),
    notice: z.string().min(1),
    entries: z.array(z.discriminatedUnion("kind", [trackEntrySchema, announcementEntrySchema])),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    for (const [index, entry] of manifest.entries.entries()) {
      if (ids.has(entry.id)) ctx.addIssue({ code: "custom", message: `duplicate id "${entry.id}"`, path: ["entries", index, "id"] });
      ids.add(entry.id);
      const expectedFile = `${entry.kind === "track" ? "music" : "announcements"}/${entry.id}.mp3`;
      if (entry.file !== expectedFile) {
        ctx.addIssue({ code: "custom", message: `file must be "${expectedFile}"`, path: ["entries", index, "file"] });
      }
    }
  });

export type DemoAudioManifest = z.infer<typeof manifestSchema>;
export type ManifestEntry = DemoAudioManifest["entries"][number];
export type TrackManifestEntry = Extract<ManifestEntry, { kind: "track" }>;
export type AnnouncementManifestEntry = Extract<ManifestEntry, { kind: "announcement" }>;

/** Missing, unreadable or invalid manifest; the message tells the user what to run. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

const REGENERATE_HINT = "Run `npm run demo:audio` to (re)generate the demo audio.";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function absoluteAudioPath(entry: Pick<ManifestEntry, "file">, audioDir: string = SEED_AUDIO_DIR): string {
  return join(audioDir, ...entry.file.split("/"));
}

export async function readManifest(path: string = SEED_MANIFEST_PATH): Promise<DemoAudioManifest> {
  if (!existsSync(path)) throw new ManifestError(`The demo audio manifest is missing (${path}). ${REGENERATE_HINT}`);
  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new ManifestError(`The demo audio manifest could not be read: ${(error as Error).message}. ${REGENERATE_HINT}`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ManifestError(`The demo audio manifest is invalid (${first.path.join(".")}: ${first.message}). ${REGENERATE_HINT}`);
  }
  return parsed.data;
}

export async function writeManifest(manifest: DemoAudioManifest, path: string = SEED_MANIFEST_PATH): Promise<void> {
  const checked = manifestSchema.parse(manifest);
  await writeFile(path, `${JSON.stringify(checked, null, 2)}\n`, "utf8");
}

/**
 * Reads every audio file listed in the manifest and checks it is present and unchanged (size + sha256).
 * Returns the bytes keyed by entry id. Throws ManifestError listing every problem.
 */
export async function loadManifestAudio(manifest: DemoAudioManifest, audioDir: string = SEED_AUDIO_DIR): Promise<Map<string, Uint8Array>> {
  const problems: string[] = [];
  const files = new Map<string, Uint8Array>();
  for (const entry of manifest.entries) {
    const path = absoluteAudioPath(entry, audioDir);
    if (!existsSync(path)) {
      problems.push(`${entry.file} is missing`);
      continue;
    }
    const bytes = new Uint8Array(await readFile(path));
    if (bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256) {
      problems.push(`${entry.file} does not match the manifest (edited or from another run)`);
      continue;
    }
    files.set(entry.id, bytes);
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 5).join("; ");
    const more = problems.length > 5 ? `; and ${problems.length - 5} more` : "";
    throw new ManifestError(`Demo audio problem: ${shown}${more}. ${REGENERATE_HINT}`);
  }
  return files;
}
