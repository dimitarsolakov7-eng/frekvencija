import { Cormorant_Garamond, Sofia_Sans_Extra_Condensed } from "next/font/google";

/**
 * Faces of the public website, both with Latin and Macedonian Cyrillic, self-hosted by next/font at build
 * time and scoped to the public layout through their CSS variables (the app keeps Inter only):
 * - Sofia Sans Extra Condensed (variable weight) for the large uppercase display type;
 * - Cormorant Garamond italic for quotes and highlighted words.
 * Kept in their own module so tests can replace them.
 */
export const display = Sofia_Sans_Extra_Condensed({
  variable: "--font-sofia",
  subsets: ["latin", "latin-ext", "cyrillic"],
  display: "swap",
});

export const serif = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin", "latin-ext", "cyrillic"],
  style: ["italic"],
  weight: ["500", "600"],
  display: "swap",
});
