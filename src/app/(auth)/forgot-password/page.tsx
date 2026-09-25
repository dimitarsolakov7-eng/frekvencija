import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FORM_LINK_CLASSES, FormDivider, FormHeading } from "@/components/public/FormHeading";
import { getPublicViewer } from "@/lib/data/public";
import { homePathForRole } from "../_lib/redirects";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

// Reads the session: a signed-in visitor goes to their own area (they change a password from there).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Forgot password",
};

export default async function ForgotPasswordPage() {
  const viewer = await getPublicViewer();
  if (viewer) redirect(homePathForRole(viewer.role));

  return (
    <div className="grid gap-8">
      <FormHeading
        eyebrow="Account help"
        title="Forgot your password?"
        description="Enter your email address and we’ll send you a link to choose a new password. For your security, the link works only once and expires after about an hour."
      />
      <ForgotPasswordForm />
      <div className="grid gap-6">
        <FormDivider />
        <p className="text-center text-sm">
          <Link href="/login" className={`inline-flex items-center gap-1.5 ${FORM_LINK_CLASSES}`}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}
