/**
 * Shape of the public website's copy (v3). Both languages (mk.ts, en.ts) must provide every key, which
 * TypeScript enforces. Everything is plain data (strings, arrays, records) so it can be passed from
 * Server Components to Client Components. `{name}`-style placeholders are filled with `fill()` from
 * `@/lib/i18n/locale`; in the manifesto, `*words*` mark the highlighted phrases.
 */
import type { Locale } from "@/lib/i18n/locale";
import type { StatKey, VenueTypeKey } from "@/config/site";

export type AnnouncementExampleKey = "identity" | "offer" | "event";

export interface AnnouncementExampleCopy {
  key: AnnouncementExampleKey;
  label: string;
  /** Uses `{name}` for the venue name. */
  text: string;
}

export type FeatureKey = "name" | "noAds" | "offers" | "hours" | "browser" | "staff";

export interface TrialFormCopy {
  venueName: string;
  venueNamePlaceholder: string;
  venueType: string;
  venueTypePlaceholder: string;
  city: string;
  cityPlaceholder: string;
  contactName: string;
  email: string;
  emailPlaceholder: string;
  phone: string;
  preferredGenre: string;
  preferredGenrePlaceholder: string;
  recommendationOption: string;
  message: string;
  messageHint: string;
  optional: string;
  submit: string;
  submitting: string;
  honeypotLabel: string;
  /** Short privacy acknowledgement under the button; `{privacy}` marks the link text. */
  privacyNote: string;
  privacyLinkLabel: string;
  /** Singular venue type names for the select. */
  venueTypes: Record<VenueTypeKey, string>;
  /** Name of the "other" venue type option. */
  otherType: string;
}

export interface TrialFormMessages {
  checkFields: string;
  venueNameRequired: string;
  venueTypeRequired: string;
  cityRequired: string;
  contactNameRequired: string;
  emailInvalid: string;
  phoneInvalid: string;
  genreRequired: string;
  /** `{max}` = the character limit. */
  tooLong: string;
  notConfigured: string;
  unavailable: string;
  tooManyFromNetwork: string;
  tooManyForEmail: string;
  tooManyOverall: string;
  sent: string;
  duplicate: string;
}

export interface SiteCopy {
  locale: Locale;
  meta: {
    title: string;
    description: string;
    trialPageTitle: string;
    trialPageDescription: string;
    privacyTitle: string;
    termsTitle: string;
  };
  common: {
    skipToContent: string;
    brandHome: string;
    menuTitle: string;
    openMenu: string;
    closeMenu: string;
    languageSwitch: string;
    /** `{language}` = the language being switched to. */
    switchTo: string;
    scrollCue: string;
    pauseMotion: string;
    playMotion: string;
    exampleBadge: string;
    /** Quotation marks of the language („ “ in Macedonian, “ ” in English). */
    quotes: { open: string; close: string };
  };
  nav: {
    howItWorks: string;
    features: string;
    venues: string;
    plans: string;
    faq: string;
    logIn: string;
    openRadio: string;
    adminWorkspace: string;
    trialCta: string;
    trialCtaShort: string;
  };
  intro: {
    tuning: string;
  };
  hero: {
    /** The short line with the live dot above the headline. */
    eyebrow: string;
    titleLines: readonly [string, string, string];
    lead: string;
    primaryCta: string;
    secondaryCta: string;
    card: { label: string; station: string; genre: string; time: string; quote: string };
  };
  marquee: {
    label: string;
  };
  manifesto: {
    label: string;
    /** `*phrase*` marks a highlighted phrase. */
    text: string;
    photoAlt: string;
  };
  stats: {
    label: string;
    title: string;
    items: Record<StatKey, string>;
    photoAlt: string;
  };
  howItWorks: {
    label: string;
    title: string;
    steps: readonly { title: string; body: string }[];
    note: string;
    progress: string;
  };
  features: {
    label: string;
    title: string;
    items: Record<FeatureKey, { title: string; body: string }>;
    nameQuote: { lead: string; tail: string };
    adsCaption: string;
    offerChip: string;
    hours: readonly { time: string; genre: string }[];
    devices: string;
  };
  venues: {
    label: string;
    title: string;
    lead: string;
    recommendedLabel: string;
    items: Record<VenueTypeKey, { name: string; moment: string; body: string; imageAlt: string }>;
  };
  announcements: {
    label: string;
    title: string;
    lead: string;
    inputLabel: string;
    inputPlaceholder: string;
    previewLabel: string;
    note: string;
    examples: readonly AnnouncementExampleCopy[];
    timelineLabel: string;
    music: string;
    voice: string;
  };
  plans: {
    label: string;
    title: string;
    lead: string;
    unpublishedTitle: string;
    unpublishedLead: string;
    requestPricing: string;
    perMonth: string;
    vatNote: string;
    includesTitle: string;
    includes: readonly string[];
    choose: string;
    photoAlt: string;
  };
  faq: {
    label: string;
    title: string;
    items: readonly { question: string; answer: string }[];
  };
  trial: {
    label: string;
    title: string;
    lead: string;
    activationNote: string;
    form: TrialFormCopy;
    messages: TrialFormMessages;
    successTitle: string;
    successBody: string;
    duplicateTitle: string;
    duplicateBody: string;
    nextStepsTitle: string;
    nextSteps: readonly string[];
    /** `{email}` = the owner's contact address. */
    questions: string;
    backHome: string;
    sendAnother: string;
  };
  footer: {
    ctaTitle: string;
    ctaButton: string;
    tagline: string;
    siteLabel: string;
    legalLabel: string;
    contactLabel: string;
    contactCta: string;
    privacy: string;
    terms: string;
    /** `{year}` = the current year. */
    rights: string;
    credits: string;
  };
  policy: {
    eyebrow: string;
    privacyTitle: string;
    termsTitle: string;
    privacyNoun: string;
    termsNoun: string;
    notPublishedTitle: string;
    /** `{noun}` = "privacy policy" / "terms of service". */
    notPublishedBody: string;
    unavailableTitle: string;
    unavailableBody: string;
    /** `{noun}` = "privacy policy" / "terms of service". */
    questions: string;
    contactUs: string;
    /** `{email}` = the owner's address. */
    emailUs: string;
  };
  trialPage: {
    eyebrow: string;
    title: string;
    lead: string;
    alreadyHaveAccount: string;
    logIn: string;
  };
}
