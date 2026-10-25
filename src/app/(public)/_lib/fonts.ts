import { Playfair_Display } from "next/font/google";

/**
 * Editorial display face of the public website, with Latin and Macedonian Cyrillic. Self-hosted by
 * next/font at build time and scoped to the public layout through its CSS variable (the app keeps
 * Inter only). Kept in its own module so tests can replace it.
 */
export const display = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin", "latin-ext", "cyrillic"],
  display: "swap",
});
