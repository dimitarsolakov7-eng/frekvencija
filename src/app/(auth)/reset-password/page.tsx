import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { FORM_LINK_CLASSES, FormDivider, FormHeading } from "@/components/public/FormHeading";
import { PLATFORM_NAME } from "@/config/platform";
import { getSessionContext, type SessionContext } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { passwordPageMode, type PasswordPageMode } from "../_lib/password";
import { homePathForRole } from "../_lib/redirects";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose a password",
  robots: { index: false, follow: false },
};

const COPY: Record<PasswordPageMode, { eyebrow: string; title: string; description: string }> = {
  invite: {
    eyebrow: "Welcome",
    title: "Choose your password",
    description: `You’ve been invited to ${PLATFORM_NAME}. Choose the password you’ll use to log in from now on.`,
  },
  recovery: {
    eyebrow: "Reset password",
    title: "Choose a new password",
    description: "Choose a new password for your account. You’ll use it the next time you log in.",
  },
  change: {
    eyebrow: "Your account",
    title: "Change your password",
    description: "Choose a new password for your account. You’ll use it the next time you log in.",
  },
};

/** Why the user is here (invite / recovery / voluntary change) — only used to word the page. */
async function readPageMode(): Promise<PasswordPageMode> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    return passwordPageMode(data?.claims?.amr);
  } catch {
    return "change";
  }
}

function SignedInAs({ ctx, mode }: { ctx: SessionContext; mode: PasswordPageMode }) {
  return (
    <div className="grid gap-3 rounded-card border border-border bg-surface px-4 py-3.5 text-sm">
      <p className="text-fg-muted">
        Signed in as <span className="font-medium break-all text-fg">{ctx.email}</span>
      </p>
      <p className="flex items-start gap-2 text-fg-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-text" />
        <span>
          {mode === "invite" ? "Invited users choose their own password here." : "Only you know your password."}{" "}
          Administrators never see or set passwords.
        </span>
      </p>
    </div>
  );
}

/**
 * /reset-password: choose a new password with the session an invite or recovery link created (or while
 * signed in). Expired links never reach this page — /auth/confirm sends them to /login with an
 * explanation and a "Request a new link" action.
 */
export default async function ResetPasswordPage() {
  // Setup mode: the page renders (its action answers that the service is not configured yet).
  if (!isSupabaseConfigured()) {
    const copy = COPY.recovery;
    return (
      <div className="grid gap-8">
        <FormHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
        <ResetPasswordForm email="" />
      </div>
    );
  }

  const ctx = await getSessionContext();
  if (!ctx) redirect("/login?next=%2Freset-password");

  const mode = await readPageMode();
  const copy = COPY[mode];
  const home = homePathForRole(ctx.role);

  return (
    <div className="grid gap-8">
      <FormHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
      <SignedInAs ctx={ctx} mode={mode} />
      <ResetPasswordForm email={ctx.email} />
      <div className="grid gap-6">
        <FormDivider />
        {mode === "change" ? (
          <p className="text-center text-sm text-fg-muted">
            <Link href={home} className={FORM_LINK_CLASSES}>
              Cancel
            </Link>{" "}
            and keep your current password.
          </p>
        ) : (
          <p className="text-center text-sm text-fg-muted text-pretty">
            Not now?{" "}
            <Link href={home} className={FORM_LINK_CLASSES}>
              Continue without setting a password
            </Link>
            . You can set one later with “Forgot password?” on the log-in page.
          </p>
        )}
      </div>
    </div>
  );
}
