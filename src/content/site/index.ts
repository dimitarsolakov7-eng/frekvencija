import type { Locale } from "@/lib/i18n/locale";
import { EN } from "./en";
import { MK } from "./mk";
import type { SiteCopy } from "./types";

export type { AnnouncementExampleCopy, AnnouncementExampleKey, SiteCopy, TrialFormCopy, TrialFormMessages } from "./types";

const COPY: Record<Locale, SiteCopy> = { mk: MK, en: EN };

/** The public website's copy in one language. */
export function getSiteCopy(locale: Locale): SiteCopy {
  return COPY[locale];
}
