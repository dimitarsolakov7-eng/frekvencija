import { buildSignUploadRequest, uploadFile, type UploadPhase } from "@/lib/uploads/client";

/** Uploads a venue logo and returns the stored path and a fresh signed URL. */
export type LogoUploader = (input: {
  businessId: string;
  file: File;
  signal: AbortSignal;
  onPhase: (phase: UploadPhase) => void;
  onProgress: (fraction: number) => void;
}) => Promise<{ logoPath: string; logoUrl: string }>;

/** The real uploader: signed upload URL → Storage → server-side validation (/api/admin/uploads). */
export const uploadLogoToStorage: LogoUploader = async ({ businessId, file, signal, onPhase, onProgress }) => {
  const result = await uploadFile({
    request: buildSignUploadRequest({ kind: "logo", businessId }, file),
    file,
    signal,
    onPhase,
    onProgress,
  });
  if (result.kind !== "logo") throw new Error("The server answered with an unexpected upload result.");
  return { logoPath: result.logoPath, logoUrl: result.logoUrl };
};
