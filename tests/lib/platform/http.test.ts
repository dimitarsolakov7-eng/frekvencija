import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ApiErrorBody } from "@/lib/api/contracts";
import { jsonError, jsonOk, readJson } from "@/lib/api/http";

const schema = z.object({ name: z.string().min(1, { error: "Name is required." }), count: z.number().int() });

function jsonRequest(body: BodyInit | null, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("http://localhost/api/test", { method: "POST", body, headers });
}

async function errorOf(response: Response): Promise<ApiErrorBody["error"]> {
  return ((await response.json()) as ApiErrorBody).error;
}

describe("jsonOk / jsonError", () => {
  it("returns JSON with private no-store caching", async () => {
    const response = jsonOk({ hello: "world" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ hello: "world" });
  });

  it("keeps custom status/headers but always forces no-store", () => {
    const response = jsonOk({}, { status: 201, headers: { "Cache-Control": "public, max-age=60", "X-Test": "1" } });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-test")).toBe("1");
  });

  it("builds the ApiErrorBody shape", async () => {
    const response = jsonError(403, "business_inactive", "Venue inactive");
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: { code: "business_inactive", message: "Venue inactive" } });
  });

  it("includes fields only when there are some", async () => {
    expect(await errorOf(jsonError(400, "invalid_request", "Bad", {}))).toEqual({ code: "invalid_request", message: "Bad" });
    expect(await errorOf(jsonError(400, "invalid_request", "Bad", { name: "Required" }))).toEqual({
      code: "invalid_request",
      message: "Bad",
      fields: { name: "Required" },
    });
  });
});

describe("readJson", () => {
  it("parses and validates a JSON body", async () => {
    const result = await readJson(jsonRequest(JSON.stringify({ name: "x", count: 2, extra: true })), schema);
    expect(result).toEqual({ ok: true, data: { name: "x", count: 2 } });
  });

  it("accepts a charset parameter and +json types", async () => {
    const withCharset = await readJson(
      jsonRequest(JSON.stringify({ name: "x", count: 1 }), { "content-type": "application/json; charset=utf-8" }),
      schema,
    );
    expect(withCharset.ok).toBe(true);
    const vendor = await readJson(
      jsonRequest(JSON.stringify({ name: "x", count: 1 }), { "content-type": "application/vnd.api+json" }),
      schema,
    );
    expect(vendor.ok).toBe(true);
  });

  it("rejects non-JSON content types with 415", async () => {
    const result = await readJson(jsonRequest(JSON.stringify({ name: "x", count: 1 }), { "content-type": "text/plain" }), schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(415);
      expect((await errorOf(result.response)).code).toBe("invalid_request");
    }
  });

  it("rejects malformed JSON and empty bodies with 400", async () => {
    for (const body of ["{not json", "", "   "]) {
      const result = await readJson(jsonRequest(body), schema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
        expect((await errorOf(result.response)).code).toBe("invalid_request");
      }
    }
  });

  it("reports schema failures with field messages", async () => {
    const result = await readJson(jsonRequest(JSON.stringify({ name: "", count: 1.5 })), schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const error = await errorOf(result.response);
      expect(error.code).toBe("invalid_request");
      expect(error.fields?.name).toBe("Name is required.");
      expect(error.fields?.count).toBeTruthy();
    }
  });

  it("rejects bodies over the limit even without a Content-Length header (streamed)", async () => {
    const big = JSON.stringify({ name: "x".repeat(2000), count: 1 });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(big);
        for (let i = 0; i < bytes.length; i += 256) controller.enqueue(bytes.slice(i, i + 256));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: stream,
      headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const result = await readJson(request, schema, { maxBytes: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      expect((await errorOf(result.response)).code).toBe("payload_too_large");
    }
  });

  it("rejects a declared Content-Length over the limit before reading", async () => {
    const request = jsonRequest(JSON.stringify({ name: "x", count: 1 }), {
      "content-type": "application/json",
      "content-length": "999999",
    });
    const result = await readJson(request, schema, { maxBytes: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("rejects invalid UTF-8", async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    const result = await readJson(jsonRequest(bytes), schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });
});
