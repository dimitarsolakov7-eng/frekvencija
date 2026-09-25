import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseByteRange } from "@/app/api/dev/_lib/byte-range";
import {
  DemoManifestError,
  findDemoEntry,
  loadDemoManifest,
  resolveDemoAudioPath,
  type DemoManifest,
} from "@/app/api/dev/_lib/demo-manifest";
import { GET, HEAD } from "@/app/api/dev/audio/[id]/route";

describe("parseByteRange", () => {
  const size = 1000;

  it("serves the full body without (or with an unusable) Range header", () => {
    expect(parseByteRange(null, size)).toEqual({ kind: "full" });
    expect(parseByteRange("", size)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=-", size)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=0-10,20-30", size)).toEqual({ kind: "full" });
    expect(parseByteRange("items=0-10", size)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=20-10", size)).toEqual({ kind: "full" });
  });

  it("parses open, closed and suffix ranges", () => {
    expect(parseByteRange("bytes=0-", size)).toEqual({ kind: "partial", start: 0, end: 999 });
    expect(parseByteRange("bytes=100-199", size)).toEqual({ kind: "partial", start: 100, end: 199 });
    expect(parseByteRange("bytes=900-5000", size)).toEqual({ kind: "partial", start: 900, end: 999 });
    expect(parseByteRange("bytes=-100", size)).toEqual({ kind: "partial", start: 900, end: 999 });
    expect(parseByteRange("bytes=-5000", size)).toEqual({ kind: "partial", start: 0, end: 999 });
    expect(parseByteRange("BYTES=5-5", size)).toEqual({ kind: "partial", start: 5, end: 5 });
  });

  it("reports unsatisfiable ranges", () => {
    expect(parseByteRange("bytes=1000-", size)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=-0", size)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("demo manifest", () => {
  it("loads the committed manifest with tracks and announcements for both demo venues", async () => {
    const manifest = await loadDemoManifest();
    const tracks = manifest.entries.filter((entry) => entry.kind === "track");
    const announcements = manifest.entries.filter((entry) => entry.kind === "announcement");
    expect(tracks.length).toBeGreaterThan(0);
    expect(new Set(announcements.map((entry) => entry.kind === "announcement" && entry.business))).toEqual(
      new Set(["emeraldbar", "hotel-aurora"]),
    );
  });

  it("only looks up slug ids", async () => {
    const manifest = await loadDemoManifest();
    const id = manifest.entries[0].id;
    expect(findDemoEntry(manifest, id)?.id).toBe(id);
    for (const bad of ["../manifest", "music/x", "UPPER", "a--b", "", `${"a".repeat(101)}`, "..%2F"]) {
      expect(findDemoEntry(manifest, bad)).toBeNull();
    }
  });

  it("refuses paths outside the audio folder", () => {
    expect(() => resolveDemoAudioPath({ file: "../../package.json" })).toThrow(DemoManifestError);
    expect(resolveDemoAudioPath({ file: "music/x.mp3" }, "/audio")).toMatch(/[\\/]audio[\\/]music[\\/]x\.mp3$/);
  });

  it("reports a missing manifest with the command to fix it", async () => {
    await expect(loadDemoManifest(join(process.cwd(), "does-not-exist", "manifest.json"))).rejects.toThrow(/npm run demo:audio/);
  });
});

describe("GET /api/dev/audio/[id]", () => {
  let manifest: DemoManifest;
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const url = (id: string, query = "") => `http://localhost/api/dev/audio/${id}${query}`;

  async function firstTrack() {
    manifest ??= await loadDemoManifest();
    const entry = manifest.entries.find((item) => item.kind === "track");
    if (!entry) throw new Error("the demo manifest has no tracks");
    const bytes = new Uint8Array(await readFile(resolveDemoAudioPath(entry)));
    return { entry, bytes };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves the whole file with audio/mpeg and Accept-Ranges", async () => {
    const { entry, bytes } = await firstTrack();
    const response = await GET(new Request(url(entry.id)), context(entry.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("etag")).toBe(`"${entry.sha256}"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("answers a Range request with 206 and exactly the requested bytes", async () => {
    const { entry, bytes } = await firstTrack();
    const response = await GET(new Request(url(entry.id), { headers: { Range: "bytes=100-299" } }), context(entry.id));
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 100-299/${bytes.length}`);
    expect(response.headers.get("content-length")).toBe("200");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(100, 300));

    const tail = await GET(new Request(url(entry.id), { headers: { Range: "bytes=-50" } }), context(entry.id));
    expect(tail.status).toBe(206);
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.slice(bytes.length - 50));
  });

  it("answers 416 for a range past the end", async () => {
    const { entry, bytes } = await firstTrack();
    const response = await GET(new Request(url(entry.id), { headers: { Range: `bytes=${bytes.length}-` } }), context(entry.id));
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${bytes.length}`);
  });

  it("ignores the Range when If-Range names another version", async () => {
    const { entry, bytes } = await firstTrack();
    const response = await GET(
      new Request(url(entry.id), { headers: { Range: "bytes=0-9", "If-Range": '"stale"' } }),
      context(entry.id),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    await response.arrayBuffer();
  });

  it("answers HEAD with headers only", async () => {
    const { entry, bytes } = await firstTrack();
    const response = await HEAD(new Request(url(entry.id), { method: "HEAD" }), context(entry.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.body).toBeNull();
  });

  it("returns 404 JSON for unknown or malformed ids", async () => {
    for (const id of ["no-such-file", "../../package.json", "music%2Ftest"]) {
      const response = await GET(new Request(url(encodeURIComponent(id))), context(id));
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
    }
  });

  it("enforces ?exp like an expiring signed URL", async () => {
    const { entry } = await firstTrack();
    const valid = await GET(new Request(url(entry.id, `?exp=${Date.now() + 60_000}`)), context(entry.id));
    expect(valid.status).toBe(200);
    await valid.arrayBuffer();
    const expired = await GET(new Request(url(entry.id, `?exp=${Date.now() - 1}`)), context(entry.id));
    expect(expired.status).toBe(400);
    const garbage = await GET(new Request(url(entry.id, "?exp=soon")), context(entry.id));
    expect(garbage.status).toBe(400);
  });

  it("is a 404 in production", async () => {
    const { entry } = await firstTrack();
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET(new Request(url(entry.id)), context(entry.id));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
