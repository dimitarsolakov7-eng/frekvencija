import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompleteUploadResponse, SignUploadRequest, SignUploadResponse } from "@/lib/api/contracts";
import {
  buildSignUploadRequest,
  mapStorageUploadFailure,
  UploadError,
  uploadFile,
  uploadWithProgress,
} from "@/lib/uploads/client";

type ProgressHandler = (event: { lengthComputable: boolean; loaded: number; total: number }) => void;

class FakeXhr {
  static instances: FakeXhr[] = [];
  /** When set, send() answers asynchronously with this response. */
  static autoRespond: { status: number; body: string } | null = null;

  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: FormData | null = null;
  status = 0;
  responseText = "";
  upload: { onprogress: ProgressHandler | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: FormData) {
    this.body = body;
    FakeXhr.instances.push(this);
    const auto = FakeXhr.autoRespond;
    if (auto) {
      queueMicrotask(() => {
        this.progress(50, 100);
        this.respond(auto.status, auto.body);
      });
    }
  }
  abort() {
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  respond(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }
}

const SIGNED_URL = "https://abc.supabase.co/storage/v1/object/upload/sign/music/tracks/t1/r.mp3?token=tok";

beforeEach(() => {
  FakeXhr.instances = [];
  FakeXhr.autoRespond = null;
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function lastXhr(): FakeXhr {
  const xhr = FakeXhr.instances.at(-1);
  if (!xhr) throw new Error("no XHR sent");
  return xhr;
}

describe("uploadWithProgress", () => {
  it("replicates uploadToSignedUrl: PUT, apikey, FormData order cacheControl/contentType/file", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "song.mp3", { type: "audio/mp3" });
    const onProgress = vi.fn();
    const done = uploadWithProgress({ signedUrl: SIGNED_URL, file, contentType: "audio/mpeg", onProgress });

    const xhr = lastXhr();
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe(SIGNED_URL);
    expect(xhr.headers).toEqual({ apikey: "sb_publishable_test" });
    const entries = [...(xhr.body as FormData).entries()];
    expect(entries.map(([key]) => key)).toEqual(["cacheControl", "contentType", ""]);
    expect(entries[0][1]).toBe("3600");
    expect(entries[1][1]).toBe("audio/mpeg");
    expect(entries[2][1]).toBeInstanceOf(Blob);

    xhr.progress(25, 100);
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 5, total: 0 });
    xhr.respond(200, '{"Key":"music/tracks/t1/r.mp3"}');
    await expect(done).resolves.toBeUndefined();
    expect(onProgress.mock.calls).toEqual([[0.25], [1]]);
  });

  it.each([
    ["409", "conflict"],
    ["413", "payload_too_large"],
    ["415", "unsupported_media"],
    ["404", "not_found"],
    ["403", "forbidden"],
  ])("maps Storage statusCode %s (HTTP 400) to %s", async (statusCode, code) => {
    const done = uploadWithProgress({ signedUrl: SIGNED_URL, file: new Blob(["x"]), contentType: "audio/mpeg" });
    lastXhr().respond(400, JSON.stringify({ statusCode, error: "Error", message: "storage says no" }));
    await expect(done).rejects.toMatchObject({ name: "UploadError", code, status: 400 });
  });

  it("maps an expired upload token and server errors", () => {
    expect(mapStorageUploadFailure(400, JSON.stringify({ statusCode: "400", error: "InvalidJWT", message: "jwt expired" })).code).toBe(
      "forbidden",
    );
    expect(mapStorageUploadFailure(502, "<html>Bad gateway</html>").code).toBe("unavailable");
    const generic = mapStorageUploadFailure(400, JSON.stringify({ statusCode: "400", message: "Invalid key" }));
    expect(generic.code).toBe("server_error");
    expect(generic.message).toContain("Invalid key");
  });

  it("reports network errors", async () => {
    const done = uploadWithProgress({ signedUrl: SIGNED_URL, file: new Blob(["x"]), contentType: "audio/mpeg" });
    lastXhr().onerror?.();
    await expect(done).rejects.toMatchObject({ code: "network" });
  });

  it("aborts through the signal", async () => {
    const controller = new AbortController();
    const done = uploadWithProgress({ signedUrl: SIGNED_URL, file: new Blob(["x"]), contentType: "audio/mpeg", signal: controller.signal });
    controller.abort();
    await expect(done).rejects.toMatchObject({ code: "aborted" });
  });

  it("does not start when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadWithProgress({ signedUrl: SIGNED_URL, file: new Blob(["x"]), contentType: "audio/mpeg", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(FakeXhr.instances).toHaveLength(0);
  });
});

const signResponse: SignUploadResponse = {
  uploadToken: "payload.signature",
  bucket: "music",
  path: "tracks/t1/r.mp3",
  signedUrl: SIGNED_URL,
  token: "tok",
  maxBytes: 52_428_800,
};

const completeResponse: CompleteUploadResponse = {
  kind: "logo",
  businessId: "b1",
  logoPath: "b1/x.png",
  logoUrl: "https://abc.supabase.co/storage/v1/object/sign/logos/b1/x.png?token=t",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("uploadFile", () => {
  const file = new File([new Uint8Array(10)], "song.mp3", { type: "audio/mpeg" });
  const request = buildSignUploadRequest({ kind: "track" }, file);

  it("signs, uploads and completes, reporting phases", async () => {
    FakeXhr.autoRespond = { status: 200, body: '{"Key":"music/tracks/t1/r.mp3"}' };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, signResponse)).mockResolvedValueOnce(jsonResponse(200, completeResponse));
    vi.stubGlobal("fetch", fetchMock);
    const phases: string[] = [];
    const progress: number[] = [];

    const result = await uploadFile({
      request,
      file,
      metadata: { title: "Song" },
      onPhase: (phase) => phases.push(phase),
      onProgress: (fraction) => progress.push(fraction),
    });

    expect(result).toEqual(completeResponse);
    expect(phases).toEqual(["signing", "uploading", "validating"]);
    expect(progress).toEqual([0, 0.5, 1]);
    const [signUrl, signInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(signUrl).toBe("/api/admin/uploads/sign");
    expect(JSON.parse(signInit.body as string)).toEqual<SignUploadRequest>({
      kind: "track",
      fileName: "song.mp3",
      fileSize: 10,
      contentType: "audio/mpeg",
    });
    expect(new Headers(signInit.headers).get("content-type")).toBe("application/json");
    const [completeUrl, completeInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(completeUrl).toBe("/api/admin/uploads/complete");
    expect(JSON.parse(completeInit.body as string)).toEqual({ uploadToken: "payload.signature", metadata: { title: "Song" } });
    expect(completeInit.signal).toBeUndefined();
  });

  it("surfaces the API error message and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(429, { error: { code: "rate_limited", message: "Too many requests." } })),
    );
    await expect(uploadFile({ request, file })).rejects.toMatchObject({ code: "rate_limited", message: "Too many requests.", status: 429 });
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("handles non-JSON error responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })));
    await expect(uploadFile({ request, file })).rejects.toMatchObject({ code: "unavailable", status: 502 });
  });

  it("maps fetch failures to network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(uploadFile({ request, file })).rejects.toMatchObject({ code: "network" });
  });

  it("validates locally before contacting the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const wav = new File([new Uint8Array(10)], "song.wav", { type: "audio/wav" });
    await expect(uploadFile({ request: buildSignUploadRequest({ kind: "track" }, wav), file: wav })).rejects.toBeInstanceOf(UploadError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds per-kind sign requests", () => {
    const logo = new File([new Uint8Array(3)], "logo.png", { type: "image/png" });
    expect(buildSignUploadRequest({ kind: "logo", businessId: "b1" }, logo)).toEqual({
      kind: "logo",
      businessId: "b1",
      fileName: "logo.png",
      fileSize: 3,
      contentType: "image/png",
    });
  });
});
