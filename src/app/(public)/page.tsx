import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AnnouncementShowcase } from "@/components/public/site/AnnouncementShowcase";
import { Benefits } from "@/components/public/site/Benefits";
import { FaqSection } from "@/components/public/site/FaqSection";
import { GenreList } from "@/components/public/site/GenreList";
import { Hero } from "@/components/public/site/Hero";
import { HowItWorks } from "@/components/public/site/HowItWorks";
import { Personalizer } from "@/components/public/site/Personalizer";
import { PhotoStrip } from "@/components/public/site/PhotoStrip";
import { PlansSection } from "@/components/public/site/PlansSection";
import { TrialSection } from "@/components/public/site/TrialSection";
import { VenueShowcase } from "@/components/public/site/VenueShowcase";
import { DEMO_AUDIO } from "@/config/demo-audio";
import { EXAMPLE_VENUE_NAME, VENUE_TYPE_KEYS, type VenueTypeKey } from "@/config/site";
import { getSiteCopy } from "@/content/site";
import { loadPublicGenres, loadPublicSettings } from "@/lib/data/public";
import { LOCALE_TAGS } from "@/lib/i18n/locale";
import { getLocale } from "@/lib/i18n/server";
import { confirmForwardQuery } from "@/app/(auth)/_lib/confirm";
import { requestTrial } from "./request-access/actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const copy = getSiteCopy(locale);
  return {
    title: { absolute: copy.meta.title },
    description: copy.meta.description,
    openGraph: { title: copy.meta.title, description: copy.meta.description, locale: LOCALE_TAGS[locale].openGraph },
    twitter: { title: copy.meta.title, description: copy.meta.description },
  };
}

/**
 * The public homepage, for everyone (signed-in users see it too, with a header link back into their
 * own area). Macedonian by default, English through the MK / EN switch. Section order: hero with the
 * radio console → photography → "how would your radio sound?" → benefits → venues → genres →
 * announcements → how it works → the trial request → plans → FAQ.
 */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  // An auth email template that points at the site root still works: its callback is forwarded to the
  // scanner-safe confirmation page.
  const forward = confirmForwardQuery(await searchParams);
  if (forward) redirect(`/auth/confirm?${forward}`);

  const [locale, { genres }, settings] = await Promise.all([getLocale(), loadPublicGenres(), loadPublicSettings()]);
  const copy = getSiteCopy(locale);
  const genreOptions = genres.map((genre) => ({ slug: genre.slug, name: genre.name }));
  const contactEmail = settings.status === "ok" ? settings.settings.contactEmail : null;
  const venueTypeNames = Object.fromEntries(VENUE_TYPE_KEYS.map((key) => [key, copy.venues.items[key].name])) as Record<VenueTypeKey, string>;
  const photoAlts = VENUE_TYPE_KEYS.map((key) => copy.venues.items[key].imageAlt);

  return (
    <>
      <Hero copy={copy} />
      <PhotoStrip copy={copy.hero} />
      <Personalizer
        copy={copy.personalizer}
        common={copy.common}
        venueTypes={venueTypeNames}
        exampleName={EXAMPLE_VENUE_NAME}
        clips={DEMO_AUDIO.announcements}
      />
      <Benefits copy={copy.benefits} photoAlts={photoAlts} />
      <VenueShowcase copy={copy.venues} availableGenres={genreOptions} />
      <GenreList copy={copy.genres} genres={genres} />
      <AnnouncementShowcase
        copy={copy.announcements}
        common={copy.common}
        personalizer={copy.personalizer}
        exampleName={EXAMPLE_VENUE_NAME}
        clips={DEMO_AUDIO.announcements}
      />
      <HowItWorks copy={copy.howItWorks} />
      <TrialSection copy={copy} locale={locale} action={requestTrial} genres={genreOptions} contactEmail={contactEmail} />
      <PlansSection copy={copy.plans} locale={locale} />
      <FaqSection copy={copy.faq} />
    </>
  );
}
