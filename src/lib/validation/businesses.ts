import { z } from "zod";
import { DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS } from "@/config/platform";
import {
  formBoolean,
  formInteger,
  formNumber,
  idArray,
  idSchema,
  languageCodeSchema,
  nullableEmailSchema,
  nullableText,
  requiredText,
} from "./fields";
import { inviteDeliverySchema } from "./invites";

/** Values of the `business_type` enum (docs/REDESIGN.md §3). */
export const BUSINESS_TYPES = ["cafe", "restaurant", "hotel", "bar", "other"] as const;
export type BusinessTypeValue = (typeof BUSINESS_TYPES)[number];

export const businessTypeSchema = z.enum(BUSINESS_TYPES, { error: "Choose a business type." });

const businessFields = {
  name: requiredText("Business name", 120),
  stationName: requiredText("Station name", 120),
  /** Spoken spelling of the name for TTS, e.g. "Emerald Bar". */
  namePronunciation: nullableText("Name pronunciation", 200),
  stationNamePronunciation: nullableText("Station name pronunciation", 200),
  contactEmail: nullableEmailSchema,
  announcementLanguage: languageCodeSchema,
  businessType: businessTypeSchema,
  isActive: formBoolean,
  announcementEveryNTracks: formInteger("Announcement interval", 1, 50),
  /** Gain applied to announcements, 0.10–1.00 (stored as numeric(3,2)). */
  announcementVolume: formNumber("Announcement volume", 0.1, 1, 2),
};

/** Create: omitted optional fields take the database defaults (an omitted type is stored as "other"). */
export const businessCreateSchema = z.object({
  name: businessFields.name,
  stationName: businessFields.stationName,
  namePronunciation: businessFields.namePronunciation.default(null),
  stationNamePronunciation: businessFields.stationNamePronunciation.default(null),
  contactEmail: businessFields.contactEmail.default(null),
  announcementLanguage: businessFields.announcementLanguage.default("en"),
  businessType: businessFields.businessType.optional(),
  isActive: businessFields.isActive.default(false),
  announcementEveryNTracks: businessFields.announcementEveryNTracks.default(DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS),
  announcementVolume: businessFields.announcementVolume.default(1),
});
export type BusinessCreateInput = z.output<typeof businessCreateSchema>;

/**
 * Update: every field optional; an omitted field means "unchanged", so one schema serves the profile
 * form, the activation toggle and the announcement-settings form. Blank optional text clears it (null).
 */
export const businessUpdateSchema = z.object({
  name: businessFields.name.optional(),
  stationName: businessFields.stationName.optional(),
  namePronunciation: businessFields.namePronunciation.optional(),
  stationNamePronunciation: businessFields.stationNamePronunciation.optional(),
  contactEmail: businessFields.contactEmail.optional(),
  announcementLanguage: businessFields.announcementLanguage.optional(),
  businessType: businessFields.businessType.optional(),
  isActive: businessFields.isActive.optional(),
  announcementEveryNTracks: businessFields.announcementEveryNTracks.optional(),
  announcementVolume: businessFields.announcementVolume.optional(),
});
export type BusinessUpdateInput = z.output<typeof businessUpdateSchema>;

/**
 * The venue profile form (/admin/businesses/[id], Profile tab). Every field is always submitted, so
 * nothing here is optional: an absent status is an error rather than "unchanged".
 */
export const businessProfileSchema = z.object({
  name: businessFields.name,
  stationName: businessFields.stationName,
  namePronunciation: businessFields.namePronunciation,
  stationNamePronunciation: businessFields.stationNamePronunciation,
  contactEmail: businessFields.contactEmail,
  announcementLanguage: businessFields.announcementLanguage,
  businessType: businessFields.businessType,
  isActive: businessFields.isActive,
});
export type BusinessProfileInput = z.output<typeof businessProfileSchema>;

export const MAX_GENRES_PER_BUSINESS = 500;

/**
 * "Add business" form: the venue itself plus the genres to give it and whether to invite the contact
 * straight away. An invitation needs the contact email.
 */
export const newBusinessSchema = businessCreateSchema
  .extend({
    /** The add form always asks for the type. */
    businessType: businessFields.businessType,
    genreIds: idArray("Genres", MAX_GENRES_PER_BUSINESS).default([]),
    inviteContact: formBoolean.default(false),
    inviteDelivery: inviteDeliverySchema.default("email"),
    /** The access request this venue is created from (marked approved afterwards). */
    fromRequest: z.preprocess((value) => (value === "" ? null : value), idSchema.nullable()).default(null),
  })
  .superRefine((input, context) => {
    if (input.inviteContact && !input.contactEmail) {
      context.addIssue({
        code: "custom",
        path: ["contactEmail"],
        message: "Add the contact email to invite them, or turn off “Invite the contact now”.",
      });
    }
  });
export type NewBusinessInput = z.output<typeof newBusinessSchema>;

/** Genre access: the complete set of exclusive genres ticked for the venue. */
export const genreAccessUpdateSchema = z.object({
  businessId: idSchema,
  genreIds: idArray("Genres", MAX_GENRES_PER_BUSINESS),
});

export const businessActivationSchema = z.object({
  businessId: idSchema,
  isActive: z.boolean({ error: "Choose active or inactive." }),
});

export const memberRefSchema = z.object({ businessId: idSchema, userId: idSchema });

export const memberAccessSchema = memberRefSchema.extend({
  delivery: inviteDeliverySchema,
});

export const deleteBusinessSchema = z.object({
  businessId: idSchema,
  confirmation: z.string({ error: "Type the business name to confirm." }).max(500),
});
