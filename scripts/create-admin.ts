// npm run admin:create -- <email> [--link]
//
// Bootstraps a platform admin: promotes an existing user, or invites a new one (email, or with --link a
// one-time invite link to deliver privately) and then promotes them. Never sets or prints passwords.
import { PLATFORM_NAME } from "../src/config/platform";
import { CREATE_ADMIN_USAGE, ensurePlatformAdmin, parseCreateAdminArgs } from "./lib/admin-invite";
import { ScriptEnvError, getSiteUrl, getSupabaseAdminConfig, isLocalUrl, loadLocalEnv } from "./lib/env";
import { UNREACHABLE_HINT, createScriptAdminClient, describeError, isNetworkFailure } from "./lib/supabase-admin";

const LINK_WARNING = [
  "WARNING: this link signs the recipient in as the new admin. Deliver it privately (not in a shared",
  "channel), only to that person. It works once and expires after the project's Email OTP expiration",
  "(default 1 hour); run this command again with --link for a fresh one.",
].join("\n");

async function main(): Promise<void> {
  const args = parseCreateAdminArgs(process.argv.slice(2));
  if (args.kind === "help") {
    console.log(CREATE_ADMIN_USAGE);
    return;
  }
  if (args.kind === "error") {
    console.error(`${args.message}\n\n${CREATE_ADMIN_USAGE}`);
    process.exitCode = 2;
    return;
  }

  loadLocalEnv();
  const config = getSupabaseAdminConfig();
  // A missing NEXT_PUBLIC_SITE_URL is only tolerated for a local project (links then use localhost:3000).
  const siteUrl = getSiteUrl({ allowDefault: isLocalUrl(config.url) });
  console.log(`${PLATFORM_NAME}: make ${args.email} a platform admin`);
  console.log(`  Project: ${config.url} (${isLocalUrl(config.url) ? "local" : "remote"})`);

  const result = await ensurePlatformAdmin(createScriptAdminClient(config), { email: args.email, link: args.link, siteUrl }, (line) =>
    console.log(`  ${line}`),
  );
  if (result.link) {
    console.log(`\nOne-time invite link for ${args.email}:\n\n  ${result.link}\n\n${LINK_WARNING}`);
  }
}

main().catch((error: unknown) => {
  console.error(`admin:create failed: ${describeError(error)}`);
  if (isNetworkFailure(error)) {
    console.error(UNREACHABLE_HINT);
  } else if (!(error instanceof ScriptEnvError)) {
    console.error("If the user was invited but not promoted, re-run the same command: it promotes existing users.");
  }
  process.exitCode = 1;
});
