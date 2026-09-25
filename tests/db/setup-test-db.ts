import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, inject } from "vitest";
import { createTestDb, type TestDb } from "./supabase-test-db";

export interface TestDbHandle<F> {
  /** The file's database (available once beforeAll has run). */
  (): TestDb;
  /** Whatever the seed function returned (ids of the seeded rows). */
  fixtures(): F;
}

/**
 * One PGlite instance per test FILE, restored from the globalSetup snapshot and
 * optionally seeded (committed) once; one BEGIN/ROLLBACK per TEST, so every test
 * starts from the seeded state. Never call db.transaction() or BEGIN/COMMIT in a
 * test body: it would commit the per-test transaction.
 */
export function setupTestDb<F = undefined>(seed?: (testDb: TestDb) => Promise<F>): TestDbHandle<F> {
  let testDb: TestDb | undefined;
  let fixtures: F | undefined;
  let seeded = false;

  beforeAll(async () => {
    const tar = readFileSync(inject("pgliteSnapshotPath"));
    testDb = await createTestDb({ loadDataDir: new Blob([tar]) });
    if (seed) {
      await testDb.begin();
      try {
        fixtures = await seed(testDb);
      } catch (error) {
        await testDb.rollback();
        throw error;
      }
      await testDb.db.exec("commit");
    }
    seeded = true;
  });

  beforeEach(async () => {
    await current().begin();
  });

  afterEach(async () => {
    await current().rollback();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  function current(): TestDb {
    if (!testDb) throw new Error("Test database is not ready (beforeAll has not completed)");
    return testDb;
  }

  const handle = (() => current()) as TestDbHandle<F>;
  handle.fixtures = () => {
    if (!seeded) throw new Error("Fixtures are not ready (beforeAll has not completed)");
    return fixtures as F;
  };
  return handle;
}
