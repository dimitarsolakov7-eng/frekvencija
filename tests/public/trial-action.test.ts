import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeHeaders, formData } from "../auth/auth-mocks";
import { createFakeClient } from "./fakes";
import { requestTrial, type TrialRequestState } from "@/app/(public)/request-access/actions";
import { getSiteCopy } from "@/content/site";
import { EnvError } from "@/lib/env";
import { GENRE_RECOMMENDATION, HONEYPOT_FIELD } from "@/lib/public/trial-request";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

const INITIAL: TrialRequestState = { ok: false, message: null, fieldErrors: {} };
const mk = getSiteCopy("mk").trial.messages;
const en = getSiteCopy("en").trial.messages;

const VALID = {
  locale: "mk",
  venueName: "  EmeraldCaffe  ",
  venueType: "cafe",
  city: " Скопје ",
  contactName: "Ана Петрова",
  email: " Ana@Example.COM ",
  phone: "",
  preferredGenre: "house",
  message: "",
};

let fake = createFakeClient();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("CLIENT_IP_HEADER", "");
  vi.stubEnv("TRUSTED_PROXY_HOPS", "");
  vi.stubEnv("VERCEL", "");
  mocks.headers.mockResolvedValue(fakeHeaders({ "x-forwarded-for": "10.9.8.7, 203.0.113.7" }));
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, degraded: false });
  // The fake has no genres, so the action offers the default genre list (house, lounge, jazz, …).
  fake = createFakeClient();
  mocks.createSupabaseAdminClient.mockImplementation(() => fake.client);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const submit = (entries: Record<string, string>) => requestTrial(INITIAL, formData(entries));

describe("requestTrial — validation", () => {
  it("returns Macedonian field errors and the typed values without rate limiting or storing anything", async () => {
    const state = await submit({ locale: "mk", venueName: " ", venueType: "", city: "", contactName: "", email: "not-an-email", preferredGenre: "", phone: "", message: "" });
    expect(state.ok).toBe(false);
    expect(state.message).toBe(mk.checkFields);
    expect(Object.keys(state.fieldErrors).sort()).toEqual(["city", "contactName", "email", "preferredGenre", "venueName", "venueType"]);
    expect(state.fieldErrors.venueType).toBe(mk.venueTypeRequired);
    expect(state.fieldErrors.preferredGenre).toBe(mk.genreRequired);
    expect(state.values).toMatchObject({ email: "not-an-email", venueType: "" });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(fake.inserted).toEqual([]);
  });

  it("answers in English when the form was shown in English", async () => {
    const state = await submit({ ...VALID, locale: "en", venueName: "" });
    expect(state.message).toBe(en.checkFields);
    expect(state.fieldErrors.venueName).toBe(en.venueNameRequired);
  });

  it("rejects unknown venue types and genres, bad phone numbers and over-long text", async () => {
    const state = await submit({ ...VALID, venueType: "nightclub", preferredGenre: "techno", phone: "call me maybe", message: "x".repeat(1001), city: "y".repeat(121) });
    expect(state.fieldErrors.venueType).toBe(mk.venueTypeRequired);
    expect(state.fieldErrors.preferredGenre).toBe(mk.genreRequired);
    expect(state.fieldErrors.phone).toBe(mk.phoneInvalid);
    expect(state.fieldErrors.message).toBe("Најмногу 1000 знаци.");
    expect(state.fieldErrors.city).toBe("Најмногу 120 знаци.");
  });

  it("accepts every venue type and the recommendation option", async () => {
    for (const venueType of ["cafe", "restaurant", "hotel", "bar", "other"]) {
      const state = await submit({ ...VALID, venueType, preferredGenre: GENRE_RECOMMENDATION, email: `${venueType}@example.com` });
      expect(state.ok, venueType).toBe(true);
    }
  });
});

describe("requestTrial — storing", () => {
  it("stores a valid request (trimmed, email lower-cased, genre by catalogue name) and reports success in Macedonian", async () => {
    const state = await submit({ ...VALID, phone: " +389 70 123 456 ", message: "  Лаунџ вечери  " });
    expect(state).toMatchObject({ ok: true, outcome: "sent", message: mk.sent });
    expect(state.values?.email).toBe("ana@example.com");
    expect(fake.from).toHaveBeenCalledWith("access_requests");
    expect(fake.inserted).toEqual([
      {
        business_name: "EmeraldCaffe",
        business_type: "cafe",
        contact_name: "Ана Петрова",
        email: "ana@example.com",
        phone: "+389 70 123 456",
        message: "Лаунџ вечери",
        city: "Скопје",
        preferred_genre: "House",
      },
    ]);
    // Never approved automatically: no status (the column defaults to 'new').
    expect(fake.inserted[0]).not.toHaveProperty("status");
  });

  it("stores the recommendation choice and null for blank optional fields", async () => {
    await submit({ ...VALID, preferredGenre: GENRE_RECOMMENDATION });
    expect(fake.inserted[0]).toMatchObject({ phone: null, message: null, preferred_genre: GENRE_RECOMMENDATION });
  });

  it("answers a duplicate open request with friendly information, not an error", async () => {
    fake = createFakeClient({ insert: async () => ({ error: { code: "23505", message: "duplicate key value" } }) });
    const state = await submit(VALID);
    expect(state).toMatchObject({ ok: true, outcome: "duplicate", message: mk.duplicate });
  });

  it("reports other storage failures honestly and keeps the typed values", async () => {
    fake = createFakeClient({ insert: async () => ({ error: { code: "XX000", message: "boom" } }) });
    const state = await submit(VALID);
    expect(state).toMatchObject({ ok: false, message: mk.unavailable, values: { venueName: "EmeraldCaffe", city: "Скопје" } });
    expect(state.outcome).toBeUndefined();
  });

  it("silently drops submissions that filled the hidden anti-spam field", async () => {
    const state = await submit({ ...VALID, [HONEYPOT_FIELD]: "https://spam.example" });
    expect(state).toMatchObject({ ok: true, outcome: "sent" });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(fake.inserted).toEqual([]);
  });
});

describe("requestTrial — rate limits", () => {
  it("limits per network (5/hour), per email (3/day), then across all visitors (30/hour), failing closed", async () => {
    await submit(VALID);
    expect(mocks.consumeRateLimit.mock.calls.map(([options]) => options)).toEqual([
      { key: "access-request:ip:203.0.113.7", max: 5, windowSeconds: 3600, failClosed: true },
      { key: "access-request:email:ana@example.com", max: 3, windowSeconds: 86_400, failClosed: true },
      { key: "access-request:global", max: 30, windowSeconds: 3600, failClosed: true },
    ]);
  });

  it("cannot be moved to a fresh network bucket by forging X-Forwarded-For", async () => {
    for (const [index, forged] of ["10.0.0.1", "10.0.0.2", "172.16.5.4, 192.168.1.1"].entries()) {
      mocks.headers.mockResolvedValue(fakeHeaders({ "x-forwarded-for": `${forged}, 203.0.113.7` }));
      expect((await submit({ ...VALID, email: `ana${index}@example.com` })).ok).toBe(true);
    }
    const ipKeys = mocks.consumeRateLimit.mock.calls.map(([options]) => options.key as string).filter((key) => key.startsWith("access-request:ip:"));
    expect(new Set(ipKeys)).toEqual(new Set(["access-request:ip:203.0.113.7"]));
  });

  it("stops at each limit with the matching message and stores nothing", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "limited" });
    expect((await submit(VALID)).message).toBe(mk.tooManyFromNetwork);
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);

    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: true, degraded: false }).mockResolvedValueOnce({ allowed: false, reason: "limited" });
    expect((await submit(VALID)).message).toBe(mk.tooManyForEmail);

    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, degraded: false })
      .mockResolvedValueOnce({ allowed: true, degraded: false })
      .mockResolvedValueOnce({ allowed: false, reason: "limited" });
    expect((await submit({ ...VALID, locale: "en" })).message).toBe(en.tooManyOverall);

    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "unavailable" });
    expect((await submit(VALID)).message).toBe(mk.unavailable);
    expect(fake.inserted).toEqual([]);
  });
});

describe("requestTrial — setup mode", () => {
  it("explains that the service is not configured when Supabase or the secret key is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const state = await submit(VALID);
    expect(state).toMatchObject({ ok: false, message: mk.notConfigured });
    expect(state.values?.venueName).toBe("EmeraldCaffe");
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await submit({ ...VALID, locale: "en" })).message).toBe(en.notConfigured);
  });

  it("treats a configuration error from the client factory the same way", async () => {
    mocks.createSupabaseAdminClient.mockImplementation(() => {
      throw new EnvError("SUPABASE_SECRET_KEY", "missing");
    });
    expect((await submit(VALID)).message).toBe(mk.notConfigured);
  });
});
