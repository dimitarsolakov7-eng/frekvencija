// npm run demo:remove -- --yes [--genres]
// npm run demo:remove -- --dry-run [--genres]
//
// Deletes the demo data written by `npm run seed:dev` (demo venues, users and synthetic tracks, with
// their Storage objects) before launch. Only rows with a seed marker are touched; the plan is printed
// first, and --dry-run reads the project without deleting anything.
import { PLATFORM_NAME } from "../src/config/platform";
import { REMOVE_USAGE, applyRemovePlan, buildRemovePlan, formatRemovePlan, isEmptyPlan, parseRemoveArgs, readDemoState } from "./lib/demo-remove";
import { getSupabaseAdminConfig, isLocalUrl, loadLocalEnv } from "./lib/env";
import { MissingMigrationError, UNREACHABLE_HINT, createScriptAdminClient, describeError, isNetworkFailure } from "./lib/supabase-admin";

async function main(): Promise<void> {
  let cli;
  try {
    cli = parseRemoveArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${REMOVE_USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (cli.help) {
    console.log(REMOVE_USAGE);
    return;
  }
  if (!cli.yes && !cli.dryRun) {
    console.error(`Pass --yes to delete the demo data, or --dry-run to see what would be deleted.\n\n${REMOVE_USAGE}`);
    process.exitCode = 2;
    return;
  }

  const envFiles = loadLocalEnv();
  const config = getSupabaseAdminConfig();
  console.log(`${PLATFORM_NAME}: remove demo data${cli.dryRun ? " (DRY RUN: reads the project, deletes nothing)" : ""}`);
  console.log(`  Env files: ${envFiles.length > 0 ? envFiles.join(", ") : "none found (using the shell environment)"}`);
  console.log(`  Project: ${config.url} (${isLocalUrl(config.url) ? "local" : "remote"})`);

  const client = createScriptAdminClient(config);
  let plan;
  try {
    plan = buildRemovePlan(await readDemoState(client), { genres: cli.genres });
  } catch (error) {
    if (!(error instanceof MissingMigrationError)) throw error;
    console.error(`\n${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(formatRemovePlan(plan));
  if (cli.dryRun || isEmptyPlan(plan)) return;

  console.log("\nDeleting…");
  try {
    const summary = await applyRemovePlan(client, plan, (line) => console.log(line));
    console.log(
      `\nDone: ${summary.businesses} businesses (${summary.announcements} announcements), ${summary.users} users, ${summary.tracks} tracks` +
        `${summary.genres > 0 ? `, ${summary.genres} genres` : ""} and ${summary.objects} files deleted` +
        `${summary.genresReopened > 0 ? `; ${summary.genresReopened} genres offered to all businesses again` : ""}.`,
    );
  } catch (error) {
    console.error(`\nRemoval FAILED: ${describeError(error)}\nRows deleted so far are gone; re-running the command is safe and continues from there.`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`demo:remove failed: ${describeError(error)}`);
  if (isNetworkFailure(error)) console.error(UNREACHABLE_HINT);
  process.exitCode = 1;
});
