import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeClient, signedCoverUrl, type GenreRow } from "./fakes";
import {
  canStoreAccessRequests,
  DEFAULT_PUBLIC_GENRES,
  getPublicViewer,
  insertAccessRequest,
  loadPublicGenres,
  loadPublicSettings,
  PUBLIC_COVER_URL_TTL_SECONDS,
  PUBLIC_GENRE_LIMIT,
} from "@/lib/data/public";
import { defaultGenreArtwork } from "@/lib/brand/genre-artwork";
import { SessionLookupError } from "@/lib/auth/session";
import { policyParagraphs } from "@/components/public/policy-text";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSessionContext: mocks.getSessionContext,
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

function configure({ secret = true }: { secret?: boolean } = {}) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", secret ? "fake_secret_test" : "");
}

const ROWS: GenreRow[] = [
  { id: "g-house", slug: "house", name: "House", description: "Uplifting.", cover_path: "g-house/a.webp" },
  { id: "g-jazz", slug: "jazz", name: "Jazz", description: "  ", cover_path: null },
  { id: "g-lounge", slug: "lounge", name: "Lounge", description: null, cover_path: "g-lounge/b.png" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadPublicGenres — fallback", () => {
  it("shows the design's default genres when Supabase is not configured, without creating a client", async () => {
    const result = await loadPublicGenres();
    expect(result.source).toBe("default");
    expect(result.genres.map((genre) => genre.name)).toEqual(["House", "Lounge", "Jazz", "Deep House", "Balkan Hits", "Chillout"]);
    expect(result.genres.find((genre) => genre.slug === "balkan-hits")?.description).toBe(
      "Modern Balkan sounds for great energy.",
    );
    expect(result.genres.every((genre) => genre.artworkUrl === defaultGenreArtwork(genre.slug))).toBe(true);
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("falls back to the defaults when the secret key is missing", async () => {
    configure({ secret: false });
    expect((await loadPublicGenres()).source).toBe("default");
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("falls back to the defaults when the catalogue has no public genres or the query fails", async () => {
    expect((await loadPublicGenres({ client: createFakeClient({ genres: { data: [], error: null } }).client })).source).toBe(
      "default",
    );
    const failing = createFakeClient({ genres: { data: null, error: { message: "boom" } } });
    const result = await loadPublicGenres({ client: failing.client });
    expect(result.source).toBe("default");
    expect(failing.createSignedUrls).not.toHaveBeenCalled();
  });

  it("returns fresh copies of the defaults (callers cannot mutate the shared list)", async () => {
    const first = await loadPublicGenres();
    first.genres[0].name = "Changed";
    expect(DEFAULT_PUBLIC_GENRES[0].name).toBe("House");
  });

  it("falls back when the secret-key client cannot be created", async () => {
    configure();
    mocks.createSupabaseAdminClient.mockImplementation(() => {
      throw new Error("no client");
    });
    expect((await loadPublicGenres()).source).toBe("default");
  });
});

describe("loadPublicGenres — catalogue", () => {
  it("reads only enabled genres available to every venue, in order, with the secret-key client", async () => {
    configure();
    const fake = createFakeClient({ genres: { data: ROWS, error: null } });
    mocks.createSupabaseAdminClient.mockReturnValue(fake.client);

    const result = await loadPublicGenres();

    expect(result.source).toBe("catalogue");
    expect(fake.from).toHaveBeenCalledTimes(1);
    expect(fake.from).toHaveBeenCalledWith("genres");
    const genreCalls = fake.calls.filter((call) => call.table === "genres");
    expect(genreCalls).toEqual([
      { table: "genres", method: "select", args: ["id, slug, name, description, cover_path"] },
      { table: "genres", method: "eq", args: ["is_enabled", true] },
      { table: "genres", method: "eq", args: ["available_to_all", true] },
      { table: "genres", method: "order", args: ["sort_order", { ascending: true }] },
      { table: "genres", method: "order", args: ["name", { ascending: true }] },
      { table: "genres", method: "limit", args: [PUBLIC_GENRE_LIMIT] },
    ]);
    // Only name/description/artwork leave the server — never tracks.
    expect(fake.calls.some((call) => call.table === "tracks" || call.table === "track_genres")).toBe(false);
    expect(Object.keys(result.genres[0]).sort()).toEqual(["artworkUrl", "description", "key", "name", "slug"]);
  });

  it("signs owner covers in one request and uses the default artwork otherwise", async () => {
    const fake = createFakeClient({ genres: { data: ROWS, error: null } });
    const result = await loadPublicGenres({ client: fake.client });

    expect(fake.storageFrom).toHaveBeenCalledWith("genre-covers");
    expect(fake.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(fake.createSignedUrls).toHaveBeenCalledWith(["g-house/a.webp", "g-lounge/b.png"], PUBLIC_COVER_URL_TTL_SECONDS);
    expect(result.genres).toEqual([
      { key: "g-house", slug: "house", name: "House", description: "Uplifting.", artworkUrl: signedCoverUrl("g-house/a.webp") },
      { key: "g-jazz", slug: "jazz", name: "Jazz", description: null, artworkUrl: defaultGenreArtwork("jazz") },
      { key: "g-lounge", slug: "lounge", name: "Lounge", description: null, artworkUrl: signedCoverUrl("g-lounge/b.png") },
    ]);
  });

  it("keeps the genres with default artwork when signing fails (per cover or entirely)", async () => {
    const partial = createFakeClient({
      genres: { data: ROWS, error: null },
      signed: (paths) => ({
        data: paths.map((path) =>
          path === "g-house/a.webp"
            ? { path, signedUrl: null, signedURL: null, error: "Object not found" }
            : { path, signedUrl: signedCoverUrl(path), signedURL: signedCoverUrl(path), error: null },
        ),
        error: null,
      }),
    });
    const partialResult = await loadPublicGenres({ client: partial.client });
    expect(partialResult.genres[0].artworkUrl).toBe(defaultGenreArtwork("house"));
    expect(partialResult.genres[2].artworkUrl).toBe(signedCoverUrl("g-lounge/b.png"));

    const broken = createFakeClient({ genres: { data: ROWS, error: null }, signed: () => ({ data: null, error: { message: "down" } }) });
    const brokenResult = await loadPublicGenres({ client: broken.client });
    expect(brokenResult.source).toBe("catalogue");
    expect(brokenResult.genres.map((genre) => genre.artworkUrl)).toEqual(ROWS.map((row) => defaultGenreArtwork(row.slug)));
  });

  it("does not call Storage when no genre has a cover", async () => {
    const fake = createFakeClient({ genres: { data: [ROWS[1]], error: null } });
    await loadPublicGenres({ client: fake.client });
    expect(fake.createSignedUrls).not.toHaveBeenCalled();
  });
});

describe("loadPublicSettings", () => {
  it("is empty (not published) in setup mode", async () => {
    expect(await loadPublicSettings()).toEqual({
      status: "ok",
      settings: { contactEmail: null, contactPhone: null, privacyPolicy: null, termsOfService: null },
    });
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("reads the singleton row with the visitor's own client and treats blank text as unpublished", async () => {
    configure();
    const fake = createFakeClient({
      settings: {
        data: { contact_email: "hello@example.com", contact_phone: " ", privacy_policy: "Policy text", terms_of_service: "" },
        error: null,
      },
    });
    mocks.createSupabaseServerClient.mockResolvedValue(fake.client);
    expect(await loadPublicSettings()).toEqual({
      status: "ok",
      settings: { contactEmail: "hello@example.com", contactPhone: null, privacyPolicy: "Policy text", termsOfService: null },
    });
    expect(fake.calls.filter((call) => call.table === "platform_settings").map((call) => call.method)).toEqual([
      "select",
      "eq",
      "maybeSingle",
    ]);
  });

  it("reports a failed read as unavailable (not as unpublished)", async () => {
    const fake = createFakeClient({ settings: { data: null, error: { message: "boom" } } });
    expect(await loadPublicSettings({ client: fake.client })).toEqual({ status: "unavailable" });
  });
});

describe("getPublicViewer", () => {
  it("is null in setup mode without looking up a session", async () => {
    expect(await getPublicViewer()).toBeNull();
    expect(mocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("returns the role of the signed-in user", async () => {
    configure();
    mocks.getSessionContext.mockResolvedValue({ userId: "u", email: "a@b.c", role: "platform_admin", business: null });
    expect(await getPublicViewer()).toEqual({ role: "platform_admin" });
    mocks.getSessionContext.mockResolvedValue(null);
    expect(await getPublicViewer()).toBeNull();
  });

  it("treats a failed session lookup as signed out instead of failing the public page", async () => {
    configure();
    mocks.getSessionContext.mockRejectedValue(new SessionLookupError("auth_unreachable", "down"));
    expect(await getPublicViewer()).toBeNull();
  });
});

describe("access requests", () => {
  const INPUT = {
    businessName: "EmeraldBar",
    businessType: "bar" as const,
    contactName: "Ana",
    email: "ana@example.com",
    phone: null,
    message: "Evening lounge sound",
  };

  it("canStoreAccessRequests needs Supabase and the secret key", () => {
    expect(canStoreAccessRequests()).toBe(false);
    configure({ secret: false });
    expect(canStoreAccessRequests()).toBe(false);
    configure();
    expect(canStoreAccessRequests()).toBe(true);
  });

  it("inserts the request with snake_case columns and leaves the status to its 'new' default", async () => {
    const fake = createFakeClient();
    expect(await insertAccessRequest(fake.client, INPUT)).toEqual({ ok: true });
    expect(fake.from).toHaveBeenCalledWith("access_requests");
    expect(fake.inserted).toEqual([
      {
        business_name: "EmeraldBar",
        business_type: "bar",
        contact_name: "Ana",
        email: "ana@example.com",
        phone: null,
        message: "Evening lounge sound",
      },
    ]);
    expect(fake.inserted[0]).not.toHaveProperty("status");
  });

  it("maps the open-request unique violation to a duplicate and other failures to failed", async () => {
    const duplicate = createFakeClient({ insert: async () => ({ error: { code: "23505", message: "duplicate key" } }) });
    expect(await insertAccessRequest(duplicate.client, INPUT)).toEqual({ ok: false, reason: "duplicate" });

    const failing = createFakeClient({ insert: async () => ({ error: { code: "23514", message: "check" } }) });
    expect(await insertAccessRequest(failing.client, INPUT)).toEqual({ ok: false, reason: "failed" });

    const throwing = createFakeClient({
      insert: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await insertAccessRequest(throwing.client, INPUT)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("policyParagraphs", () => {
  it("splits plain text on blank lines, keeps single line breaks and drops empty paragraphs", () => {
    expect(policyParagraphs("First line\nsecond line\r\n\r\n  Second paragraph  \n\n\n\nThird")).toEqual([
      "First line\nsecond line",
      "Second paragraph",
      "Third",
    ]);
    expect(policyParagraphs("   \n\n  ")).toEqual([]);
    expect(policyParagraphs(null)).toEqual([]);
  });
});
