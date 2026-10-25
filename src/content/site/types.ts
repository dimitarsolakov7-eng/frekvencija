/**
 * Shape of the public website's copy. Both languages (mk.ts, en.ts) must provide every key, which
 * TypeScript enforces. Everything is plain data (strings, arrays, records) so it can be passed from
 * Server Components to Client Components; `{name}` placeholders are filled with `fill()` from
 * `@/lib/i18n/locale`.
 */
import type { Locale } from "@/lib/i18n/locale";
import type { VenueTypeKey } from "@/config/site";

export type AnnouncementExampleKey = "identity" | "offer" | "event";

export interface AnnouncementExampleCopy {
  key: AnnouncementExampleKey;
  label: string;
  /** Uses `{name}` for the venue name. */
  text: string;
}

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
    exampleBadge: string;
    illustrativeNote: string;
    closeMenu: string;
    openMenu: string;
    menuTitle: string;
    languageSwitch: string;
    /** `{language}` = the language being switched to. */
    switchTo: string;
  };
  nav: {
    howItWorks: string;
    listen: string;
    venues: string;
    plans: string;
    faq: string;
    logIn: string;
    openRadio: string;
    adminWorkspace: string;
    trialCta: string;
    trialCtaShort: string;
  };
  hero: {
    eyebrow: string;
    titleLines: readonly [string, string];
    lead: string;
    primaryCta: string;
    secondaryCta: string;
    photoAlt: readonly string[];
  };
  console: {
    eyebrow: string;
    stationName: string;
    genreLabel: string;
    genre: string;
    play: string;
    pause: string;
    loading: string;
    volume: string;
    sampleAnnouncement: string;
    stopSample: string;
    statusReady: string;
    statusPlaying: string;
    statusPaused: string;
    statusLoading: string;
    unavailableTitle: string;
    unavailableBody: string;
    errorBody: string;
    retry: string;
  };
  personalizer: {
    eyebrow: string;
    title: string;
    lead: string;
    venueNameLabel: string;
    venueNamePlaceholder: string;
    venueTypeLabel: string;
    previewLabel: string;
    emptyName: string;
    note: string;
    examplesTitle: string;
    examples: readonly AnnouncementExampleCopy[];
    playExample: string;
    exampleUnavailable: string;
  };
  benefits: {
    eyebrow: string;
    statement: string;
    items: readonly { title: string; body: string }[];
  };
  venues: {
    eyebrow: string;
    title: string;
    lead: string;
    selectorLabel: string;
    momentLabel: string;
    recommendedLabel: string;
    noRecommendation: string;
    items: Record<VenueTypeKey, { name: string; moment: string; body: string; imageAlt: string }>;
  };
  howItWorks: {
    eyebrow: string;
    title: string;
    steps: readonly { title: string; body: string }[];
    note: string;
  };
  genres: {
    eyebrow: string;
    title: string;
    lead: string;
    /** `{genre}` = the genre name. */
    preview: string;
    sourceNote: string;
    descriptions: Record<string, string>;
    fallbackDescription: string;
  };
  announcements: {
    eyebrow: string;
    titleLines: readonly [string, string];
    lead: string;
    sequenceLabel: string;
    sequence: readonly { label: string; kind: "music" | "voice" }[];
    examplesLabel: string;
    examples: readonly AnnouncementExampleCopy[];
    frequencyNote: string;
    privacyNote: string;
  };
  trial: {
    eyebrow: string;
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
  plans: {
    eyebrow: string;
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
  };
  faq: {
    eyebrow: string;
    title: string;
    items: readonly { question: string; answer: string }[];
  };
  footer: {
    tagline: string;
    navLabel: string;
    siteLabel: string;
    legalLabel: string;
    contactLabel: string;
    contactCta: string;
    privacy: string;
    terms: string;
    /** `{year}` = the current year. */
    rights: string;
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
