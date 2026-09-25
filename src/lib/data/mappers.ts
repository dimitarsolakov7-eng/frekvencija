/**
 * Row → read-model mappers shared by admin pages, server actions and upload/generate routes.
 * Keep these the only place that converts database rows into the contract shapes.
 */
import type { AdminAnnouncement, AdminTrack } from "@/lib/api/contracts";
import type { Tables } from "@/types/database";

export function toAdminTrack(row: Tables<"tracks">, genreIds: readonly string[]): AdminTrack {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationSeconds: Number(row.duration_seconds),
    fileSizeBytes: Number(row.file_size_bytes),
    bitrateKbps: row.bitrate_kbps,
    originalFilename: row.original_filename,
    isActive: row.is_active,
    removedAt: row.removed_at,
    genreIds: [...genreIds],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAdminAnnouncement(row: Tables<"announcements">): AdminAnnouncement {
  return {
    id: row.id,
    businessId: row.business_id,
    templateKey: row.template_key,
    placement: row.placement,
    text: row.text,
    spokenText: row.spoken_text,
    language: row.language,
    status: row.status,
    source: row.source,
    hasAudio: row.audio_path !== null,
    audioDurationSeconds: row.audio_duration_seconds === null ? null : Number(row.audio_duration_seconds),
    voiceId: row.voice_id,
    voiceName: row.voice_name,
    modelId: row.model_id,
    lastError: row.last_error,
    needsReview: row.needs_review,
    reviewReason: row.review_reason,
    approvedAt: row.approved_at,
    generationStartedAt: row.generation_started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
