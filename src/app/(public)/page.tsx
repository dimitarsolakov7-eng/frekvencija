import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AudienceRow } from "@/components/public/AudienceRow";
import { CtaBand } from "@/components/public/CtaBand";
import { Faq } from "@/components/public/Faq";
import { FeatureSection } from "@/components/public/FeatureSection";
import { GenreCollection } from "@/components/public/GenreCollection";
import { Hero } from "@/components/public/Hero";
import { HowItWorks } from "@/components/public/HowItWorks";
import { PLATFORM_NAME } from "@/config/platform";
import { loadPublicGenres } from "@/lib/data/public";
import { confirmForwardQuery } from "@/app/(auth)/_lib/confirm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: `${PLATFORM_NAME} — Radio for your business` },
  description:
    "Music for your atmosphere. A station with your name. Personalised radio for cafés, restaurants, hotels and bars.",
};

/**
 * The public homepage (screen 01), for everyone — signed-in users see it too, with a header link back
 * into their own area. Section order follows the approved design.
 */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  // An auth email template that points at the site root still works: its callback is forwarded to the
  // scanner-safe confirmation page.
  const forward = confirmForwardQuery(await searchParams);
  if (forward) redirect(`/auth/confirm?${forward}`);

  const { genres } = await loadPublicGenres();

  return (
    <>
      <Hero />
      <AudienceRow />
      <HowItWorks />
      <GenreCollection genres={genres} />
      <FeatureSection />
      <Faq />
      <CtaBand />
    </>
  );
}
