/**
 * Platform-wide branding and tuning constants.
 *
 * The platform is branded "Frekvencija" (frekvencija.online). Change it here (or set
 * NEXT_PUBLIC_PLATFORM_NAME) and every page picks it up.
 */
export const PLATFORM_NAME =
  process.env.NEXT_PUBLIC_PLATFORM_NAME?.trim() || "Frekvencija";

export const PLATFORM_TAGLINE = "Your place. Your sound. Your radio.";

/** Public domain of the platform (marketing site, footer, emails). */
export const PLATFORM_DOMAIN = "frekvencija.online";

/** Gain applied to music relative to the listener's master volume (leaves headroom for voice). */
export const MUSIC_GAIN = 0.85;

/** Default number of completed tracks between station announcements. */
export const DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS = 4;
