// Filesystem locations shared by the demo-audio generator and the development seed.
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Project root (the directory that contains `scripts/`). */
export const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Generated demo audio lives here (served in development by GET /api/dev/audio/[file]). */
export const SEED_AUDIO_DIR = join(PROJECT_ROOT, "supabase", "seed", "audio");
export const SEED_MUSIC_DIR = join(SEED_AUDIO_DIR, "music");
export const SEED_ANNOUNCEMENTS_DIR = join(SEED_AUDIO_DIR, "announcements");
export const SEED_MANIFEST_PATH = join(SEED_AUDIO_DIR, "manifest.json");

/** Path as printed to the user: relative to the project root with forward slashes. */
export function displayPath(absolutePath: string): string {
  const root = PROJECT_ROOT.replace(/[\\/]+$/, "");
  const normalised = absolutePath.startsWith(root) ? absolutePath.slice(root.length + 1) : absolutePath;
  return normalised.replace(/\\/g, "/");
}
