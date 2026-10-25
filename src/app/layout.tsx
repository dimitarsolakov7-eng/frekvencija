import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { MOTION_BOOT_SCRIPT } from "@/components/public/site/motion/boot";
import { ToastProvider } from "@/components/ui/Toast";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/config/platform";
import { LOCALE_TAGS } from "@/lib/i18n/locale";
import { getLocale } from "@/lib/i18n/server";
import { resolveSiteOrigin } from "@/lib/utils/site-url";
import "./globals.css";

// Cyrillic for the Macedonian public website; the app itself is English.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext", "cyrillic"],
  display: "swap",
});

const DESCRIPTION = "Music for your atmosphere. A station with your name.";

export const metadata: Metadata = {
  // Absolute base for Open Graph/Twitter image URLs (src/app/opengraph-image.png) and canonical links.
  metadataBase: new URL(resolveSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL)),
  title: {
    template: `%s · ${PLATFORM_NAME}`,
    default: `${PLATFORM_NAME} · ${PLATFORM_TAGLINE}`,
  },
  description: DESCRIPTION,
  applicationName: PLATFORM_NAME,
  openGraph: {
    type: "website",
    siteName: PLATFORM_NAME,
    title: `${PLATFORM_NAME} · ${PLATFORM_TAGLINE}`,
    description: DESCRIPTION,
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: `${PLATFORM_NAME} · ${PLATFORM_TAGLINE}`,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1110",
  colorScheme: "dark",
  // Lets the app shell paint under the notch / home indicator; shells pad with env(safe-area-inset-*).
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The public website is Macedonian by default (MK / EN switch); the app pages are English, but
  // their <html lang> follows the visitor's choice too, so a Macedonian visitor's browser tools agree.
  const locale = await getLocale();
  return (
    // suppressHydrationWarning: the motion boot script adds classes to <html> before React hydrates.
    <html lang={LOCALE_TAGS[locale].html} className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Public website motion: hides elements before their entrance, decides on the intro (boot.ts). */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-canvas font-sans text-fg antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
