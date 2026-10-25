/**
 * Shared, client-safe definitions of the public "Request a 3-day free trial" form: field limits (the
 * same as the `access_requests` column checks), the hidden anti-spam field, the echoed values and the
 * "I need a recommendation" genre choice. Validation lives in src/app/(public)/_lib/trial-schema.ts.
 */
export { BUSINESS_TYPE_VALUES } from "./business-types";

/** Length limits, identical to the `access_requests` column checks. */
export const TRIAL_REQUEST_LIMITS = {
  venueName: 120,
  city: 120,
  contactName: 120,
  email: 254,
  phone: 40,
  message: 1000,
  preferredGenre: 80,
} as const;

/**
 * Hidden anti-spam field: people never see or fill it, simple bots do. A filled value is answered like a
 * normal submission but nothing is stored. The name avoids anything browsers autofill.
 */
export const HONEYPOT_FIELD = "frk_hp";

/** Option value (and stored `preferred_genre`) for "I need a recommendation". */
export const GENRE_RECOMMENDATION = "recommendation";

/** Form values echoed back after a failed submission (React resets uncontrolled fields after an action). */
export type TrialRequestValues = {
  venueName: string;
  venueType: string;
  city: string;
  contactName: string;
  email: string;
  phone: string;
  preferredGenre: string;
  message: string;
};

export const EMPTY_TRIAL_REQUEST_VALUES: TrialRequestValues = Object.freeze({
  venueName: "",
  venueType: "",
  city: "",
  contactName: "",
  email: "",
  phone: "",
  preferredGenre: "",
  message: "",
});

/** A genre option of the form: a catalogue genre (by slug) shown with its name. */
export interface GenreOption {
  slug: string;
  name: string;
}
