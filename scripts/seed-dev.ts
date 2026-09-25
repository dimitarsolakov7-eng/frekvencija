// npm run seed:dev -- --yes [--allow-remote] [--admin-email <email>]
// npm run seed:dev -- --dry-run
//
// Development seed: demo genres, the example venues EmeraldBar and Hotel Aurora, demo users (random
// one-time passwords), the synthetic demo tracks and each venue's approved demo announcements.
// Guarded: never with NODE_ENV=production, only with --yes, and only against localhost unless
// --allow-remote is also passed. Idempotent: re-running reuses the demo rows it created before.
import { PLATFORM_NAME } from "../src/config/platform";
import { formatBytes, formatTable } from "./lib/table";
import { businessTypeLabel } from "./lib/demo-catalog";
import { getSiteUrl, getSupabaseAdminConfig, loadLocalEnv, readSupabaseUrl } from "./lib/env";
import { ManifestError, loadManifestAudio, readManifest, type DemoAudioManifest } from "./lib/manifest";
import { applySeedPlan, readExistingState, type CreatedCredential, type SeedSummary } from "./lib/seed-apply";
import {
  EMPTY_EXISTING_STATE,
  SEED_USAGE,
  buildSeedPlan,
  evaluateSeedSafety,
  formatSeedPlan,
  parseSeedArgs,
  resolveSeedUsers,
  type ExistingState,
  type SeedCliOptions,
} from "./lib/seed-plan";
import { MissingMigrationError, UNREACHABLE_HINT, createScriptAdminClient, describeError, isNetworkFailure } from "./lib/supabase-admin";

function describeAudio(manifest: DemoAudioManifest): string {
  const tracks = manifest.entries.filter((entry) => entry.kind === "track").length;
  const announcements = manifest.entries.filter((entry) => entry.kind === "announcement");
  const chimes = announcements.filter((entry) => entry.generator === "chime-placeholder").length;
  const bytes = manifest.entries.reduce((n, entry) => n + entry.bytes, 0);
  const voices = chimes === announcements.length ? "chime placeholders" : chimes > 0 ? `${chimes} chime placeholders, rest Windows SAPI` : "Windows SAPI voices";
  return `${tracks} synthetic loops + ${announcements.length} announcements (${voices}), ${formatBytes(bytes)}; all labelled synthetic`;
}

function printCredentials(credentials: CreatedCredential[]): void {
  if (credentials.length === 0) {
    console.log("\nNo new users were created, so no passwords are shown (existing users keep their passwords).");
    return;
  }
  console.log("\nONE-TIME PASSWORDS for the users created in this run. They are not stored anywhere and will not be shown again:");
  console.log(formatTable(["Email", "Role", "Venue", "Password"], credentials.map((c) => [c.email, c.role, c.venue ?? "-", c.password])));
}

function printSummary(summary: SeedSummary): void {
  console.log("\nSeed complete.");
  console.log(
    formatTable(["Venue", "Type", "Status", "Business id"], summary.businesses.map((b) => [b.name, businessTypeLabel(b.type), b.status, b.id])),
  );
  console.log("");
  console.log(formatTable(["User", "Role", "Venue", "Status"], summary.users.map((u) => [u.email, u.role, u.venue ?? "-", u.status])));
  console.log(
    `\n  Genres: ${summary.genres.created} created, ${summary.genres.existing} existing. Exclusive access rows added: ${summary.genreAccessCreated}. ` +
      `Memberships added: ${summary.membershipsCreated}.` +
      `\n  Tracks: ${summary.tracks.created} uploaded, ${summary.tracks.existing} existing. ` +
      `Announcements: ${summary.announcements.created} created, ${summary.announcements.audioAttached} audio attached, ${summary.announcements.existing} existing.`,
  );
}

async function main(): Promise<void> {
  let cli: SeedCliOptions;
  try {
    cli = parseSeedArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${SEED_USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (cli.help) {
    console.log(SEED_USAGE);
    return;
  }

  const envFiles = loadLocalEnv();
  console.log(`${PLATFORM_NAME} development seed${cli.dryRun ? " (DRY RUN: no network calls, nothing is written)" : ""}`);
  console.log(`  Env files: ${envFiles.length > 0 ? envFiles.join(", ") : "none found (using the shell environment)"}`);

  let supabaseUrl: string | null;
  try {
    supabaseUrl = readSupabaseUrl();
  } catch (error) {
    console.error(`\n${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const safety = evaluateSeedSafety({ nodeEnv: process.env.NODE_ENV, supabaseUrl, yes: cli.yes, allowRemote: cli.allowRemote });
  console.log(`  Target: ${safety.target.url ? `${safety.target.url} (${safety.target.local ? "local" : "REMOTE"})` : "not configured"}`);

  let manifest: DemoAudioManifest;
  let audio: Map<string, Uint8Array>;
  try {
    manifest = await readManifest();
    audio = await loadManifestAudio(manifest);
  } catch (error) {
    if (!(error instanceof ManifestError)) throw error;
    console.error(`\n${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  Demo audio: ${describeAudio(manifest)}`);

  const { users, problems } = resolveSeedUsers(cli, process.env);
  if (problems.length > 0) {
    console.error(`\nCannot seed:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }

  if (cli.dryRun) {
    if (safety.refusals.length > 0) {
      console.log(`\nA real run with these settings would REFUSE:\n${safety.refusals.map((r) => `  - ${r}`).join("\n")}`);
    } else {
      console.log("\nSafety checks pass: a real run with these settings would proceed.");
    }
    console.log(formatSeedPlan(buildSeedPlan({ manifest, users, existing: EMPTY_EXISTING_STATE }), { checkedExisting: false }));
    return;
  }

  if (safety.refusals.length > 0) {
    console.error(`\nRefusing to seed:\n${safety.refusals.map((r) => `  - ${r}`).join("\n")}\n\nNothing was written. See npm run seed:dev -- --help`);
    process.exitCode = 1;
    return;
  }

  const client = createScriptAdminClient(getSupabaseAdminConfig());
  let existing: ExistingState;
  try {
    existing = await readExistingState(client, manifest, users);
  } catch (error) {
    // A migration is missing (e.g. 20260926000100): refuse before writing anything.
    if (!(error instanceof MissingMigrationError)) throw error;
    console.error(`\n${error.message}`);
    process.exitCode = 1;
    return;
  }
  const plan = buildSeedPlan({ manifest, users, existing });
  console.log(formatSeedPlan(plan, { checkedExisting: true }));
  if (plan.conflicts.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("\nWriting…");
  const credentials: CreatedCredential[] = [];
  try {
    const summary = await applySeedPlan(client, plan, audio, credentials, (line) => console.log(line));
    printSummary(summary);
  } catch (error) {
    console.error(`\nSeed FAILED: ${describeError(error)}\nRows written so far are kept; re-running the seed is safe and continues from there.`);
    printCredentials(credentials);
    process.exitCode = 1;
    return;
  }
  printCredentials(credentials);
  try {
    console.log(`\nSign in at ${getSiteUrl({ allowDefault: true })}/login`);
  } catch {
    // An invalid NEXT_PUBLIC_SITE_URL does not affect the seed; the app reports it on startup.
  }
}

main().catch((error: unknown) => {
  console.error(`seed:dev failed: ${describeError(error)}`);
  if (isNetworkFailure(error)) console.error(UNREACHABLE_HINT);
  process.exitCode = 1;
});
