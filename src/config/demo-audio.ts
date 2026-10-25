/**
 * Demo audio for the public website. Nothing here is generated or faked: a clip is played only when a
 * real file is configured. Until then the radio console shows an honest "demo coming soon" state and
 * the announcement examples are text only.
 *
 * To add a demo, put the files under public/demo/ (MP3 recommended) and fill in the entries, e.g.
 *   station: { src: "/demo/emeraldcaffe-sample.mp3", durationSeconds: 42 }
 * The announcement samples are prerecorded for the example venue; changing the venue name on the
 * website only changes the text preview, never the recorded voice.
 */
import type { AnnouncementExampleKey } from "@/content/site/types";

export interface DemoClip {
  /** Public URL (same-origin path under /public, or an absolute https URL). */
  src: string;
  durationSeconds?: number;
}

export interface DemoAudioConfig {
  /** The hero console's sample: music with the example station's announcement. */
  station: DemoClip | null;
  /** Prerecorded example announcements for the example venue. */
  announcements: Record<AnnouncementExampleKey, DemoClip | null>;
  /** Optional short music previews per genre slug, offered in the genre list. */
  genrePreviews: Record<string, DemoClip>;
}

export const DEMO_AUDIO: DemoAudioConfig = {
  station: null,
  announcements: { identity: null, offer: null, event: null },
  genrePreviews: {},
};

export function hasDemoAudio(config: DemoAudioConfig = DEMO_AUDIO): boolean {
  return config.station !== null;
}
