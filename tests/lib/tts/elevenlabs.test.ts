import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSynthesizeBody,
  classifyElevenLabsError,
  createElevenLabsClient,
  describeElevenLabsError,
  ElevenLabsError,
  elevenLabsErrorToApi,
  getElevenLabsClient,
  type ElevenLabsClientOptions,
} from "@/lib/tts/elevenlabs";

const API_KEY = "sk_test_4f9d2c1b8a7e6d5c4b3a2f1e0d9c8b7a";
const MP3_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]);

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function audio(bytes = MP3_BYTES, headers: Record<string, string> = {}): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg", ...headers } });
}

/** A fetch mock answering each call with the next response. */
function fetchSequence(...responses: (Response | Error)[]): FetchMock {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) mock.mockRejectedValueOnce(response);
    else mock.mockResolvedValueOnce(response);
  }
  return mock;
}

function client(fetchMock: FetchMock, options: Partial<ElevenLabsClientOptions> = {}) {
  return createElevenLabsClient({ apiKey: API_KEY, fetch: fetchMock, maxRetries: 0, ...options });
}

async function captureError(promise: Promise<unknown>): Promise<ElevenLabsError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ElevenLabsError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

function requestOf(mock: FetchMock, index = 0): { url: URL; init: RequestInit; body: Record<string, unknown> | null } {
  const [input, init = {}] = mock.mock.calls[index];
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  return { url: new URL(String(input)), init, body };
}

const synthesizeInput = { voiceId: "voice123", modelId: "eleven_multilingual_v2", text: "Welcome to Emerald Bar." };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("synthesize request", () => {
  it("posts JSON with the key header, path-encoded voice id and default output format", async () => {
    const mock = fetchSequence(audio(MP3_BYTES, { "request-id": "req123", "character-cost": "42" }));
    const result = await client(mock).synthesize({ ...synthesizeInput, voiceId: "abc/def", text: "  Hello there.  " });

    const { url, init, body } = requestOf(mock);
    expect(url.origin + url.pathname).toBe("https://api.elevenlabs.io/v1/text-to-speech/abc%2Fdef");
    expect(url.searchParams.get("output_format")).toBe("mp3_44100_128");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "xi-api-key": API_KEY, "Content-Type": "application/json" });
    expect(body).toEqual({ text: "Hello there.", model_id: "eleven_multilingual_v2" });
    expect(result).toEqual({ audio: MP3_BYTES, contentType: "audio/mpeg", requestId: "req123", characterCount: 42 });
  });

  it("never sends language_code to eleven_multilingual_v2", async () => {
    const mock = fetchSequence(audio());
    await client(mock).synthesize({ ...synthesizeInput, languageCode: "bg" });
    expect(requestOf(mock).body).not.toHaveProperty("language_code");
    expect(buildSynthesizeBody({ modelId: "eleven_multilingual_v2", text: "x", languageCode: "bg" })).not.toHaveProperty("language_code");
  });

  it("sends language_code to models that accept it", async () => {
    const mock = fetchSequence(audio());
    await client(mock).synthesize({
      ...synthesizeInput,
      modelId: "eleven_flash_v2_5",
      languageCode: "hr",
      voiceSettings: { stability: 0.5, similarity_boost: 0.75 },
      seed: 7,
      applyTextNormalization: "auto",
    });
    expect(requestOf(mock).body).toEqual({
      text: synthesizeInput.text,
      model_id: "eleven_flash_v2_5",
      language_code: "hr",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      seed: 7,
      apply_text_normalization: "auto",
    });
  });

  it("refuses blank text without calling the provider", async () => {
    const mock = fetchSequence();
    const error = await captureError(client(mock).synthesize({ ...synthesizeInput, text: "   " }));
    expect(error.kind).toBe("validation");
    expect(mock).not.toHaveBeenCalled();
  });

  it("treats a non-audio 200 or an empty body as provider_unavailable", async () => {
    expect((await captureError(client(fetchSequence(json(200, { ok: true }))).synthesize(synthesizeInput))).kind).toBe(
      "provider_unavailable",
    );
    expect((await captureError(client(fetchSequence(audio(new Uint8Array()))).synthesize(synthesizeInput))).kind).toBe(
      "provider_unavailable",
    );
  });
});

describe("error classification", () => {
  it("current-format 401 invalid key ⇒ auth, with the request id from the body", async () => {
    const mock = fetchSequence(
      json(401, {
        detail: {
          type: "authentication_error",
          code: "unauthorized",
          message: "Invalid API key",
          status: "invalid_api_key",
          request_id: "1c1689d894474556068cd3dcd145df7f",
        },
      }),
    );
    const error = await captureError(client(mock).synthesize(synthesizeInput));
    expect(error).toMatchObject({ kind: "auth", status: 401, providerCode: "unauthorized", requestId: "1c1689d894474556068cd3dcd145df7f" });
    expect(error.retryable).toBe(false);
  });

  it("legacy 401 quota_exceeded ⇒ quota (checked before auth)", async () => {
    const mock = fetchSequence(json(401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota of 10000." } }));
    const error = await captureError(client(mock).synthesize(synthesizeInput));
    expect(error).toMatchObject({ kind: "quota", status: 401, providerCode: "quota_exceeded" });
    expect(error.message).toContain("exceeds your quota");
  });

  it("422 pydantic array ⇒ validation with field paths", async () => {
    const mock = fetchSequence(
      json(422, {
        detail: [
          {
            type: "less_than_equal",
            loc: ["body", "voice_settings", "stability"],
            msg: "Input should be less than or equal to 1",
            input: 2,
            ctx: { le: 1.0 },
          },
          { type: "missing", loc: ["body", "text"], msg: "Field required", input: null },
        ],
      }),
    );
    const error = await captureError(client(mock).synthesize(synthesizeInput));
    expect(error).toMatchObject({ kind: "validation", status: 422, providerCode: "validation_error" });
    expect(error.message).toContain("body.voice_settings.stability: Input should be less than or equal to 1");
    expect(error.message).toContain("body.text: Field required");
  });

  it("legacy 429 too_many_concurrent_requests with Retry-After ⇒ rate_limited", async () => {
    const mock = fetchSequence(
      json(429, { detail: { status: "too_many_concurrent_requests", message: "Too many concurrent requests." } }, { "retry-after": "2" }),
    );
    const error = await captureError(client(mock).synthesize(synthesizeInput));
    expect(error).toMatchObject({ kind: "rate_limited", status: 429, retryAfterMs: 2000 });
    expect(error.retryable).toBe(true);
  });

  it("current-format 429 concurrent_limit_exceeded ⇒ rate_limited with request id", async () => {
    const mock = fetchSequence(
      json(429, {
        detail: { type: "rate_limit_error", code: "concurrent_limit_exceeded", message: "Concurrency limit reached.", request_id: "rq-429" },
      }),
    );
    expect(await captureError(client(mock).synthesize(synthesizeInput))).toMatchObject({ kind: "rate_limited", requestId: "rq-429" });
  });

  it("429 system_busy ⇒ rate_limited", async () => {
    const mock = fetchSequence(json(429, { detail: { status: "system_busy", message: "The system is busy." } }));
    expect((await captureError(client(mock).listModels())).kind).toBe("rate_limited");
  });

  it("404 workspace_not_found on GET /v1/models (no key) ⇒ auth", async () => {
    const mock = fetchSequence(
      json(404, {
        detail: {
          type: "not_found",
          code: "workspace_not_found",
          message: "Workspace 1anonymous1 not found.",
          status: "workspace_not_found",
          request_id: "ws-404",
        },
      }),
    );
    expect(await captureError(client(mock).listModels())).toMatchObject({ kind: "auth", status: 404, requestId: "ws-404" });
  });

  it("voice errors ⇒ voice_not_found", async () => {
    const notFound = json(404, { detail: { type: "not_found", code: "voice_not_found", message: "A voice with voice_id 'x' was not found." } });
    expect((await captureError(client(fetchSequence(notFound)).synthesize(synthesizeInput))).kind).toBe("voice_not_found");
    const legacy = json(400, { detail: { status: "voice_does_not_exist", message: "Voice does not exist." } });
    expect((await captureError(client(fetchSequence(legacy)).synthesize(synthesizeInput))).kind).toBe("voice_not_found");
    const bare404 = new Response("Not Found", { status: 404 });
    expect((await captureError(client(fetchSequence(bare404)).synthesize(synthesizeInput))).kind).toBe("voice_not_found");
  });

  it("a bare 404 outside a voice URL ⇒ provider_unavailable", async () => {
    expect((await captureError(client(fetchSequence(new Response("", { status: 404 }))).listModels())).kind).toBe("provider_unavailable");
  });

  it("plan and credit problems ⇒ quota", async () => {
    const paid = json(402, { detail: { type: "payment_required", code: "insufficient_credits", message: "Not enough credits." } });
    expect((await captureError(client(fetchSequence(paid)).synthesize(synthesizeInput))).kind).toBe("quota");
    const tier = json(400, { detail: { status: "invalid_request", message: "This voice requires the creator tier or above." } });
    expect((await captureError(client(fetchSequence(tier)).synthesize(synthesizeInput))).kind).toBe("quota");
  });

  it("text too long ⇒ validation", async () => {
    const mock = fetchSequence(
      json(400, { detail: { status: "max_character_limit_exceeded", message: "This request's text has 627 characters and exceeds the limit." } }),
    );
    expect((await captureError(client(mock).synthesize(synthesizeInput))).kind).toBe("validation");
  });

  it("403 forbidden ⇒ auth", async () => {
    const mock = fetchSequence(json(403, { detail: { type: "authorization_error", code: "forbidden", message: "IP not allowed." } }));
    expect((await captureError(client(mock).listVoices())).kind).toBe("auth");
  });

  it("503 HTML page ⇒ provider_unavailable without leaking markup", async () => {
    const mock = fetchSequence(
      new Response("<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "content-type": "text/html", "x-trace-id": "trace-503" },
      }),
    );
    const error = await captureError(client(mock).synthesize(synthesizeInput));
    expect(error).toMatchObject({ kind: "provider_unavailable", status: 503, requestId: "trace-503" });
    expect(error.message).not.toContain("<");
    expect(error.retryable).toBe(true);
  });

  it("network failure ⇒ provider_unavailable", async () => {
    const error = await captureError(client(fetchSequence(new TypeError("fetch failed"))).listModels());
    expect(error).toMatchObject({ kind: "provider_unavailable", status: null });
  });

  it("classifyElevenLabsError follows the documented order", () => {
    expect(classifyElevenLabsError(401, ["quota_exceeded"], "", false)).toBe("quota");
    expect(classifyElevenLabsError(404, ["model_not_found"], "", true)).toBe("validation");
    expect(classifyElevenLabsError(400, ["voice_access_denied"], "", false)).toBe("voice_not_found");
    expect(classifyElevenLabsError(400, [], "Please upgrade your subscription", false)).toBe("quota");
    expect(classifyElevenLabsError(401, ["missing_permissions"], "", false)).toBe("auth");
    expect(classifyElevenLabsError(408, [], "", false)).toBe("provider_unavailable");
    expect(classifyElevenLabsError(500, [], "", false)).toBe("provider_unavailable");
    expect(classifyElevenLabsError(409, [], "", false)).toBe("validation");
  });

  it("redacts the API key if a provider message echoes it", async () => {
    const mock = fetchSequence(json(401, { detail: { status: "invalid_api_key", message: `Key ${API_KEY} is invalid` } }));
    const error = await captureError(client(mock).synthesize(synthesizeInput));
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).toContain("[redacted]");
  });
});

describe("timeouts and cancellation", () => {
  /** A fetch that never answers but honours its abort signal, like the real one. */
  const hangingFetch = (): FetchMock =>
    vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );

  it("times out when no response arrives", async () => {
    const error = await captureError(client(hangingFetch()).synthesize({ ...synthesizeInput, timeoutMs: 40 }));
    expect(error).toMatchObject({ kind: "timeout", status: null });
    expect(error.retryable).toBe(true);
  });

  it("times out when the audio body stalls after the headers", async () => {
    const stallingFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(MP3_BYTES);
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "audio/mpeg" } });
    });
    const error = await captureError(client(stallingFetch).synthesize({ ...synthesizeInput, timeoutMs: 40 }));
    expect(error.kind).toBe("timeout");
  });

  it("re-throws the caller's abort reason unchanged", async () => {
    const controller = new AbortController();
    const reason = new Error("request cancelled by the admin");
    const pending = client(hangingFetch()).synthesize({ ...synthesizeInput, signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});

describe("retries", () => {
  it("retries listings on 5xx with backoff", async () => {
    const sleep = vi.fn(async () => undefined);
    const mock = fetchSequence(new Response("", { status: 503 }), json(200, []));
    await expect(client(mock, { maxRetries: 2, sleep }).listModels()).resolves.toEqual([]);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("gives up after maxRetries", async () => {
    const sleep = vi.fn(async () => undefined);
    const mock = fetchSequence(new Response("", { status: 500 }), new Response("", { status: 502 }), new Response("", { status: 503 }));
    expect((await captureError(client(mock, { maxRetries: 2, sleep }).listModels())).status).toBe(503);
    expect(sleep.mock.calls).toEqual([[500], [1000]]);
  });

  it("retries synthesis on 429 (nothing was generated), honouring Retry-After", async () => {
    const sleep = vi.fn(async () => undefined);
    const mock = fetchSequence(json(429, { detail: { status: "system_busy", message: "busy" } }, { "retry-after": "1" }), audio());
    await client(mock, { maxRetries: 2, sleep }).synthesize(synthesizeInput);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("never retries synthesis after a 5xx (the request may have been billed)", async () => {
    const sleep = vi.fn(async () => undefined);
    const mock = fetchSequence(new Response("", { status: 500 }), audio());
    expect((await captureError(client(mock, { maxRetries: 2, sleep }).synthesize(synthesizeInput))).kind).toBe("provider_unavailable");
    expect(mock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("listings", () => {
  it("listModels keeps TTS models without alpha access and maps fields", async () => {
    const mock = fetchSequence(
      json(200, [
        {
          model_id: "eleven_multilingual_v2",
          name: "Eleven Multilingual v2",
          description: "Stable",
          can_do_text_to_speech: true,
          maximum_text_length_per_request: 10000,
          languages: [{ language_id: "en", name: "English" }],
          model_rates: { character_cost_multiplier: 1 },
          can_use_style: true,
          can_use_speaker_boost: true,
          serves_pro_voices: false,
        },
        { model_id: "eleven_multilingual_sts_v2", name: "STS", can_do_text_to_speech: false },
        { model_id: "eleven_secret_alpha", name: "Alpha", can_do_text_to_speech: true, requires_alpha_access: true },
      ]),
    );
    expect(await client(mock).listModels()).toEqual([
      {
        modelId: "eleven_multilingual_v2",
        name: "Eleven Multilingual v2",
        description: "Stable",
        languages: [{ id: "en", name: "English" }],
        maxTextLength: 10000,
        costMultiplier: 1,
        canUseStyle: true,
        canUseSpeakerBoost: true,
      },
    ]);
    expect(requestOf(mock).url.pathname).toBe("/v1/models");
  });

  it("listVoices follows next_page_token and stops at the page cap", async () => {
    const page = (ids: string[], next: string | null) =>
      json(200, {
        voices: ids.map((id) => ({ voice_id: id, name: `Voice ${id}`, category: "premade", labels: { accent: "british" } })),
        has_more: next !== null,
        next_page_token: next,
        total_count: 999,
      });
    const mock = fetchSequence(page(["a", "b"], "t1"), page(["c"], "t2"), page(["d"], null));
    const voices = await client(mock).listVoices({ maxPages: 2, search: "calm" });

    expect(voices.map((voice) => voice.voiceId)).toEqual(["a", "b", "c"]);
    expect(voices[0]).toEqual({
      voiceId: "a",
      name: "Voice a",
      category: "premade",
      description: null,
      labels: { accent: "british" },
      previewUrl: null,
      verifiedLanguages: [],
    });
    expect(mock).toHaveBeenCalledTimes(2);
    const first = requestOf(mock, 0).url;
    expect(first.pathname).toBe("/v2/voices");
    expect(Object.fromEntries(first.searchParams)).toEqual({ page_size: "100", include_total_count: "false", search: "calm" });
    expect(requestOf(mock, 1).url.searchParams.get("next_page_token")).toBe("t1");
  });

  it("rejects an unexpected response shape as provider_unavailable", async () => {
    expect((await captureError(client(fetchSequence(json(200, { models: [] }))).listModels())).kind).toBe("provider_unavailable");
    const notJson = new Response("not json", { status: 200, headers: { "content-type": "application/json" } });
    expect((await captureError(client(fetchSequence(notJson)).listModels())).kind).toBe("provider_unavailable");
  });

  it("getSubscription maps the quota fields", async () => {
    const mock = fetchSequence(
      json(200, { tier: "creator", status: "active", character_count: 1200, character_limit: 100000, next_character_count_reset_unix: 1790000000 }),
    );
    expect(await client(mock).getSubscription()).toEqual({
      tier: "creator",
      status: "active",
      characterCount: 1200,
      characterLimit: 100000,
      nextResetUnix: 1790000000,
    });
    expect(requestOf(mock).url.pathname).toBe("/v1/user/subscription");
  });
});

describe("configuration and error mapping", () => {
  it("refuses to build a client without a key", () => {
    expect(() => createElevenLabsClient({ apiKey: "  " })).toThrow(ElevenLabsError);
    try {
      createElevenLabsClient({ apiKey: "" });
    } catch (error) {
      expect((error as ElevenLabsError).kind).toBe("not_configured");
    }
  });

  it("getElevenLabsClient reads ELEVENLABS_API_KEY", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(() => getElevenLabsClient()).toThrow(/not configured/);
    vi.stubEnv("ELEVENLABS_API_KEY", API_KEY);
    expect(getElevenLabsClient()).toHaveProperty("synthesize");
  });

  it("maps kinds onto API error codes with honest messages", () => {
    const quota = new ElevenLabsError("quota", "ElevenLabs 401 (quota_exceeded): This request exceeds your quota.", {
      status: 401,
      requestId: "abc",
    });
    expect(elevenLabsErrorToApi(quota)).toEqual({
      status: 502,
      code: "tts_failed",
      message:
        "ElevenLabs refused the request because of the account's plan or remaining credits: This request exceeds your quota. " +
        "(ElevenLabs request id: abc)",
    });
    expect(elevenLabsErrorToApi(new ElevenLabsError("auth", "x")).code).toBe("tts_not_configured");
    expect(elevenLabsErrorToApi(new ElevenLabsError("not_configured", "x")).code).toBe("tts_not_configured");
    expect(elevenLabsErrorToApi(new ElevenLabsError("rate_limited", "x"))).toMatchObject({ status: 429, code: "rate_limited" });
    expect(elevenLabsErrorToApi(new ElevenLabsError("validation", "x")).code).toBe("invalid_request");
    expect(elevenLabsErrorToApi(new ElevenLabsError("voice_not_found", "x"))).toMatchObject({
      code: "invalid_request",
      fields: { voiceId: expect.stringContaining("voice") },
    });
    expect(elevenLabsErrorToApi(new ElevenLabsError("timeout", "x"))).toMatchObject({ status: 504, code: "tts_failed" });
    expect(describeElevenLabsError(new ElevenLabsError("provider_unavailable", "x"))).toContain("temporarily unavailable");
  });
});
