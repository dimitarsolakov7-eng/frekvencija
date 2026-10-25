import type { Viewport } from "next";
import { accountLinkFor } from "@/components/public/site/account-link";
import { MotionProvider } from "@/components/public/site/motion/MotionProvider";
import { SiteFooter } from "@/components/public/site/SiteFooter";
import { SiteHeader } from "@/components/public/site/SiteHeader";
import { SkipLink } from "@/components/ui";
import { getSiteCopy } from "@/content/site";
import { getPublicViewer, loadPublicSettings } from "@/lib/data/public";
import { LOCALE_TAGS } from "@/lib/i18n/locale";
import { getLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";
import { display, serif } from "./_lib/fonts";

// The header adapts to the visitor's session and language on every request.
export const dynamic = "force-dynamic";

/** The public website is dark: warm near-black, ivory type, a vermillion signal colour. */
export const viewport: Viewport = {
  themeColor: "#0c0a09",
  colorScheme: "dark",
  viewportFit: "cover",
};

/**
 * Public website shell (homepage, trial request, privacy, terms): the night theme scope, skip link,
 * fixed header, main landmark, footer, and the motion layer (smooth scrolling and GSAP; see
 * src/components/public/site/motion). Renders without Supabase (setup mode) — the visitor then simply
 * counts as signed out and the owner's contact details are absent.
 */
export default async function PublicLayout({ children }: LayoutProps<"/">) {
  const [viewer, locale, settings] = await Promise.all([getPublicViewer(), getLocale(), loadPublicSettings()]);
  const copy = getSiteCopy(locale);
  const account = accountLinkFor(viewer?.role ?? null, copy.nav);
  const contactEmail = settings.status === "ok" ? settings.settings.contactEmail : null;

  return (
    <div
      lang={LOCALE_TAGS[locale].html}
      className={cn("theme-night flex min-h-dvh flex-1 flex-col bg-canvas font-sans text-fg antialiased", display.variable, serif.variable)}
    >
      <SkipLink>{copy.common.skipToContent}</SkipLink>
      <MotionProvider>
        <SiteHeader locale={locale} nav={copy.nav} common={copy.common} account={account} signedIn={viewer !== null} />
        <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
          {children}
        </main>
        <SiteFooter locale={locale} copy={copy} account={account} contactEmail={contactEmail} />
      </MotionProvider>
    </div>
  );
}
