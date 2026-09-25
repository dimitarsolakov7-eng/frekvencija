import { describe, expect, it } from "vitest";
import { createPlayerApi } from "@/lib/player/api-client";
import { PlayerApiError } from "@/lib/player/types";

interface Recorded {
  url: string;
  init: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeFetch(respond: (url: string, init: RequestInit, call: number) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {}, calls.length);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function expectApiError(promise: Promise<unknown>): Promise<PlayerApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PlayerApiError);
    return error as PlayerApiError;
  }
  throw new Error("expected the call to fail");
}

const tracksBody = {
  genreId: "g1",
  tracks: [{ id: "t1", title: "One", artist: "A", durationSeconds: 200 }],
  fetchedAt: "2026-09-25T12:00:00.000Z",
};

describe("createPlayerApi", () => {
  it("GETs the genre track list with same-origin credentials and no caching", async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, tracksBody));
    const api = createPlayerApi({ fetch: fetchImpl, baseUrl: "https://venue.test/" });
    await expect(api.getGenreTracks("g 1")).resolves.toEqual(tracksBody);
    expect(calls[0].url).toBe("https://venue.test/api/player/genres/g%201/tracks");
    expect(calls[0].init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store" });
  });

  it("POSTs sign requests as JSON and validates the response", async () => {
    const signed = { kind: "track", id: "t1", url: "https://cdn/x", expiresAt: "2026-09-25T14:00:00.000Z", durationSeconds: 200, title: "One", artist: "A" };
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, signed));
    const api = createPlayerApi({ fetch: fetchImpl });
    await expect(api.signMedia({ kind: "track", id: "t1", genreId: "g1" })).resolves.toEqual(signed);
    expect(calls[0].url).toBe("/api/media/sign");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ kind: "track", id: "t1", genreId: "g1" });
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("parses announcements and preferences responses", async () => {
    const announcements = {
      announcements: [{ id: "a1", placement: "both", durationSeconds: null, text: "You’re listening to EmeraldBar Radio." }],
      settings: { everyNTracks: 3, volume: 0.7 },
      brandingVersion: 2,
      fetchedAt: "x",
    };
    const { fetchImpl } = fakeFetch((url) =>
      url.endsWith("/announcements")
        ? jsonResponse(200, announcements)
        : jsonResponse(200, { preferences: { genreId: null, volume: 0.5, muted: true } }),
    );
    const api = createPlayerApi({ fetch: fetchImpl });
    await expect(api.getAnnouncements()).resolves.toEqual(announcements);
    await expect(api.savePreferences({ muted: true })).resolves.toEqual({ genreId: null, volume: 0.5, muted: true });
  });

  it("requires each announcement's display text to be a string", async () => {
    const settings = { everyNTracks: 3, volume: 0.7 };
    for (const entry of [
      { id: "a1", placement: "rotation", durationSeconds: 5 },
      { id: "a1", placement: "rotation", durationSeconds: 5, text: null },
      { id: "a1", placement: "rotation", durationSeconds: 5, text: 42 },
    ]) {
      const { fetchImpl } = fakeFetch(() => jsonResponse(200, { announcements: [entry], settings, brandingVersion: 1, fetchedAt: "x" }));
      expect((await expectApiError(createPlayerApi({ fetch: fetchImpl }).getAnnouncements())).kind).toBe("server");
    }
    // Only the declared fields are kept (no stray properties reach the engine).
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(200, {
        announcements: [{ id: "a1", placement: "welcome", durationSeconds: 4, text: "", audioPath: "x.mp3" }],
        settings,
        brandingVersion: 1,
        fetchedAt: "x",
      }),
    );
    await expect(createPlayerApi({ fetch: fetchImpl }).getAnnouncements()).resolves.toMatchObject({
      announcements: [{ id: "a1", placement: "welcome", durationSeconds: 4, text: "" }],
    });
    const parsed = await createPlayerApi({ fetch: fetchImpl }).getAnnouncements();
    expect(Object.keys(parsed.announcements[0]).sort()).toEqual(["durationSeconds", "id", "placement", "text"]);
  });

  it.each([
    [403, "forbidden"],
    [404, "unavailable"],
    [410, "unavailable"],
    [429, "rate_limited"],
    [500, "server"],
    [503, "server"],
    [400, "server"],
  ] as const)("maps HTTP %i to %s and keeps the body's error code", async (status, kind) => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(status, { error: { code: "business_inactive", message: "Nope" } }));
    const error = await expectApiError(createPlayerApi({ fetch: fetchImpl }).getAnnouncements());
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.code).toBe("business_inactive");
    expect(error.message).toBe("Nope");
  });

  it("retries a 401 once (refresh-token race), then reports auth", async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(401, { error: { code: "unauthenticated", message: "Sign in" } }));
    const error = await expectApiError(createPlayerApi({ fetch: fetchImpl }).getGenreTracks("g1"));
    expect(error.kind).toBe("auth");
    expect(calls).toHaveLength(2);
  });

  it("succeeds when the retried 401 request succeeds", async () => {
    const { calls, fetchImpl } = fakeFetch((_url, _init, call) =>
      call === 1 ? jsonResponse(401, { error: { code: "unauthenticated", message: "x" } }) : jsonResponse(200, tracksBody),
    );
    await expect(createPlayerApi({ fetch: fetchImpl }).getGenreTracks("g1")).resolves.toEqual(tracksBody);
    expect(calls).toHaveLength(2);
  });

  it("treats malformed JSON and wrong shapes as server errors", async () => {
    const bad = [
      "not json",
      { genreId: "g1", tracks: [{ id: "t1" }] },
      { genreId: "g1" },
    ];
    for (const body of bad) {
      const { fetchImpl } = fakeFetch(() => jsonResponse(200, body));
      const error = await expectApiError(createPlayerApi({ fetch: fetchImpl }).getGenreTracks("g1"));
      expect(error.kind).toBe("server");
    }
    const { fetchImpl } = fakeFetch(() => jsonResponse(200, { kind: "track", id: "t1", url: "", expiresAt: "x", durationSeconds: 1 }));
    expect((await expectApiError(createPlayerApi({ fetch: fetchImpl }).signMedia({ kind: "announcement", id: "a" }))).kind).toBe("server");
  });

  it("maps fetch TypeError to a network error", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const error = await expectApiError(createPlayerApi({ fetch: fetchImpl }).getAnnouncements());
    expect(error.kind).toBe("network");
    expect(error.status).toBeNull();
  });

  it("times out as a network error", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const error = await expectApiError(createPlayerApi({ fetch: fetchImpl, timeoutMs: 20 }).getAnnouncements());
    expect(error.kind).toBe("network");
    expect(error.message).toMatch(/timed out/i);
  });

  it("passes the caller's AbortSignal through and rethrows the AbortError", async () => {
    let seenSignal: AbortSignal | null = null;
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        seenSignal = init?.signal ?? null;
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const controller = new AbortController();
    const pending = createPlayerApi({ fetch: fetchImpl }).getGenreTracks("g1", controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(seenSignal).not.toBeNull();
    expect((seenSignal as unknown as AbortSignal).aborted).toBe(true);
  });

  it("does not call fetch when the signal is already aborted", async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, tracksBody));
    const controller = new AbortController();
    controller.abort();
    await expect(createPlayerApi({ fetch: fetchImpl }).getGenreTracks("g1", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
  });
});
