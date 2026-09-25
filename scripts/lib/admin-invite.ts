// Logic behind `npm run admin:create -- <email> [--link]`: argument parsing, invite-link building and the
// promote-or-invite flow. The flow takes the client and a logger, so it is tested against a fake.
import { parseArgs } from "node:util";
import { isPlausibleEmail, normaliseEmail } from "./seed-plan";
import {
  ScriptStepError,
  findAuthUserIdByEmail,
  findProfileByEmail,
  isEmailExistsError,
  promoteToPlatformAdmin,
  type AdminClient,
} from "./supabase-admin";

export const CREATE_ADMIN_USAGE = `Usage: npm run admin:create -- <email> [--link]

Makes <email> a platform admin:
  - existing user  -> promoted to platform_admin (their password is not touched)
  - new user       -> invited by email (Supabase Auth sends it; redirect: NEXT_PUBLIC_SITE_URL), then promoted
  --link           Instead of sending an email, print a one-time invite link to deliver privately
                   (use when Supabase's default SMTP cannot reach the address).
This command never sets or prints passwords.`;

export type CreateAdminArgs = { kind: "run"; email: string; link: boolean } | { kind: "help" } | { kind: "error"; message: string };

export function parseCreateAdminArgs(argv: string[]): CreateAdminArgs {
  let values: { link?: boolean; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: { link: { type: "boolean" }, help: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    return { kind: "error", message: (error as Error).message };
  }
  if (values.help) return { kind: "help" };
  if (positionals.length !== 1) {
    return { kind: "error", message: positionals.length === 0 ? "Pass the admin's email address." : "Pass exactly one email address." };
  }
  const email = normaliseEmail(positionals[0]);
  if (!isPlausibleEmail(email)) return { kind: "error", message: `"${positionals[0]}" is not a valid email address.` };
  return { kind: "run", email, link: values.link === true };
}

/**
 * The link an invite/recovery email would contain (docs/research/supabase.md §4.4): the app's
 * /auth/confirm page verifies the token hash after a button press and continues to /reset-password.
 */
export function buildConfirmLink(siteUrl: string, hashedToken: string, type: "invite" | "recovery"): string {
  if (!hashedToken) throw new Error("buildConfirmLink: the token hash is empty");
  return `${siteUrl.replace(/\/+$/, "")}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=${type}&next=/reset-password`;
}

/** Creates the auth user by invitation; "exists" when the email is already registered and confirmed. */
async function invite(client: AdminClient, email: string, siteUrl: string, asLink: boolean): Promise<{ userId: string; link: string | null } | "exists"> {
  if (asLink) {
    const { data, error } = await client.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: siteUrl } });
    if (isEmailExistsError(error)) return "exists";
    if (error) throw new ScriptStepError(`create an invite link for ${email}`, error);
    return { userId: data.user.id, link: buildConfirmLink(siteUrl, data.properties.hashed_token, "invite") };
  }
  const { data, error } = await client.auth.admin.inviteUserByEmail(email, { redirectTo: siteUrl });
  if (isEmailExistsError(error)) return "exists";
  if (error) {
    const smtpHint =
      error.code === "over_email_send_rate_limit" || error.code === "email_address_not_authorized"
        ? " Supabase's default SMTP only delivers to project team members (2 emails/hour): configure custom SMTP or re-run with --link."
        : "";
    throw new ScriptStepError(`invite ${email}`, { code: error.code, status: error.status, message: `${error.message}.${smtpHint}` });
  }
  return { userId: data.user.id, link: null };
}

export interface EnsureAdminOptions {
  email: string;
  /** Print a one-time invite link instead of sending an email (new or not-yet-confirmed users). */
  link: boolean;
  /** Origin the invite redirects to (NEXT_PUBLIC_SITE_URL). */
  siteUrl: string;
}

export interface EnsureAdminResult {
  userId: string;
  /** One-time invite link to deliver privately, when one was created. */
  link: string | null;
  /** Whether profiles.role was changed by this run. */
  promoted: boolean;
}

/**
 * Promotes an existing user, or invites a new one and then promotes them. Never sets a password.
 * If promotion fails after an invite, re-running is safe: the user then exists and is promoted.
 */
export async function ensurePlatformAdmin(client: AdminClient, options: EnsureAdminOptions, log: (line: string) => void): Promise<EnsureAdminResult> {
  const { email, siteUrl } = options;
  const profile = await findProfileByEmail(client, email);
  let userId = profile?.id ?? null;
  let link: string | null = null;

  if (!userId) {
    const invited = await invite(client, email, siteUrl, options.link);
    if (invited === "exists") {
      // An auth user without a profile row (created before the migrations installed the trigger).
      userId = await findAuthUserIdByEmail(client, email);
      if (!userId) throw new Error(`Supabase reports ${email} as registered, but the user could not be found.`);
      log(`${email} already has an account (it had no profile row); their password is not changed.`);
    } else {
      userId = invited.userId;
      link = invited.link;
      log(
        link
          ? `Created an invitation for ${email} (no email was sent).`
          : `Invitation email sent to ${email}; its link continues to ${siteUrl}/auth/confirm and then /reset-password.`,
      );
    }
  } else {
    log(`${email} already has an account; their password is not changed.`);
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error) throw new ScriptStepError(`read the account of ${email}`, error);
    const confirmed = Boolean(data.user.email_confirmed_at);
    if (options.link && confirmed) {
      log('--link ignored: the account is already confirmed. They sign in with their own password (or use "Forgot password").');
    } else if (options.link) {
      const invited = await invite(client, email, siteUrl, true);
      if (invited !== "exists") link = invited.link;
    } else if (!confirmed) {
      log("The account has not accepted its invitation yet; re-run with --link for a fresh one-time invite link.");
    }
  }

  if (profile?.role === "platform_admin") {
    log(`${email} is already a platform admin. Nothing changed.`);
    return { userId, link, promoted: false };
  }
  const outcome = await promoteToPlatformAdmin(client, userId, email);
  log(`${email} is now a platform admin${outcome === "created-profile" ? " (profile row created)" : ""}.`);
  return { userId, link, promoted: true };
}
