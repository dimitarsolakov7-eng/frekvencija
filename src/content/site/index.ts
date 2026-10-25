import type { Locale } from "@/lib/i18n/locale";
import { EN } from "./en";
import { MK } from "./mk";
import type { SiteCopy } from "./types";

export type {
  AnnouncementExampleCopy,
  AnnouncementExampleKey,
  FeatureKey,
  SiteCopy,
  TrialFormCopy,
  TrialFormMessages,
} from "./types";

const COPY: Record<Locale, SiteCopy> = { mk: MK, en: EN };

/** The public website's copy in one language. */
export function getSiteCopy(locale: Locale): SiteCopy {
  return COPY[locale];
}

/** Splits manifesto text on `*phrase*` markers into plain and highlighted runs. */
export function highlightRuns(text: string): { text: string; highlight: boolean }[] {
  return text
    .split("*")
    .map((part, index) => ({ text: part, highlight: index % 2 === 1 }))
    .filter((run) => run.text !== "");
}
