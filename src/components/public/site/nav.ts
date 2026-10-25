import { SECTION_IDS, type SectionId } from "@/config/site";
import type { SiteCopy } from "@/content/site/types";

export interface SiteNavLink {
  id: SectionId;
  label: string;
}

/** The homepage sections linked from the header, the menu and the footer, in order. */
export function siteNavLinks(nav: SiteCopy["nav"]): SiteNavLink[] {
  return [
    { id: SECTION_IDS.howItWorks, label: nav.howItWorks },
    { id: SECTION_IDS.features, label: nav.features },
    { id: SECTION_IDS.venues, label: nav.venues },
    { id: SECTION_IDS.plans, label: nav.plans },
    { id: SECTION_IDS.faq, label: nav.faq },
  ];
}
