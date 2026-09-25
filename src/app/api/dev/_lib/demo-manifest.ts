import "server-only";
import { stat, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";

/**
 * Development-only reader for supabase/seed/audio/manifest.json (written by `npm run demo:audio`;
 * full schema in scripts/lib/manifest.ts). Only the fields the dev audio route and the player lab
 * need are validated here. Files are only ever addressed through manifest entries, never through a
 * path taken from a request.
 */

// turbopackIgnore: development-only files; without it, build-time file tracing would treat the
// dynamic paths below as "anything under the project" and trace the whole project.
export const DEMO_AUDIO_DIR = join(/* turbopackIgnore: true */ process.cwd(), "supabase", "seed", "audio");
export const DEMO_MANIFEST_PATH = join(/* turbopackIgnore: true */ DEMO_AUDIO_DIR, "manifest.json");

/** Manifest ids are lowercase slugs (also each file's base name). */
export const DEMO_AUDIO_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 100;

const slug = z.string().max(MAX_ID_LENGTH).regex(DEMO_AUDIO_ID_PATTERN);
const relativeMp3Path = z.string().regex(/^(music|announcements)\/[a-z0-9][a-z0-9-]*\.mp3$/);

const common = {
  id: slug,
  file: relativeMp3Path,
  title: z.string().min(1).max(200),
  artist: z.string().min(1).max(200),
  durationSeconds: z.number().positive(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
};

const trackEntry = z.object({ kind: z.literal("track"), ...common, genre: slug });
const announcementEntry = z.object({
  kind: z.literal("announcement"),
  ...common,
  business: slug,
  templateKey: z.string().min(1).max(64),
  placement: z.enum(["welcome", "rotation", "both"]),
  text: z.string().min(1).max(500),
});

const manifestSchema = z
  .object({
    version: z.literal(1),
    synthetic: z.literal(true),
    notice: z.string().min(1),
    entries: z.array(z.discriminatedUnion("kind", [trackEntry, announcementEntry])),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    manifest.entries.forEach((entry, index) => {
      if (seen.has(entry.id)) ctx.addIssue({ code: "custom", message: `duplicate id "${entry.id}"`, path: ["entries", index, "id"] });
      seen.add(entry.id);
      const expected = `${entry.kind === "track" ? "music" : "announcements"}/${entry.id}.mp3`;
      if (entry.file !== expected) {
        ctx.addIssue({ code: "custom", message: `file must be "${expected}"`, path: ["entries", index, "file"] });
      }
    });
  });

export type DemoManifest = z.infer<typeof manifestSchema>;
export type DemoManifestEntry = DemoManifest["entries"][number];
export type DemoTrackEntry = Extract<DemoManifestEntry, { kind: "track" }>;
export type DemoAnnouncementEntry = Extract<DemoManifestEntry, { kind: "announcement" }>;

/** Missing or invalid manifest; the message says how to fix it. */
export class DemoManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoManifestError";
  }
}

const REGENERATE_HINT = "Run `npm run demo:audio` to generate the demo audio.";

let cache: { mtimeMs: number; path: string; manifest: DemoManifest } | null = null;

/** Reads and validates the manifest (cached until the file changes). */
export async function loadDemoManifest(path: string = DEMO_MANIFEST_PATH): Promise<DemoManifest> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(path)).mtimeMs;
  } catch {
    throw new DemoManifestError(`The demo audio manifest is missing (supabase/seed/audio/manifest.json). ${REGENERATE_HINT}`);
  }
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache.manifest;

  let json: unknown;
  try {
    json = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new DemoManifestError(`The demo audio manifest could not be read. ${REGENERATE_HINT}`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DemoManifestError(
      `The demo audio manifest is invalid (${issue ? `${issue.path.join(".")}: ${issue.message}` : "unknown problem"}). ${REGENERATE_HINT}`,
    );
  }
  cache = { mtimeMs, path, manifest: parsed.data };
  return parsed.data;
}

/** The entry with this id, or null. Ids that are not slugs are rejected before any lookup. */
export function findDemoEntry(manifest: DemoManifest, id: string): DemoManifestEntry | null {
  if (id.length > MAX_ID_LENGTH || !DEMO_AUDIO_ID_PATTERN.test(id)) return null;
  return manifest.entries.find((entry) => entry.id === id) ?? null;
}

/**
 * Absolute path of an entry's file. The manifest schema already pins `file` to
 * `music|announcements/<id>.mp3`; the containment check is defence in depth.
 */
export function resolveDemoAudioPath(entry: Pick<DemoManifestEntry, "file">, audioDir: string = DEMO_AUDIO_DIR): string {
  const root = resolve(/* turbopackIgnore: true */ audioDir);
  const absolute = resolve(/* turbopackIgnore: true */ root, ...entry.file.split("/"));
  const rel = relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`) || resolve(/* turbopackIgnore: true */ root, rel) !== absolute) {
    throw new DemoManifestError("A manifest entry points outside the demo audio folder.");
  }
  return absolute;
}
