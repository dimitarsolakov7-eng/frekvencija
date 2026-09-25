import type { Metadata } from "next";
import { PolicyPage } from "@/components/public/PolicyPage";
import { loadPublicSettings } from "@/lib/data/public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of service",
};

/** Owner-supplied terms of service (Admin → Settings), or an honest "not published yet" state. */
export default async function TermsPage() {
  const result = await loadPublicSettings();
  return <PolicyPage title="Terms of service" noun="terms of service" plural kind="termsOfService" result={result} />;
}
