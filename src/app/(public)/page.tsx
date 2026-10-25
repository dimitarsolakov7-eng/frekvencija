import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PHOTOS } from "@/assets/photos";
import { Announcements } from "@/components/public/site/Announcements";
import { Faq } from "@/components/public/site/Faq";
import { Features } from "@/components/public/site/Features";
import { GenreMarquee } from "@/components/public/site/GenreMarquee";
import { Hero } from "@/components/public/site/Hero";
import { HowItWorks } from "@/components/public/site/HowItWorks";
import { Intro } from "@/components/public/site/Intro";
import { Manifesto } from "@/components/public/site/Manifesto";
import { Plans } from "@/components/public/site/Plans";
import { Stats } from "@/components/public/site/Stats";
import { TrialSection } from "@/components/public/site/TrialSection";
import { Venues } from "@/components/public/site/Venues";
import { EXAMPLE_VENUE_NAME, headlineVenues, SITE_STATS } from "@/config/site";
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
 * The public homepage (v3, docs/WEBSITE.md), for everyone — signed-in users see it too, with a header link
 * back into their own area. Macedonian by default, English through the MK / EN switch. A scroll story in
 * chapters: hero → genres → (01) manifesto → (02) numbers → (03) how it works → (04) features →
 * (05) venues → (06) announcements → (07) plans → (08) FAQ → (09) the free trial.
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

  return (
    <>
      <Intro label={copy.intro.tuning} />
      <Hero copy={copy} venuesOnAir={headlineVenues()} />
      <GenreMarquee
        genres={genres.map((genre) => genre.name)}
        label={copy.marquee.label}
        pauseLabel={copy.common.pauseMotion}
        playLabel={copy.common.playMotion}
      />
      <Manifesto copy={copy.manifesto} photoAlt={copy.manifesto.photoAlt} />
      <Stats copy={copy.stats} stats={SITE_STATS} locale={locale} photoAlt={copy.stats.photoAlt} />
      <HowItWorks copy={copy.howItWorks} photos={[PHOTOS.cafeRoom, PHOTOS.lounge, PHOTOS.counter, PHOTOS.friends]} />
      <Features copy={copy.features} />
      <Venues copy={copy.venues} genres={genreOptions} />
      <Announcements copy={copy.announcements} quotes={copy.common.quotes} exampleName={EXAMPLE_VENUE_NAME} />
      <Plans copy={copy.plans} locale={locale} photoAlt={copy.plans.photoAlt} />
      <Faq copy={copy.faq} />
      <TrialSection copy={copy} locale={locale} action={requestTrial} genres={genreOptions} contactEmail={contactEmail} />
    </>
  );
}
