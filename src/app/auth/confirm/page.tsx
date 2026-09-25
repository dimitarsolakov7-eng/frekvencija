import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { FORM_LINK_CLASSES, FormDivider, FormHeading } from "@/components/public/FormHeading";
import { ButtonLink, SubmitButton } from "@/components/ui";
import { describeAuthLinkError, type AuthNotice } from "@/app/(auth)/_lib/auth-errors";
import { describeConfirmPurpose, parseConfirmParams } from "@/app/(auth)/_lib/confirm";
import { confirmEmailLink } from "./actions";

// One-time tokens arrive in the query string: never prerender or cache this page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Continue",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const INVALID_LINK: AuthNotice = describeAuthLinkError("link_invalid") ?? {
  code: "link_invalid",
  title: "This link is incomplete",
  message: "Ask your administrator for a new invite, or use Forgot password.",
};

/** Broken or expired link: explain, and offer the recovery path (a new link) plus log in. */
function LinkProblem({ notice }: { notice: AuthNotice }) {
  return (
    <div className="grid gap-8">
      <FormHeading eyebrow="Email link" title={notice.title} description={notice.message} />
      <div className="grid gap-3">
        <ButtonLink href="/forgot-password" size="lg" fullWidth icon={<KeyRound aria-hidden="true" />}>
          Request a new link
        </ButtonLink>
        <ButtonLink href="/login" size="lg" fullWidth variant="secondary" icon={<LogIn aria-hidden="true" />}>
          Go to log in
        </ButtonLink>
      </div>
    </div>
  );
}

/**
 * Landing page for email links. It deliberately does NOT verify on page load: corporate link
 * scanners (e.g. Microsoft Defender Safe Links) open links in advance and would use up the one-time
 * token. The token is only consumed by the Server Action behind the Continue button.
 */
export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const request = parseConfirmParams(await searchParams);

  if (request.kind === "error") {
    return <LinkProblem notice={describeAuthLinkError(request.errorCode) ?? INVALID_LINK} />;
  }
  if (request.kind === "invalid") {
    return <LinkProblem notice={INVALID_LINK} />;
  }

  const purpose = describeConfirmPurpose(request);
  return (
    <div className="grid gap-8">
      <FormHeading eyebrow="Email link" title={purpose.title} description={purpose.description} />
      <form action={confirmEmailLink} className="grid gap-4">
        {request.kind === "otp" ? (
          <>
            <input type="hidden" name="token_hash" value={request.tokenHash} />
            <input type="hidden" name="type" value={request.type} />
            <input type="hidden" name="next" value={request.next} />
          </>
        ) : (
          <>
            <input type="hidden" name="code" value={request.code} />
            {request.flowId && <input type="hidden" name="sb_flow_id" value={request.flowId} />}
            {request.next && <input type="hidden" name="next" value={request.next} />}
          </>
        )}
        <SubmitButton size="lg" fullWidth pendingLabel="Checking your link…" iconRight={<ArrowRight aria-hidden="true" />}>
          {purpose.buttonLabel}
        </SubmitButton>
      </form>
      <div className="grid gap-3 rounded-card border border-border bg-surface px-4 py-3.5 text-sm text-fg-muted">
        <p className="flex items-start gap-2">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-text" />
          <span>
            <span className="font-medium text-fg">Why the extra click?</span> Some email security scanners open links
            automatically to check them. Opening this page doesn’t use up your one-time link — only pressing{" "}
            {purpose.buttonLabel} does — so a scanner can’t spend it before you do.
          </span>
        </p>
      </div>
      <div className="grid gap-6">
        <FormDivider />
        <p className="text-center text-sm text-fg-muted text-pretty">
          Link no longer working?{" "}
          <Link href="/forgot-password" className={FORM_LINK_CLASSES}>
            Request a new link
          </Link>
        </p>
      </div>
    </div>
  );
}
