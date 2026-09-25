import { z } from "zod";
import { languageCodeSchema, nullableText, requiredText } from "./fields";

export const ANNOUNCEMENT_PLACEMENTS = ["welcome", "rotation", "both"] as const;
export const TEMPLATE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const placementSchema = z.enum(ANNOUNCEMENT_PLACEMENTS, { error: "Choose welcome, rotation or both." });

/** Template key from ANNOUNCEMENT_TEMPLATES, or null (blank) for custom wording. */
const templateKeySchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() || null : value),
  z
    .string({ error: "Template must be text." })
    .regex(TEMPLATE_KEY_PATTERN, { error: "Unknown template." })
    .nullable(),
);

const announcementFields = {
  templateKey: templateKeySchema,
  placement: placementSchema,
  /** Display wording with the real names (1–500). */
  text: requiredText("Announcement text", 500),
  /** Wording sent to TTS; blank ⇒ null ⇒ use `text`. */
  spokenText: nullableText("Spoken wording", 1000),
  language: languageCodeSchema,
};

export const announcementCreateSchema = z.object({
  templateKey: announcementFields.templateKey.default(null),
  placement: announcementFields.placement.default("rotation"),
  text: announcementFields.text,
  spokenText: announcementFields.spokenText.default(null),
  /** Omitted ⇒ the action uses the business's announcement language. */
  language: announcementFields.language.optional(),
});
export type AnnouncementCreateInput = z.output<typeof announcementCreateSchema>;

/** Update: omitted fields are unchanged. */
export const announcementUpdateSchema = z.object({
  templateKey: announcementFields.templateKey.optional(),
  placement: announcementFields.placement.optional(),
  text: announcementFields.text.optional(),
  spokenText: announcementFields.spokenText.optional(),
  language: announcementFields.language.optional(),
});
export type AnnouncementUpdateInput = z.output<typeof announcementUpdateSchema>;
