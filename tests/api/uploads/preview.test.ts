import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPreviewResponse } from "@/lib/api/contracts";
import { FakeSupabase } from "./fake-supabase";
import {
  ACTIVE_ANNOUNCEMENT_ID,
  ACTIVE_ANNOUNCEMENT_PATH,
  ADMIN_ID,
  DRAFT_ANNOUNCEMENT_ID,
  errorOf,
  jsonRequest,
  REMOVED_TRACK_ID,
  REMOVED_TRACK_PATH,
  seedWorld,
  TRACK_ID,
  TRACK_PATH,
  UNKNOWN_ID,
  VENUE_USER_ID,
} from "./fixtures";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeSupabase }));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => h.db.client("user") }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => h.db.client("admin") }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { POST } = await import("@/app/api/admin/media/preview/route");

function preview(body: unknown, contentType?: string) {
  return POST(jsonRequest("/api/admin/media/preview", body, { contentType }));
}

async function previewOk(body: unknown): Promise<AdminPreviewResponse> {
  const response = await preview(body);
  if (response.status !== 200) throw new Error(`expected 200, got ${response.status}: ${await response.text()}`);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return (await response.json()) as AdminPreviewResponse;
}

beforeEach(() => {
  h.db = new FakeSupabase();
  seedWorld(h.db);
  h.db.currentUserId = ADMIN_ID;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/admin/media/preview", () => {
  it("answers 401 when signed out and 403 for a venue user", async () => {
    h.db.currentUserId = null;
    expect(await errorOf(await preview({ kind: "track", id: TRACK_ID }))).toMatchObject({ status: 401, code: "unauthenticated" });
    h.db.currentUserId = VENUE_USER_ID;
    expect(await errorOf(await preview({ kind: "track", id: TRACK_ID }))).toMatchObject({ status: 403, code: "forbidden" });
    expect(h.db.events).toEqual([]);
  });

  it("validates the body", async () => {
    expect(await errorOf(await preview({ kind: "logo", id: TRACK_ID }))).toMatchObject({ status: 400, code: "invalid_request" });
    expect(await errorOf(await preview({ kind: "track", id: "not-a-uuid" }))).toMatchObject({ status: 400, code: "invalid_request" });
    expect(await errorOf(await preview({ kind: "track", id: TRACK_ID }, "text/plain"))).toMatchObject({ status: 415 });
  });

  it("signs a track with the admin's own client for longer than the track lasts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 8, 25, 12, 0, 0));
    const body = await previewOk({ kind: "track", id: TRACK_ID });
    expect(body.url).toContain(`/object/sign/music/${TRACK_PATH}?token=read-jwt`);
    expect(h.db.events).toEqual([`storage:user:createSignedUrl:music/${TRACK_PATH}`]);
    // Default MEDIA_URL_TTL_SECONDS (7200 s) covers a 120.5 s track.
    expect(body.expiresAt).toBe(new Date(Date.UTC(2026, 8, 25, 14, 0, 0)).toISOString());
  });

  it("previews disabled and removed tracks too", async () => {
    const body = await previewOk({ kind: "track", id: REMOVED_TRACK_ID });
    expect(body.url).toContain(REMOVED_TRACK_PATH);
  });

  it("answers 404 for an unknown track", async () => {
    expect(await errorOf(await preview({ kind: "track", id: UNKNOWN_ID }))).toMatchObject({ status: 404, code: "not_found" });
  });

  it("signs announcement audio whatever the status", async () => {
    const body = await previewOk({ kind: "announcement", id: ACTIVE_ANNOUNCEMENT_ID });
    expect(body.url).toContain(`/object/sign/announcements/${ACTIVE_ANNOUNCEMENT_PATH}`);
    expect(h.db.events).toEqual([`storage:user:createSignedUrl:announcements/${ACTIVE_ANNOUNCEMENT_PATH}`]);
  });

  it("answers 404 for an announcement without audio or an unknown one", async () => {
    const noAudio = await errorOf(await preview({ kind: "announcement", id: DRAFT_ANNOUNCEMENT_ID }));
    expect(noAudio).toMatchObject({ status: 404, code: "not_found" });
    expect(noAudio.message).toContain("no audio yet");
    expect(await errorOf(await preview({ kind: "announcement", id: UNKNOWN_ID }))).toMatchObject({ status: 404, code: "not_found" });
    expect(h.db.events).toEqual([]);
  });

  it("answers 404 when the object is missing from storage", async () => {
    h.db.objects.delete(`music/${TRACK_PATH}`);
    const error = await errorOf(await preview({ kind: "track", id: TRACK_ID }));
    expect(error).toMatchObject({ status: 404, code: "not_found" });
    expect(error.message).toContain("missing from storage");
  });

  it("answers 500 for other signing failures and 403 for an RLS refusal on the lookup", async () => {
    h.db.failNext("storage:createSignedUrl", { message: "boom", status: 500, statusCode: "500" });
    expect(await errorOf(await preview({ kind: "track", id: TRACK_ID }))).toMatchObject({ status: 500, code: "server_error" });

    h.db.failNext("db:tracks:select", { code: "42501", message: "permission denied for table tracks" });
    expect(await errorOf(await preview({ kind: "track", id: TRACK_ID }))).toMatchObject({ status: 403, code: "forbidden" });
  });
});
