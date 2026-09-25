import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/config/platform";
import { resolveSiteOrigin } from "@/lib/utils/site-url";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-dvh flex-col bg-canvas font-sans text-fg antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
