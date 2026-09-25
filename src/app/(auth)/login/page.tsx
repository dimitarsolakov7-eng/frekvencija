import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { FORM_LINK_CLASSES, FormDivider, FormHeading } from "@/components/public/FormHeading";
import { Alert, ButtonLink } from "@/components/ui";
import { safeNextPath } from "@/lib/auth/redirects";
import { getPublicViewer } from "@/lib/data/public";
import { describeAuthLinkError, type AuthLinkErrorCode } from "../_lib/auth-errors";
import { resolvePostLoginPath } from "../_lib/redirects";
import { LoginForm } from "./LoginForm";

// Reads the session: a signed-in visitor goes straight to their own area.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Log in",
};

/** Link problems that a fresh email link fixes: offer the way to request one. */
const NEW_LINK_HELPS: ReadonlySet<AuthLinkErrorCode> = new Set([
  "otp_expired",
  "link_invalid",
  "link_other_browser",
  "verify_failed",
]);

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;

  // The proxy only knows that someone is signed in; the role decides where "home" is.
  const viewer = await getPublicViewer();
  if (viewer) redirect(resolvePostLoginPath(params.next, viewer.role));

  const next = safeNextPath(params.next, "");
  const notice = describeAuthLinkError(params.error);

  return (
    <div className="grid gap-8">
      <FormHeading
        eyebrow="Welcome back"
        title="Log in to your station"
        description="Use the account provided for your business."
      />
      {notice && (
        <Alert
          tone="warning"
          title={notice.title}
          description={notice.message}
          action={
            NEW_LINK_HELPS.has(notice.code) ? (
              <ButtonLink href="/forgot-password" size="sm" variant="secondary" icon={<KeyRound aria-hidden="true" />}>
                Request a new link
              </ButtonLink>
            ) : undefined
          }
        />
      )}
      <LoginForm next={next} />
      <div className="grid gap-6">
        <FormDivider />
        <p className="text-center text-sm text-fg-muted">
          Need an account?{" "}
          <Link href="/request-access" className={FORM_LINK_CLASSES}>
            Request access
          </Link>
        </p>
      </div>
    </div>
  );
}
