import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts", "scripts/tests/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "tests/db/**"],
          sequence: { groupOrder: 0 },
        },
      },
      {
        // DB/RLS tests on PGlite. The global setup (migrated snapshot) only runs
        // when at least one tests/db file is selected.
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          // Each PGlite instance holds ~350 MB; different maxWorkers require their own group.
          maxWorkers: 3,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
