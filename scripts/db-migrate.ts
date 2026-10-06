/**
 * Applies supabase/migrations/*.sql to the hosted Supabase database, in filename order, each once.
 *
 *   npm run db:migrate              apply pending migrations
 *   npm run db:migrate -- --status  list applied / pending migrations, change nothing
 *
 * Connection (from .env.local, never printed):
 *   SUPABASE_DB_URL       full Postgres connection string (Dashboard → Connect → Session pooler), or
 *   SUPABASE_DB_PASSWORD  the database password; the host is found automatically from
 *                         NEXT_PUBLIC_SUPABASE_URL (direct host, then the regional session poolers).
 *                         Optional SUPABASE_DB_REGION (e.g. eu-central-1) is tried first.
 *
 * Applied versions are recorded in supabase_migrations.schema_migrations — the same table the Supabase
 * CLI uses — so `supabase db push` later treats them as already applied.
 * TLS: the connection is encrypted; the server certificate is not pinned to Supabase's CA.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  connectionCandidates,
  isAuthError,
  isTryNextError,
  listMigrationFiles,
  pendingMigrations,
  projectRefFromUrl,
  type ConnectionCandidate,
} from "./lib/db-migrate-plan";
import { loadLocalEnv, readSupabaseUrl } from "./lib/env";
import { PROJECT_ROOT } from "./lib/paths";

const MIGRATIONS_DIR = join(PROJECT_ROOT, "supabase", "migrations");
const STATUS_ONLY = process.argv.includes("--status");

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function connect(): Promise<{ client: pg.Client; label: string }> {
  const ssl = { rejectUnauthorized: false };
  const connectionString = process.env.SUPABASE_DB_URL?.trim();
  if (connectionString) {
    const client = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: 15_000 });
    try {
      await client.connect();
      return { client, label: "SUPABASE_DB_URL" };
    } catch (error) {
      fail(`Could not connect with SUPABASE_DB_URL: ${(error as Error).message}`);
    }
  }

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    fail(
      "Add your database password to .env.local as SUPABASE_DB_PASSWORD=... (the password you chose when " +
        "creating the Supabase project), or set SUPABASE_DB_URL to the full connection string.",
    );
  }
  const ref = projectRefFromUrl(readSupabaseUrl());
  if (!ref) fail("NEXT_PUBLIC_SUPABASE_URL must be your hosted project URL (https://<ref>.supabase.co).");

  const candidates: ConnectionCandidate[] = connectionCandidates(ref, process.env.SUPABASE_DB_REGION?.trim() || null);
  for (const candidate of candidates) {
    const client = new pg.Client({
      host: candidate.host,
      port: candidate.port,
      user: candidate.user,
      password,
      database: "postgres",
      ssl,
      connectionTimeoutMillis: 8_000,
    });
    try {
      await client.connect();
      return { client, label: `${candidate.label} (${candidate.host})` };
    } catch (error) {
      await client.end().catch(() => undefined);
      if (isAuthError(error)) {
        fail("The database password was not accepted. Check SUPABASE_DB_PASSWORD in .env.local (Dashboard → Project Settings → Database lets you reset it).");
      }
      if (!isTryNextError(error)) {
        fail(`Could not connect via ${candidate.label}: ${(error as Error).message}`);
      }
    }
  }
  fail(
    "Could not reach the database on the direct host or any session pooler. Copy the Session pooler " +
      "connection string from the Supabase dashboard (Connect) into .env.local as SUPABASE_DB_URL=...",
  );
}

async function main() {
  loadLocalEnv();
  const files = listMigrationFiles(MIGRATIONS_DIR);
  const { client, label } = await connect();
  console.log(`Connected to the Supabase database via ${label}.`);

  try {
    await client.query(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
      alter table supabase_migrations.schema_migrations add column if not exists statements text[];
      alter table supabase_migrations.schema_migrations add column if not exists name text;
    `);
    const { rows } = await client.query<{ version: string }>("select version from supabase_migrations.schema_migrations");
    const applied = new Set(rows.map((r) => r.version));
    const pending = pendingMigrations(files, applied);

    for (const f of files) {
      console.log(`  ${applied.has(f.version) ? "applied" : "pending"}  ${f.fileName}`);
    }
    if (STATUS_ONLY) return;
    if (pending.length === 0) {
      console.log("\nThe database is up to date.");
      return;
    }

    for (const f of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f.fileName), "utf8");
      process.stdout.write(`Applying ${f.fileName} … `);
      try {
        await client.query(sql);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        const e = error as { message?: string; position?: string; detail?: string; hint?: string };
        console.log("failed");
        fail(
          `${f.fileName} failed: ${e.message ?? String(error)}` +
            (e.position ? ` (at character ${e.position})` : "") +
            (e.detail ? `\n  detail: ${e.detail}` : "") +
            (e.hint ? `\n  hint: ${e.hint}` : "") +
            "\nNothing from this file was kept (each migration runs in a transaction). Earlier files stay applied.",
        );
      }
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing",
        [f.version, f.name],
      );
      console.log("done");
    }
    console.log(`\nApplied ${pending.length} migration(s). Next: npm run seed:dev -- --yes --allow-remote (demo data) or npm run admin:create -- <email>.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
