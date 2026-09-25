/**
 * The ElevenLabs client against a local HTTP server with Node's real fetch (no mocks): checks the
 * wire format, that `cache: "no-store"` is accepted, and that the deadline also covers a stalled body.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElevenLabsClient, ElevenLabsError } from "@/lib/tts/elevenlabs";

const API_KEY = "sk_local_test_key";
let server: Server;
let baseUrl = "";
const received: { url: string; apiKey: string | undefined; body: string }[] = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => resolve(body));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    received.push({ url: req.url ?? "", apiKey: req.headers["xi-api-key"] as string | undefined, body });
    if (req.url?.startsWith("/v1/text-to-speech/ok")) {
      res.writeHead(200, { "content-type": "audio/mpeg", "request-id": "req-ok", "character-cost": "12" });
      res.end(Buffer.from([0xff, 0xfb, 0x90, 0x64]));
    } else if (req.url?.startsWith("/v1/text-to-speech/stall")) {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.write(Buffer.from([0xff, 0xfb])); // never finishes
    } else if (req.url === "/v1/models") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          detail: { type: "authentication_error", code: "unauthorized", message: "Invalid API key", status: "invalid_api_key", request_id: "rid-401" },
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("ElevenLabs client over real HTTP", () => {
  it("sends the key header and JSON body, and returns the audio bytes", async () => {
    const client = createElevenLabsClient({ apiKey: API_KEY, baseUrl, maxRetries: 0 });
    const result = await client.synthesize({ voiceId: "ok", modelId: "eleven_multilingual_v2", text: " Hi there ", languageCode: "bg" });

    expect(result).toMatchObject({ contentType: "audio/mpeg", requestId: "req-ok", characterCount: 12 });
    expect(Array.from(result.audio)).toEqual([0xff, 0xfb, 0x90, 0x64]);
    const request = received.at(-1);
    expect(request?.url).toBe("/v1/text-to-speech/ok?output_format=mp3_44100_128");
    expect(request?.apiKey).toBe(API_KEY);
    expect(JSON.parse(request?.body ?? "{}")).toEqual({ text: "Hi there", model_id: "eleven_multilingual_v2" });
  });

  it("times out when the audio body stalls", async () => {
    const client = createElevenLabsClient({ apiKey: API_KEY, baseUrl, maxRetries: 0 });
    const started = Date.now();
    const error = await client.synthesize({ voiceId: "stall", modelId: "eleven_v3", text: "Hi", timeoutMs: 300 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElevenLabsError);
    expect((error as ElevenLabsError).kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("classifies a JSON error response", async () => {
    const client = createElevenLabsClient({ apiKey: API_KEY, baseUrl, maxRetries: 0 });
    await expect(client.listModels()).rejects.toMatchObject({ kind: "auth", status: 401, requestId: "rid-401" });
  });

  it("reports a refused connection as provider_unavailable", async () => {
    const client = createElevenLabsClient({ apiKey: API_KEY, baseUrl: "http://127.0.0.1:1", maxRetries: 0 });
    await expect(client.listModels()).rejects.toMatchObject({ kind: "provider_unavailable", status: null });
  });
});
