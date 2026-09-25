import { z } from "zod";
import { LANGUAGE_CODE_PATTERN } from "./fields";

/**
 * Provider identifiers end up in ElevenLabs URL paths (`/v1/text-to-speech/{voice_id}`), so they are
 * restricted to a safe character set rather than merely length-checked.
 */
export const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

function providerId(label: string) {
  return z
    .string({ error: `${label} is required.` })
    .trim()
    .regex(PROVIDER_ID_PATTERN, { error: `${label} is not a valid identifier.` });
}

/** POST /api/admin/announcements/[id]/generate */
export const generateAnnouncementRequestSchema = z.object({
  voiceId: providerId("Voice"),
  voiceName: z
    .string({ error: "Voice name must be text." })
    .trim()
    .max(200, { error: "Voice name must be at most 200 characters." })
    .optional(),
  modelId: providerId("Model"),
  languageCode: z
    .string({ error: "Language must be text." })
    .trim()
    .regex(LANGUAGE_CODE_PATTERN, { error: 'Use a language code such as "en" or "bg".' })
    .optional(),
  force: z.boolean({ error: "force must be true or false." }).optional(),
});
export type GenerateAnnouncementRequestInput = z.output<typeof generateAnnouncementRequestSchema>;
