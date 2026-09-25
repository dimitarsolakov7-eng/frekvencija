import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { jsonError } from "@/lib/api/http";
import { parseByteRange } from "../../_lib/byte-range";
import {
  DemoManifestError,
  findDemoEntry,
  loadDemoManifest,
  resolveDemoAudioPath,
  type DemoManifest,
} from "../../_lib/demo-manifest";

/**
 * GET/HEAD /api/dev/audio/[id] — development only (404 in production).
 * Serves a synthetic demo MP3 from supabase/seed/audio, resolved through manifest.json by entry id,
 * with single-range support (206 / Content-Range / Accept-Ranges) so media elements can seek.
 * Optional `?exp=<epoch ms>` makes the URL expire like a signed Storage URL (400 afterwards), which
 * the player lab uses to exercise URL-expiry recovery.
 */
export const dynamic = "force-dynamic";

const BASE_HEADERS = {
  "Content-Type": "audio/mpeg",
  "Accept-Ranges": "bytes",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export function GET(request: Request, context: RouteContext<"/api/dev/audio/[id]">): Promise<Response> {
  return serveDemoAudio(request, context, true);
}

export function HEAD(request: Request, context: RouteContext<"/api/dev/audio/[id]">): Promise<Response> {
  return serveDemoAudio(request, context, false);
}

async function serveDemoAudio(
  request: Request,
  context: RouteContext<"/api/dev/audio/[id]">,
  includeBody: boolean,
): Promise<Response> {
  if (process.env.NODE_ENV === "production") return jsonError(404, "not_found", "Not found.");

  const { id } = await context.params;

  let manifest: DemoManifest;
  try {
    manifest = await loadDemoManifest();
  } catch (error) {
    if (error instanceof DemoManifestError) return jsonError(503, "unavailable", error.message);
    throw error;
  }

  const entry = findDemoEntry(manifest, id);
  if (!entry) return jsonError(404, "not_found", "There is no demo audio with this id.");

  const expiry = new URL(request.url).searchParams.get("exp");
  if (expiry !== null) {
    const expiresAt = Number(expiry);
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      // Same status Supabase Storage uses for an expired signed URL.
      return jsonError(400, "invalid_request", "This demo audio URL has expired.");
    }
  }

  let path: string;
  let size: number;
  try {
    path = resolveDemoAudioPath(entry);
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return jsonError(404, "not_found", "The demo audio file is missing. Run `npm run demo:audio` to generate it.");
  }

  const etag = `"${entry.sha256}"`;
  // If-Range: only honour the Range when the client still has the same file.
  const ifRange = request.headers.get("if-range");
  const rangeHeader = ifRange !== null && ifRange !== etag ? null : request.headers.get("range");
  const range = parseByteRange(rangeHeader, size);

  if (range.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...BASE_HEADERS, ETag: etag, "Content-Range": `bytes */${size}` },
    });
  }

  const start = range.kind === "partial" ? range.start : 0;
  const end = range.kind === "partial" ? range.end : size - 1;
  const length = size === 0 ? 0 : end - start + 1;
  const headers: Record<string, string> = { ...BASE_HEADERS, ETag: etag, "Content-Length": String(length) };
  if (range.kind === "partial") headers["Content-Range"] = `bytes ${start}-${end}/${size}`;

  const body =
    includeBody && length > 0
      ? // Readable.toWeb cancels (destroys) the file stream when the client aborts the request.
        (Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream<Uint8Array>)
      : null;

  return new Response(body, { status: range.kind === "partial" ? 206 : 200, headers });
}
