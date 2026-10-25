import type { Metadata } from "next";
import { PolicyPage } from "@/components/public/PolicyPage";
import { getSiteCopy } from "@/content/site";
import { loadPublicSettings } from "@/lib/data/public";
import { getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getSiteCopy(await getLocale()).meta.privacyTitle };
}

/** Owner-supplied privacy policy (Admin → Settings), or an honest "not published yet" state. */
export default async function PrivacyPage() {
  const [locale, result] = await Promise.all([getLocale(), loadPublicSettings()]);
  return <PolicyPage copy={getSiteCopy(locale).policy} kind="privacyPolicy" result={result} />;
}
