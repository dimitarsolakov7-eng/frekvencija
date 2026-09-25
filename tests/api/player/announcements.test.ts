import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/player/announcements/route";
import type { AnnouncementsResponse } from "@/lib/api/contracts";
import { FakeSupabase, pgError, type FakeSupabaseOptions } from "./fake-supabase";
import {
  ANN_BOTH,
  ANN_OTHER_BUSINESS,
  ANN_ROTATION,
  ANN_STALE,
  ANN_WELCOME,
  announcementRow,
  BRANDING_VERSION,
  BUSINESS_ID,
  businessRow,
  grantAccess,
  OTHER_BUSINESS_ID,
  readError,
  readOk,
} from "./helpers";

const { requireBusinessUserApi } = vi.hoisted(() => ({ requireBusinessUserApi: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireBusinessUserApi }));

function setup(options: FakeSupabaseOptions = {}): FakeSupabase {
  const fake = new FakeSupabase({
    ...options,
    tables: { businesses: [businessRow()], announcements: [], ...options.tables },
  });
  requireBusinessUserApi.mockResolvedValue(grantAccess(fake));
  return fake;
}

beforeEach(() => {
  requireBusinessUserApi.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/player/announcements", () => {
  it("returns the venue's settings as numbers and its playable announcements", async () => {
    setup({
      tables: {
        businesses: [businessRow({ announcement_every_n_tracks: 6, announcement_volume: "0.75" })],
        announcements: [
          announcementRow(ANN_WELCOME, {
            placement: "welcome",
            audio_duration_seconds: "4.25",
            created_at: "2026-09-03T09:00:00.000Z",
            text: "Welcome to EmeraldBar.",
          }),
          announcementRow(ANN_ROTATION, {
            placement: "rotation",
            audio_duration_seconds: null,
            text: "You’re listening to EmeraldBar Radio.",
            spoken_text: "You’re listening to Emerald Bar Radio.",
          }),
          announcementRow(ANN_BOTH, { placement: "both", text: "Thanks for spending your evening with us." }),
        ],
      },
    });

    const body = await readOk<AnnouncementsResponse>(await GET());

    expect(body.settings).toEqual({ everyNTracks: 6, volume: 0.75 });
    expect(body.brandingVersion).toBe(BRANDING_VERSION);
    expect(body.announcements).toEqual([
      { id: ANN_WELCOME, placement: "welcome", durationSeconds: 4.25, text: "Welcome to EmeraldBar." },
      { id: ANN_ROTATION, placement: "rotation", durationSeconds: null, text: "You’re listening to EmeraldBar Radio." },
      { id: ANN_BOTH, placement: "both", durationSeconds: 6.5, text: "Thanks for spending your evening with us." },
    ]);
    expect(Number.isNaN(Date.parse(body.fetchedAt))).toBe(false);
    // Audio paths, review state and the TTS spelling never leave the server.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(".mp3");
    expect(raw).not.toContain("Emerald Bar Radio");
    expect(raw).not.toContain("needs_review");
  });

  it("drops announcements approved at an older branding version, even when a row slips through", async () => {
    setup({
      tables: {
        announcements: [
          announcementRow(ANN_ROTATION),
          announcementRow(ANN_STALE, { branding_version: BRANDING_VERSION - 1 }),
        ],
      },
    });

    const body = await readOk<AnnouncementsResponse>(await GET());

    expect(body.announcements.map((a) => a.id)).toEqual([ANN_ROTATION]);
  });

  it("never returns another venue's, unapproved, under-review or audio-less announcements", async () => {
    const fake = setup({
      tables: {
        announcements: [
          announcementRow(ANN_ROTATION),
          announcementRow(ANN_OTHER_BUSINESS, { business_id: OTHER_BUSINESS_ID, text: "Welcome to Hotel Aurora." }),
          announcementRow(ANN_WELCOME, { status: "ready", text: "Draft wording awaiting approval." }),
          announcementRow(ANN_BOTH, { needs_review: true }),
          announcementRow(ANN_STALE, { audio_path: null, status: "draft" }),
        ],
      },
    });

    const body = await readOk<AnnouncementsResponse>(await GET());

    expect(body.announcements.map((a) => a.id)).toEqual([ANN_ROTATION]);
    // Another venue's (or an unapproved clip's) wording never reaches this venue.
    expect(JSON.stringify(body)).not.toContain("Hotel Aurora");
    expect(JSON.stringify(body)).not.toContain("Draft wording");
    const [query] = fake.queriesFor("announcements");
    expect(query.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "business_id", value: BUSINESS_ID },
        { op: "eq", column: "status", value: "active" },
        { op: "eq", column: "needs_review", value: false },
        { op: "not", column: "audio_path", operator: "is", value: null },
      ]),
    );
    expect(fake.queriesFor("businesses")[0].filters).toEqual([{ op: "eq", column: "id", value: BUSINESS_ID }]);
  });

  it("returns an empty list (with settings) when the venue has no playable announcements", async () => {
    setup();
    const body = await readOk<AnnouncementsResponse>(await GET());
    expect(body).toMatchObject({ announcements: [], settings: { everyNTracks: 4, volume: 0.9 } });
  });

  it("answers 403 no_business when the venue row is no longer visible", async () => {
    setup({ tables: { businesses: [] } });
    const error = await readError(await GET());
    expect(error).toMatchObject({ status: 403, code: "no_business" });
  });

  it("maps a database failure to a generic 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setup({ failTables: { announcements: pgError("08006", "connection failure at 10.0.0.5") } });

    const response = await GET();
    const text = await response.clone().text();

    expect(await readError(response)).toMatchObject({ status: 500, code: "server_error" });
    expect(text).not.toContain("10.0.0.5");
    expect(consoleError).toHaveBeenCalled();
  });
});
