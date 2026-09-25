import { z } from "zod";
import { idSchema } from "./fields";

/** PUT /api/player/preferences — omitted fields stay unchanged; at least one must be present. */
export const updatePreferencesRequestSchema = z
  .object({
    genreId: idSchema.nullable().optional(),
    volume: z
      .number({ error: "volume must be a number between 0 and 1." })
      .min(0, { error: "volume must be between 0 and 1." })
      .max(1, { error: "volume must be between 0 and 1." })
      .optional(),
    muted: z.boolean({ error: "muted must be true or false." }).optional(),
  })
  .refine((value) => value.genreId !== undefined || value.volume !== undefined || value.muted !== undefined, {
    error: "Provide at least one of genreId, volume or muted.",
  });
export type UpdatePreferencesRequestInput = z.output<typeof updatePreferencesRequestSchema>;
