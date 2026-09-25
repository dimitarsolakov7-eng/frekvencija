/**
 * Browser-side calls the announcements studio makes outside Server Actions: provider options, audio
 * generation, signed preview URLs and MP3 uploads. The studio takes them as one object so the dev
 * preview (/dev/preview/announcements) can swap in fixtures without Supabase or ElevenLabs.
 */
import type {
  AdminPreviewResponse,
  GenerateAnnouncementRequest,
  GenerateAnnouncementResponse,
  TtsOptionsResponse,
} from "@/lib/api/contracts";
import { buildSignUploadRequest, uploadFile, type UploadPhase } from "@/lib/uploads/client";
import { fetchAnnouncementPreview, fetchTtsOptions, requestAnnouncementGeneration } from "./api";

export interface StudioUploadRequest {
  announcementId: string;
  file: File;
  signal: AbortSignal;
  onPhase: (phase: UploadPhase) => void;
  onProgress: (fraction: number) => void;
}

export interface StudioApi {
  /** GET /api/admin/tts/options (`refresh` bypasses the server cache). Throws AdminApiError. */
  loadTtsOptions(options: { signal?: AbortSignal; refresh?: boolean }): Promise<TtsOptionsResponse>;
  /** POST /api/admin/announcements/[id]/generate. Throws AdminApiError. */
  generate(announcementId: string, request: GenerateAnnouncementRequest): Promise<GenerateAnnouncementResponse>;
  /** POST /api/admin/media/preview for an announcement's current audio. Throws AdminApiError. */
  previewUrl(announcementId: string, signal?: AbortSignal): Promise<AdminPreviewResponse>;
  /** Signed upload → validation → attached as `ready`. Throws UploadError (user-facing message). */
  uploadRecording(request: StudioUploadRequest): Promise<void>;
}

export const DEFAULT_STUDIO_API: StudioApi = {
  loadTtsOptions: (options) => fetchTtsOptions(options),
  generate: (announcementId, request) => requestAnnouncementGeneration(announcementId, request),
  previewUrl: (announcementId, signal) => fetchAnnouncementPreview(announcementId, signal),
  async uploadRecording({ announcementId, file, signal, onPhase, onProgress }) {
    await uploadFile({
      request: buildSignUploadRequest({ kind: "announcement", announcementId }, file),
      file,
      signal,
      onPhase,
      onProgress,
    });
  },
};
