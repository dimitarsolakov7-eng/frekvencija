import { z } from "zod";
import { idSchema } from "./fields";

/** POST /api/media/sign — unknown keys (e.g. a client-supplied businessId) are stripped. */
export const signMediaRequestSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("track"), id: idSchema, genreId: idSchema }),
    z.object({ kind: z.literal("announcement"), id: idSchema }),
  ],
  { error: 'kind must be "track" or "announcement".' },
);
export type SignMediaRequestInput = z.output<typeof signMediaRequestSchema>;

/** POST /api/admin/media/preview */
export const adminPreviewRequestSchema = z.object({
  kind: z.enum(["track", "announcement"], { error: 'kind must be "track" or "announcement".' }),
  id: idSchema,
});
export type AdminPreviewRequestInput = z.output<typeof adminPreviewRequestSchema>;
