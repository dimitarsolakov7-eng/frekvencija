import type { Metadata } from "next";
import { PolicyPage } from "@/components/public/PolicyPage";
import { loadPublicSettings } from "@/lib/data/public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy policy",
};

/** Owner-supplied privacy policy (Admin → Settings), or an honest "not published yet" state. */
export default async function PrivacyPage() {
  const result = await loadPublicSettings();
  return <PolicyPage title="Privacy policy" noun="privacy policy" kind="privacyPolicy" result={result} />;
}
