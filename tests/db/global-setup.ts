// Vitest globalSetup for the "db" project: apply the shim and every migration
// ONCE, dump the data directory to a temp tarball, and hand its path to each
// test file (which restores it in ~0.5 s instead of re-running migrations).
// A migration that fails to apply fails the whole run here.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { createTestDb, MIGRATIONS_DIR } from "./supabase-test-db";

declare module "vitest" {
  export interface ProvidedContext {
    pgliteSnapshotPath: string;
  }
}

export default async function setup(project: TestProject): Promise<() => void> {
  const testDb = await createTestDb({ migrationsDir: MIGRATIONS_DIR });
  let snapshot: File | Blob;
  try {
    snapshot = await testDb.snapshot();
  } finally {
    await testDb.close();
  }

  const dir = mkdtempSync(join(tmpdir(), "venue-radio-pglite-"));
  const file = join(dir, "snapshot.tar");
  writeFileSync(file, Buffer.from(await snapshot.arrayBuffer()));
  project.provide("pgliteSnapshotPath", file);

  return () => rmSync(dir, { recursive: true, force: true });
}
