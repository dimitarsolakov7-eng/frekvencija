import type { Metadata } from "next";
import Link from "next/link";
import { TEXT_LINK_CLASSES } from "@/components/public/site/layout";
import { TrialSection } from "@/components/public/site/TrialSection";
import { getSiteCopy } from "@/content/site";
import { loadPublicGenres, loadPublicSettings } from "@/lib/data/public";
import { getLocale } from "@/lib/i18n/server";
import { requestTrial } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = getSiteCopy(await getLocale());
  return { title: copy.meta.trialPageTitle, description: copy.meta.trialPageDescription };
}

/**
 * /request-access — the free-trial request on its own page (a stable link for emails and the sign-in
 * page). Same form and server action as the homepage section; submissions land in the owner's
 * access-request list and nothing is activated automatically.
 */
export default async function RequestAccessPage() {
  const [locale, { genres }, settings] = await Promise.all([getLocale(), loadPublicGenres(), loadPublicSettings()]);
  const copy = getSiteCopy(locale);
  const contactEmail = settings.status === "ok" ? settings.settings.contactEmail : null;

  return (
    <TrialSection
      copy={copy}
      locale={locale}
      action={requestTrial}
      genres={genres.map((genre) => ({ slug: genre.slug, name: genre.name }))}
      contactEmail={contactEmail}
      heading={{ eyebrow: copy.trialPage.eyebrow, title: copy.trialPage.title, lead: copy.trialPage.lead, as: "h1" }}
      aside={
        <p className="text-base text-fg-muted">
          {copy.trialPage.alreadyHaveAccount}{" "}
          <Link href="/login" className={TEXT_LINK_CLASSES}>
            {copy.trialPage.logIn}
          </Link>
        </p>
      }
    />
  );
}
