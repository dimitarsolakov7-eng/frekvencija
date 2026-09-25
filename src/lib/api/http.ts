/**
 * JSON helpers for Route Handlers. Every response is `Cache-Control: private, no-store` and errors use
 * the `ApiErrorBody` shape from src/lib/api/contracts.ts.
 */
import type { z } from "zod";
import type { ApiErrorBody, ApiErrorCode } from "@/lib/api/contracts";
import { summarizeValidationError, toFieldErrors } from "@/lib/validation/forms";

export const API_CACHE_CONTROL = "private, no-store";
export const DEFAULT_MAX_JSON_BYTES = 64 * 1024;

function noStoreHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set("Cache-Control", API_CACHE_CONTROL);
  return headers;
}

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, { ...init, status: init?.status ?? 200, headers: noStoreHeaders(init?.headers) });
}

export function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  fields?: Record<string, string>,
): Response {
  const body: ApiErrorBody = {
    error: fields && Object.keys(fields).length > 0 ? { code, message, fields } : { code, message },
  };
  return Response.json(body, { status, headers: noStoreHeaders() });
}

/** Logs the real cause server-side and returns a generic 500 (never leaks internals to the client). */
export function jsonServerError(context: string, cause: unknown): Response {
  console.error(`[api] ${context}`, cause);
  return jsonError(500, "server_error", "Something went wrong on our side. Please try again.");
}

export type ReadJsonResult<T> = { ok: true; data: T } | { ok: false; response: Response };

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";")[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

type BodyText = { ok: true; text: string } | { ok: false; reason: "too_large" | "unreadable" };

async function readBodyText(request: Request, maxBytes: number): Promise<BodyText> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return { ok: false, reason: "too_large" };
  if (!request.body) return { ok: true, text: "" };

  // Content-Length can be absent (chunked) or wrong, so count the bytes actually received.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/**
 * Reads, size-limits, parses and validates a JSON request body.
 * Requires `Content-Type: application/json` (defence in depth against cross-site simple requests).
 */
export async function readJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  options: { maxBytes?: number } = {},
): Promise<ReadJsonResult<z.output<Schema>>> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return {
      ok: false,
      response: jsonError(415, "invalid_request", "Send the request body as JSON (Content-Type: application/json)."),
    };
  }

  const body = await readBodyText(request, maxBytes);
  if (!body.ok) {
    return {
      ok: false,
      response:
        body.reason === "too_large"
          ? jsonError(413, "payload_too_large", `The request body is larger than ${maxBytes} bytes.`)
          : jsonError(400, "invalid_request", "The request body could not be read as UTF-8 text."),
    };
  }
  if (body.text.trim() === "") {
    return { ok: false, response: jsonError(400, "invalid_request", "The request body is empty.") };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return { ok: false, response: jsonError(400, "invalid_request", "The request body is not valid JSON.") };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      response: jsonError(400, "invalid_request", summarizeValidationError(result.error), toFieldErrors(result.error)),
    };
  }
  return { ok: true, data: result.data };
}
