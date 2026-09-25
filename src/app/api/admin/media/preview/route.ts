import type { AdminPreviewResponse } from "@/lib/api/contracts";
import { jsonError, jsonOk, jsonServerError, readJson } from "@/lib/api/http";
import { requireAdminApi } from "@/lib/auth/session";
import { dbErrorResponse } from "@/lib/data/admin/uploads";
import { EnvError } from "@/lib/env";
import { MediaSigningError, signAudioObject } from "@/lib/media/signing";
import { adminPreviewRequestSchema } from "@/lib/validation/media";

/**
 * POST /api/admin/media/preview { kind: "track" | "announcement", id } → { url, expiresAt }.
 *
 * Lets an admin listen to any track (active, disabled or removed) or any announcement that has audio,
 * whatever its status. The URL is signed with the ADMIN'S OWN client, so the storage admin policy
 * applies; its lifetime covers the item's duration (signAudioObject).
 */
export const dynamic = "force-dynamic";

type PreviewTarget = { bucket: "music" | "announcements"; path: string; durationSeconds: number | null };

export async function POST(request: Request): Promise<Response> {
  const access = await requireAdminApi();
  if (!access.ok) return access.response;
  const { supabase } = access;

  try {
    const body = await readJson(request, adminPreviewRequestSchema);
    if (!body.ok) return body.response;
    const { kind, id } = body.data;

    let target: PreviewTarget;
    if (kind === "track") {
      const { data, error } = await supabase.from("tracks").select("storage_path, duration_seconds").eq("id", id).maybeSingle();
      if (error) return dbErrorResponse("admin preview: track lookup failed", error);
      if (!data) return jsonError(404, "not_found", "This track no longer exists.");
      target = { bucket: "music", path: data.storage_path, durationSeconds: Number(data.duration_seconds) };
    } else {
      const { data, error } = await supabase
        .from("announcements")
        .select("audio_path, audio_duration_seconds")
        .eq("id", id)
        .maybeSingle();
      if (error) return dbErrorResponse("admin preview: announcement lookup failed", error);
      if (!data) return jsonError(404, "not_found", "This announcement no longer exists.");
      if (!data.audio_path) {
        return jsonError(404, "not_found", "This announcement has no audio yet. Generate it or upload an MP3.");
      }
      target = {
        bucket: "announcements",
        path: data.audio_path,
        durationSeconds: data.audio_duration_seconds === null ? null : Number(data.audio_duration_seconds),
      };
    }

    const signed = await signAudioObject(supabase, target.bucket, target.path, target.durationSeconds);
    const response: AdminPreviewResponse = { url: signed.url, expiresAt: signed.expiresAt };
    return jsonOk(response);
  } catch (error) {
    if (error instanceof MediaSigningError) {
      if (error.notFound) {
        return jsonError(404, "not_found", "The audio file is missing from storage. Upload the file again.");
      }
      return jsonServerError(`admin preview: signing ${error.bucket}/${error.path} failed`, error);
    }
    if (error instanceof EnvError) {
      console.error("[media] admin preview: server configuration is incomplete", error);
      return jsonError(503, "unavailable", "Media previews are not configured on this server yet.");
    }
    return jsonServerError("admin preview failed", error);
  }
}
