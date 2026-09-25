import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GENRE_COVER_BUCKET, loadPlayerBootstrap, loadSupportContact, PlayerDataError } from "@/lib/data/player";
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
  businessContext,
  businessRow,
  GENRE_HIDDEN,
  GENRE_JAZZ,
  GENRE_LOUNGE,
  genreRow,
  OTHER_BUSINESS_ID,
  platformSettingsRow,
  preferencesRow,
  USER_ID,
} from "./helpers";

const GENRE_AMBIENT = "a0000000-0000-4000-8000-000000000004";
const JAZZ_COVER = `${GENRE_JAZZ}/0123456789abcdef0123456789abcdef.webp`;
const LOUNGE_COVER = `${GENRE_LOUNGE}/fedcba9876543210fedcba9876543210.jpg`;

function fakeWith(options: FakeSupabaseOptions = {}): FakeSupabase {
  return new FakeSupabase({
    rpc: {
      genre_track_counts: {
        data: [
          { genre_id: GENRE_JAZZ, playable_count: 12, total_count: 12 },
          { genre_id: GENRE_LOUNGE, playable_count: 3, total_count: 3 },
        ],
        error: null,
      },
    },
    ...options,
    tables: {
      businesses: [businessRow({ announcement_volume: "0.65", announcement_every_n_tracks: 5, announcement_language: "bg" })],
      genres: [
        genreRow(GENRE_LOUNGE, { name: "Lounge", slug: "lounge", sort_order: 2 }),
        genreRow(GENRE_JAZZ, { name: "Jazz", slug: "jazz", sort_order: 1, description: "Late-night jazz" }),
        genreRow(GENRE_AMBIENT, { name: "Ambient", slug: "ambient", sort_order: 2 }),
      ],
      playback_preferences: [],
      announcements: [],
      ...options.tables,
    },
  });
}

/** Genres with covers: Jazz and Lounge have objects, Ambient has none. */
function coveredGenres() {
  return [
    genreRow(GENRE_LOUNGE, { name: "Lounge", slug: "lounge", sort_order: 2, cover_path: LOUNGE_COVER }),
    genreRow(GENRE_JAZZ, { name: "Jazz", slug: "jazz", sort_order: 1, cover_path: JAZZ_COVER }),
    genreRow(GENRE_AMBIENT, { name: "Ambient", slug: "ambient", sort_order: 2 }),
  ];
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPlayerBootstrap", () => {
  it("maps the venue, genres (sort_order, then name) and track counts", async () => {
    const fake = fakeWith();

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.userId).toBe(USER_ID);
    expect(bootstrap.business).toEqual({
      id: BUSINESS_ID,
      name: "EmeraldBar",
      stationName: "EmeraldBar Radio",
      type: "bar",
      logoUrl: expect.stringContaining(`logos/${BUSINESS_ID}/logo.png`),
      language: "bg",
      announcementEveryNTracks: 5,
      announcementVolume: 0.65,
    });
    expect(bootstrap.genres).toEqual([
      { id: GENRE_JAZZ, name: "Jazz", slug: "jazz", description: "Late-night jazz", trackCount: 12, coverUrl: null },
      { id: GENRE_AMBIENT, name: "Ambient", slug: "ambient", description: null, trackCount: 0, coverUrl: null },
      { id: GENRE_LOUNGE, name: "Lounge", slug: "lounge", description: null, trackCount: 3, coverUrl: null },
    ]);
    expect(fake.rpcCalls).toEqual(["genre_track_counts"]);
    expect(fake.signCalls).toEqual([expect.objectContaining({ bucket: "logos", path: `${BUSINESS_ID}/logo.png` })]);
    expect(fake.queriesFor("businesses")[0].filters).toEqual([{ op: "eq", column: "id", value: BUSINESS_ID }]);
  });

  it.each(["cafe", "restaurant", "hotel", "bar", "other"] as const)("passes business type %s through", async (type) => {
    const fake = fakeWith({ tables: { businesses: [businessRow({ business_type: type })] } });
    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());
    expect(bootstrap.business.type).toBe(type);
  });

  it("shows an unknown or missing business type as 'other'", async () => {
    for (const value of ["nightclub", null, 7]) {
      const fake = fakeWith({ tables: { businesses: [businessRow({ business_type: value })] } });
      const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());
      expect(bootstrap.business.type).toBe("other");
    }
  });

  it("uses the column defaults when the user has no saved preferences", async () => {
    const bootstrap = await loadPlayerBootstrap(fakeWith().client, businessContext());
    expect(bootstrap.preferences).toEqual({ genreId: null, volume: 0.8, muted: false });
  });

  it("returns saved preferences for a genre that is still visible", async () => {
    const fake = fakeWith({
      tables: { playback_preferences: [preferencesRow({ genre_id: GENRE_LOUNGE, volume: "0.450", muted: true })] },
    });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.preferences).toEqual({ genreId: GENRE_LOUNGE, volume: 0.45, muted: true });
    expect(fake.queriesFor("playback_preferences")[0].filters).toEqual([
      { op: "eq", column: "user_id", value: USER_ID },
      { op: "eq", column: "business_id", value: BUSINESS_ID },
    ]);
  });

  it("drops a saved genre that is no longer visible but keeps volume and mute", async () => {
    const fake = fakeWith({ tables: { playback_preferences: [preferencesRow({ genre_id: GENRE_HIDDEN, volume: 0.3, muted: true })] } });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.preferences).toEqual({ genreId: null, volume: 0.3, muted: true });
  });

  it("counts playable announcements by use at the current branding version only", async () => {
    const fake = fakeWith({
      tables: {
        announcements: [
          announcementRow(ANN_WELCOME, { placement: "welcome" }),
          announcementRow(ANN_ROTATION, { placement: "rotation" }),
          announcementRow(ANN_BOTH, { placement: "both" }),
          announcementRow(ANN_STALE, { placement: "rotation", branding_version: BRANDING_VERSION - 1 }),
          announcementRow("c0000000-0000-4000-8000-000000000010", { placement: "welcome", needs_review: true }),
          announcementRow("c0000000-0000-4000-8000-000000000011", { placement: "rotation", status: "ready" }),
          announcementRow(ANN_OTHER_BUSINESS, { placement: "both", business_id: OTHER_BUSINESS_ID }),
        ],
      },
    });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.announcementCounts).toEqual({ welcome: 2, rotation: 2 });
  });

  it("lists the venue's own playable announcements with their text (same rule as the announcements route)", async () => {
    const fake = fakeWith({
      tables: {
        announcements: [
          announcementRow(ANN_ROTATION, {
            placement: "rotation",
            text: "You’re listening to EmeraldBar Radio.",
            spoken_text: "You’re listening to Emerald Bar Radio.",
            audio_duration_seconds: "5.75",
            created_at: "2026-09-03T11:00:00.000Z",
          }),
          announcementRow(ANN_WELCOME, {
            placement: "welcome",
            text: "Welcome to EmeraldBar.",
            audio_duration_seconds: null,
            created_at: "2026-09-03T09:00:00.000Z",
          }),
          announcementRow(ANN_STALE, { text: "Old branding wording", branding_version: BRANDING_VERSION - 1 }),
          announcementRow(ANN_BOTH, { text: "Needs review wording", needs_review: true }),
          announcementRow("c0000000-0000-4000-8000-000000000011", { text: "Ready, not approved", status: "ready" }),
          announcementRow("c0000000-0000-4000-8000-000000000012", { text: "No audio yet", status: "draft", audio_path: null }),
          announcementRow(ANN_OTHER_BUSINESS, { text: "Welcome to Hotel Aurora.", business_id: OTHER_BUSINESS_ID }),
        ],
      },
    });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.announcements).toEqual([
      { id: ANN_WELCOME, placement: "welcome", durationSeconds: null, text: "Welcome to EmeraldBar." },
      { id: ANN_ROTATION, placement: "rotation", durationSeconds: 5.75, text: "You’re listening to EmeraldBar Radio." },
    ]);
    expect(bootstrap.announcementCounts).toEqual({ welcome: 1, rotation: 1 });
    const raw = JSON.stringify(bootstrap);
    for (const hidden of ["Hotel Aurora", "Old branding", "Needs review", "Ready, not approved", "No audio yet", ".mp3", "Emerald Bar Radio"]) {
      expect(raw).not.toContain(hidden);
    }
    const [query] = fake.queriesFor("announcements");
    expect(query.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "business_id", value: BUSINESS_ID },
        { op: "eq", column: "status", value: "active" },
        { op: "eq", column: "needs_review", value: false },
      ]),
    );
  });

  it("returns an empty announcement list when the venue has none", async () => {
    const bootstrap = await loadPlayerBootstrap(fakeWith().client, businessContext());
    expect(bootstrap.announcements).toEqual([]);
    expect(bootstrap.announcementCounts).toEqual({ welcome: 0, rotation: 0 });
  });

  it("returns logoUrl null without signing when the venue has no logo", async () => {
    const fake = fakeWith({ tables: { businesses: [businessRow({ logo_path: null })] } });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.business.logoUrl).toBeNull();
    expect(fake.signCalls).toHaveLength(0);
  });

  it("never fails because of the logo: a signing error yields logoUrl null", async () => {
    const fake = fakeWith({ sign: () => ({ data: null, error: { message: "Object not found", statusCode: "404" } }) });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.business.logoUrl).toBeNull();
    expect(bootstrap.genres).toHaveLength(3);
  });

  it("never fails because of the logo: a thrown Storage error yields logoUrl null", async () => {
    const fake = fakeWith({
      sign: () => {
        throw new TypeError("fetch failed");
      },
    });
    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());
    expect(bootstrap.business.logoUrl).toBeNull();
  });

  it("returns an empty genre list for a venue without visible genres", async () => {
    const fake = fakeWith({ tables: { genres: [] }, rpc: { genre_track_counts: { data: [], error: null } } });
    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());
    expect(bootstrap.genres).toEqual([]);
    expect(fake.batchSignCalls).toHaveLength(0);
  });

  it("throws PlayerDataError when the venue row is not visible", async () => {
    const fake = fakeWith({ tables: { businesses: [] } });
    await expect(loadPlayerBootstrap(fake.client, businessContext())).rejects.toBeInstanceOf(PlayerDataError);
  });

  it("throws PlayerDataError (with the database error as cause) when a query fails", async () => {
    const failure = pgError("57014", "statement timeout");
    const fake = fakeWith({ failTables: { genres: failure } });

    const error = await loadPlayerBootstrap(fake.client, businessContext()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PlayerDataError);
    expect((error as PlayerDataError).cause).toBe(failure);
  });

  it("throws PlayerDataError when the track-count RPC fails", async () => {
    const fake = fakeWith({ rpc: { genre_track_counts: { data: null, error: pgError("42883", "function does not exist") } } });
    await expect(loadPlayerBootstrap(fake.client, businessContext())).rejects.toBeInstanceOf(PlayerDataError);
  });
});

describe("loadPlayerBootstrap genre covers", () => {
  it("signs every cover in one batch request on the genre-covers bucket with the user's client", async () => {
    const fake = fakeWith({ tables: { genres: coveredGenres() } });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(fake.batchSignCalls).toHaveLength(1);
    const [call] = fake.batchSignCalls;
    expect(call.bucket).toBe(GENRE_COVER_BUCKET);
    expect(call.bucket).toBe("genre-covers");
    expect([...call.paths].sort()).toEqual([JAZZ_COVER, LOUNGE_COVER].sort());
    // Same lifetime policy as other decoration (the configured baseline TTL, 900–43200 s).
    expect(call.expiresIn).toBeGreaterThanOrEqual(900);
    expect(call.expiresIn).toBeLessThanOrEqual(43_200);

    const byId = new Map(bootstrap.genres.map((genre) => [genre.id, genre.coverUrl]));
    expect(byId.get(GENRE_JAZZ)).toBe(`https://storage.test/object/sign/genre-covers/${JAZZ_COVER}?token=signed&ttl=${call.expiresIn}`);
    expect(byId.get(GENRE_LOUNGE)).toContain(`genre-covers/${LOUNGE_COVER}`);
    expect(byId.get(GENRE_AMBIENT)).toBeNull();
    // Single-object signing is only used for the logo.
    expect(fake.signCalls.map((c) => c.bucket)).toEqual(["logos"]);
  });

  it("does not call Storage for covers when no genre has one", async () => {
    const fake = fakeWith();
    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());
    expect(fake.batchSignCalls).toHaveLength(0);
    expect(bootstrap.genres.every((genre) => genre.coverUrl === null)).toBe(true);
  });

  it("signs a cover path shared by two genres once", async () => {
    const fake = fakeWith({
      tables: {
        genres: [
          genreRow(GENRE_JAZZ, { name: "Jazz", slug: "jazz", sort_order: 1, cover_path: JAZZ_COVER }),
          genreRow(GENRE_LOUNGE, { name: "Lounge", slug: "lounge", sort_order: 2, cover_path: JAZZ_COVER }),
        ],
      },
    });
    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());
    expect(fake.batchSignCalls[0].paths).toEqual([JAZZ_COVER]);
    expect(bootstrap.genres.map((genre) => genre.coverUrl)).toEqual([expect.any(String), expect.any(String)]);
  });

  it("returns null for a cover Storage refuses or cannot find, keeping the others", async () => {
    // Only the Jazz object is visible (RLS-hidden or deleted objects come back as per-path errors).
    const fake = fakeWith({ tables: { genres: coveredGenres() }, objects: { "genre-covers": [JAZZ_COVER] } });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    const byId = new Map(bootstrap.genres.map((genre) => [genre.id, genre.coverUrl]));
    expect(byId.get(GENRE_JAZZ)).toContain(JAZZ_COVER);
    expect(byId.get(GENRE_LOUNGE)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns null covers (and still loads) when the batch request fails", async () => {
    const fake = fakeWith({
      tables: { genres: coveredGenres() },
      signBatch: () => ({ data: null, error: { message: "Internal Server Error", statusCode: "500" } }),
    });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.genres.map((genre) => genre.coverUrl)).toEqual([null, null, null]);
    expect(bootstrap.business.logoUrl).not.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns null covers (and still loads) when Storage cannot be reached", async () => {
    const fake = fakeWith({
      tables: { genres: coveredGenres() },
      signBatch: () => {
        throw new TypeError("fetch failed");
      },
    });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.genres.map((genre) => genre.coverUrl)).toEqual([null, null, null]);
    expect(bootstrap.genres).toHaveLength(3);
  });

  it("ignores entries without a URL or for paths it did not ask for", async () => {
    const fake = fakeWith({
      tables: { genres: coveredGenres() },
      signBatch: () => ({
        data: [
          { error: null, path: JAZZ_COVER, signedURL: null, signedUrl: null },
          { error: null, path: "someone-else/cover.png", signedURL: "/x", signedUrl: "https://storage.test/x" },
          { error: null, path: LOUNGE_COVER, signedURL: "/lounge", signedUrl: "https://storage.test/lounge" },
        ],
        error: null,
      }),
    });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    const byId = new Map(bootstrap.genres.map((genre) => [genre.id, genre.coverUrl]));
    expect(byId.get(GENRE_JAZZ)).toBeNull();
    expect(byId.get(GENRE_LOUNGE)).toBe("https://storage.test/lounge");
    expect(JSON.stringify(bootstrap)).not.toContain("someone-else");
  });
});

describe("loadPlayerBootstrap support contact", () => {
  it("returns the owner's contact email and phone from platform_settings", async () => {
    const fake = fakeWith({
      tables: { platform_settings: [platformSettingsRow({ contact_email: " hello@frekvencija.online ", contact_phone: "+389 70 123 456" })] },
    });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.support).toEqual({ email: "hello@frekvencija.online", phone: "+389 70 123 456" });
    expect(fake.queriesFor("platform_settings")[0]).toMatchObject({
      columns: "contact_email, contact_phone",
      filters: [{ op: "eq", column: "id", value: true }],
    });
    // Policy text and defaults are not part of the venue bootstrap.
    expect(JSON.stringify(bootstrap)).not.toContain("default_announcement");
  });

  it("returns nulls when the details are not configured", async () => {
    const fake = fakeWith({ tables: { platform_settings: [platformSettingsRow({ contact_email: "   ", contact_phone: null })] } });
    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());
    expect(bootstrap.support).toEqual({ email: null, phone: null });
  });

  it("returns nulls when the settings row is missing", async () => {
    const bootstrap = await loadPlayerBootstrap(fakeWith().client, businessContext());
    expect(bootstrap.support).toEqual({ email: null, phone: null });
  });

  it("never fails because of the contact details: an unreadable table yields nulls", async () => {
    const fake = fakeWith({ failTables: { platform_settings: pgError("PGRST205", "Could not find the table 'public.platform_settings'") } });

    const bootstrap = await loadPlayerBootstrap(fake.client, businessContext());

    expect(bootstrap.support).toEqual({ email: null, phone: null });
    expect(bootstrap.genres).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
  });

  it("loadSupportContact never throws, even when the client itself throws", async () => {
    const throwing = {
      from: () => {
        throw new TypeError("fetch failed");
      },
    } as unknown as FakeSupabase["client"];
    await expect(loadSupportContact(throwing)).resolves.toEqual({ email: null, phone: null });
  });
});
