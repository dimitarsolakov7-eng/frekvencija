import { z } from "zod";
import { idArray, idSchema } from "./fields";
import { MAX_FILE_NAME_LENGTH } from "./limits";

const fileFields = {
  fileName: z
    .string({ error: "fileName is required." })
    .trim()
    .min(1, { error: "fileName is required." })
    .max(MAX_FILE_NAME_LENGTH, { error: `fileName must be at most ${MAX_FILE_NAME_LENGTH} characters.` }),
  fileSize: z
    .number({ error: "fileSize must be a number of bytes." })
    .int({ error: "fileSize must be a whole number of bytes." })
    .positive({ error: "The file is empty." })
    .max(Number.MAX_SAFE_INTEGER, { error: "fileSize is too large." }),
  /** Browser-reported type; may be "". Checked per kind with checkUploadFile(). */
  contentType: z.string({ error: "contentType must be a string." }).trim().max(255, { error: "contentType is too long." }),
};

/**
 * POST /api/admin/uploads/sign. Shape only: per-kind size/type rules live in checkUploadFile()
 * (src/lib/validation/limits.ts) so the handler can answer 413/415 precisely.
 */
export const signUploadRequestSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("track"), ...fileFields }),
    z.object({ kind: z.literal("track-replace"), trackId: idSchema, ...fileFields }),
    z.object({ kind: z.literal("announcement"), announcementId: idSchema, ...fileFields }),
    z.object({ kind: z.literal("logo"), businessId: idSchema, ...fileFields }),
    z.object({ kind: z.literal("genre-cover"), genreId: idSchema, ...fileFields }),
  ],
  { error: 'kind must be one of "track", "track-replace", "announcement", "logo" or "genre-cover".' },
);
export type SignUploadRequestInput = z.output<typeof signUploadRequestSchema>;

/** Optional text override: blank means "not provided" (fall back to ID3 tags / file name). */
function optionalOverride(label: string, max: number) {
  return z
    .preprocess(
      (value) => (typeof value === "string" ? value.trim() || undefined : value),
      z
        .string({ error: `${label} must be text.` })
        .max(max, { error: `${label} must be at most ${max} characters.` })
        .optional(),
    )
    .optional();
}

export const trackUploadMetadataSchema = z.object({
  title: optionalOverride("Title", 200),
  artist: optionalOverride("Artist", 200),
  genreIds: idArray("Genres", 100).optional(),
});

/** POST /api/admin/uploads/complete */
export const completeUploadRequestSchema = z.object({
  uploadToken: z
    .string({ error: "uploadToken is required." })
    .min(1, { error: "uploadToken is required." })
    .max(4096, { error: "uploadToken is too long." }),
  metadata: trackUploadMetadataSchema.optional(),
});
export type CompleteUploadRequestInput = z.output<typeof completeUploadRequestSchema>;
