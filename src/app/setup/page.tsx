import type { Metadata } from "next";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { Alert, Badge, ButtonLink, type BadgeTone } from "@/components/ui";
import { PLATFORM_NAME } from "@/config/platform";
import { isSupabaseConfigured } from "@/lib/env";
import { AuthCard } from "@/app/(auth)/_components/AuthCard";
import { AuthShell } from "@/app/(auth)/_components/AuthShell";
import { describeSetupEnv, readSetupEnvSnapshot, type EnvVarCheck } from "./_lib/env-status";

export const metadata: Metadata = {
  title: "Setup",
  robots: { index: false, follow: false },
};

function statusBadge(check: EnvVarCheck): { tone: BadgeTone; label: string } {
  if (check.status === "set") return { tone: "success", label: "Set" };
  if (check.status === "invalid") return { tone: "danger", label: "Invalid" };
  if (check.need === "required") return { tone: "danger", label: "Missing" };
  if (check.need === "recommended") return { tone: "warning", label: "Not set" };
  return { tone: "neutral", label: "Not set" };
}

const NEED_LABEL: Record<EnvVarCheck["need"], string> = {
  required: "Required",
  recommended: "Recommended",
  optional: "Optional",
};

function Code({ children }: { children: string }) {
  return <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[0.85em] break-all text-fg">{children}</code>;
}

function EnvChecklist({ checks }: { checks: readonly EnvVarCheck[] }) {
  return (
    <section aria-labelledby="env-heading" className="grid gap-3">
      <h2 id="env-heading" className="text-lg font-semibold tracking-tight">
        Environment variables
      </h2>
      <ul className="grid gap-2">
        {checks.map((check) => {
          const badge = statusBadge(check);
          return (
            <li key={check.name} className="grid gap-1.5 rounded-control border border-border bg-surface-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Code>{check.name}</Code>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-fg-subtle">{NEED_LABEL[check.need]}</span>
                  <Badge tone={badge.tone} dot>
                    {badge.label}
                  </Badge>
                </span>
              </div>
              <p className="text-sm text-fg-muted text-pretty">{check.purpose}</p>
              {check.alternative && (
                <p className="text-sm text-fg-subtle">
                  Legacy alternative: <Code>{check.alternative}</Code>
                </p>
              )}
              {check.problem && <p className="text-sm text-danger">{check.problem}</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-fg-subtle">Only names and a status are shown here — never the values.</p>
    </section>
  );
}

function SetupSteps() {
  return (
    <section aria-labelledby="steps-heading" className="grid gap-3">
      <h2 id="steps-heading" className="text-lg font-semibold tracking-tight">
        What to do
      </h2>
      <p className="text-sm text-fg-muted">
        The full guide is <Code>docs/SETUP.md</Code> in the project folder. In short:
      </p>
      <ol className="grid list-decimal gap-2.5 pl-5 text-sm text-fg-muted marker:text-fg-subtle">
        <li>
          Create a Supabase project and copy its project URL, publishable key and secret key (“Create the Supabase
          project and keys” in the guide).
        </li>
        <li>
          Copy <Code>.env.example</Code> to <Code>.env.local</Code> in the project folder and fill in the variables
          marked above. The secret key stays on the server: never give it a <Code>NEXT_PUBLIC_</Code> prefix.
        </li>
        <li>
          Run the files in <Code>supabase/migrations/</Code> in order in the Supabase SQL Editor (“Apply the database
          migrations”).
        </li>
        <li>
          Configure Authentication: site and redirect URLs, turn off public sign-ups, and switch the invite and
          password-reset email templates to the <Code>token_hash</Code> links (“Configure Authentication”).
        </li>
        <li>
          Restart the app — <Code>npm run dev</Code> locally, or rebuild and restart in production. Public
          (<Code>NEXT_PUBLIC_</Code>) values are read when the app is built and started.
        </li>
        <li>
          Create the first administrator with <Code>npm run admin:create -- you@example.com</Code> (“Create the first
          administrator”), then sign in.
        </li>
      </ol>
    </section>
  );
}

/**
 * Shown instead of the app while Supabase is not configured (the proxy sends every app page here; the
 * public website and the auth forms still render and explain that the service is not configured).
 */
export default async function SetupPage() {
  // Read the environment per request, never at build time.
  await connection();
  const configured = isSupabaseConfigured();
  const snapshot = readSetupEnvSnapshot();
  const report = describeSetupEnv(snapshot);
  // Once configured, a production deployment doesn't list its environment to anonymous visitors.
  const showChecklist = !configured || snapshot.NODE_ENV !== "production";
  const missingRequired = report.blocking;

  return (
    <AuthShell width="lg">
      <AuthCard
        eyebrow="Setup"
        title={configured ? "Setup complete" : `Finish setting up ${PLATFORM_NAME}`}
        description={
          configured
            ? "Supabase is connected. Log in to continue."
            : `${PLATFORM_NAME} needs a Supabase project for sign-in, the database and file storage. Add the missing settings below, then restart the app.`
        }
      >
        {configured ? (
          <Alert
            tone="success"
            title="Supabase is configured"
            description="You can log in now."
            action={
              <ButtonLink href="/login" size="sm" iconRight={<ArrowRight aria-hidden="true" />}>
                Go to log in
              </ButtonLink>
            }
          />
        ) : (
          <Alert
            tone="warning"
            title="Supabase isn’t configured yet"
            description={
              missingRequired.length > 0 ? (
                <p>
                  Missing or invalid:{" "}
                  {missingRequired.map((name, index) => (
                    <span key={name}>
                      {index > 0 && ", "}
                      <Code>{name}</Code>
                    </span>
                  ))}
                  .
                </p>
              ) : (
                <p>The Supabase settings could not be read. Check the values in your environment file.</p>
              )
            }
          />
        )}
        {showChecklist && <EnvChecklist checks={report.checks} />}
        {!configured && <SetupSteps />}
      </AuthCard>
    </AuthShell>
  );
}
