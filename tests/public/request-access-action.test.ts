import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeHeaders, formData } from "../auth/auth-mocks";
import { createFakeClient } from "./fakes";
import { requestAccess, type RequestAccessState } from "@/app/(public)/request-access/actions";
import { HONEYPOT_FIELD } from "@/components/public/request-access-options";
import { EnvError } from "@/lib/env";

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

const INITIAL: RequestAccessState = { ok: false, message: null, fieldErrors: {} };

const VALID = {
  businessName: "  EmeraldBar  ",
  businessType: "bar",
  contactName: "Ana Petrova",
  email: " Ana@Example.COM ",
  phone: "",
  message: "",
};

let fake = createFakeClient();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  // Client-IP policy: nothing configured (untrusted, right-most X-Forwarded-For entry).
  vi.stubEnv("CLIENT_IP_HEADER", "");
  vi.stubEnv("TRUSTED_PROXY_HOPS", "");
  vi.stubEnv("VERCEL", "");
  // The client forged the first hop; the proxy in front of the app appended the address it saw.
  mocks.headers.mockResolvedValue(fakeHeaders({ "x-forwarded-for": "10.9.8.7, 203.0.113.7" }));
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, degraded: false });
  fake = createFakeClient();
  mocks.createSupabaseAdminClient.mockImplementation(() => fake.client);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const submit = (entries: Record<string, string>) => requestAccess(INITIAL, formData(entries));

describe("requestAccess — validation", () => {
  it("returns field errors and the typed values without rate limiting or storing anything", async () => {
    const state = await submit({ businessName: " ", businessType: "", contactName: "", email: "not-an-email", phone: "", message: "" });
    expect(state.ok).toBe(false);
    expect(state.message).toBe("Please check the highlighted fields.");
    expect(Object.keys(state.fieldErrors).sort()).toEqual(["businessName", "businessType", "contactName", "email"]);
    expect(state.fieldErrors.businessType).toBe("Choose the type of business.");
    expect(state.values).toMatchObject({ email: "not-an-email", businessType: "" });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(fake.inserted).toEqual([]);
  });

  it("rejects unknown business types, bad phone numbers and over-long text", async () => {
    const state = await submit({
      ...VALID,
      businessType: "nightclub",
      phone: "call me maybe",
      message: "x".repeat(1001),
      businessName: "y".repeat(121),
    });
    expect(state.fieldErrors.businessType).toBeTruthy();
    expect(state.fieldErrors.phone).toMatch(/phone number/);
    expect(state.fieldErrors.message).toMatch(/at most 1000/);
    expect(state.fieldErrors.businessName).toMatch(/at most 120/);
  });

  it("accepts every business type of the form", async () => {
    for (const businessType of ["cafe", "restaurant", "hotel", "bar", "other"]) {
      const state = await submit({ ...VALID, businessType, email: `${businessType}@example.com` });
      expect(state.ok, businessType).toBe(true);
    }
  });
});

describe("requestAccess — storing", () => {
  it("stores a valid request (trimmed, email lower-cased, blank optionals as null) and reports success", async () => {
    const state = await submit({ ...VALID, phone: " +389 70 123 456 ", message: "  Lounge evenings  " });
    expect(state).toMatchObject({ ok: true, outcome: "sent", message: "Thanks — we’ll be in touch." });
    expect(state.values?.email).toBe("ana@example.com");
    expect(fake.from).toHaveBeenCalledWith("access_requests");
    expect(fake.inserted).toEqual([
      {
        business_name: "EmeraldBar",
        business_type: "bar",
        contact_name: "Ana Petrova",
        email: "ana@example.com",
        phone: "+389 70 123 456",
        message: "Lounge evenings",
      },
    ]);
    // Never approved automatically: no status (the column defaults to 'new').
    expect(fake.inserted[0]).not.toHaveProperty("status");
  });

  it("stores null for blank optional fields", async () => {
    await submit(VALID);
    expect(fake.inserted[0]).toMatchObject({ phone: null, message: null });
  });

  it("answers a duplicate open request with friendly information, not an error", async () => {
    fake = createFakeClient({ insert: async () => ({ error: { code: "23505", message: "duplicate key value" } }) });
    const state = await submit(VALID);
    expect(state).toMatchObject({ ok: true, outcome: "duplicate" });
    expect(state.message).toBe("We already have your request.");
  });

  it("reports other storage failures honestly and keeps the typed values", async () => {
    fake = createFakeClient({ insert: async () => ({ error: { code: "XX000", message: "boom" } }) });
    const state = await submit(VALID);
    expect(state).toMatchObject({ ok: false, values: { businessName: "EmeraldBar", contactName: "Ana Petrova" } });
    expect(state.message).toMatch(/couldn’t be sent right now/);
    expect(state.outcome).toBeUndefined();
  });

  it("silently drops submissions that filled the hidden anti-spam field", async () => {
    const state = await submit({ ...VALID, [HONEYPOT_FIELD]: "https://spam.example" });
    expect(state).toMatchObject({ ok: true, outcome: "sent" });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(fake.inserted).toEqual([]);
  });
});

describe("requestAccess — rate limits", () => {
  it("limits per network (5/hour), per email (3/day), then across all visitors (30/hour), failing closed", async () => {
    await submit(VALID);
    expect(mocks.consumeRateLimit.mock.calls.map(([options]) => options)).toEqual([
      { key: "access-request:ip:203.0.113.7", max: 5, windowSeconds: 3600, failClosed: true },
      { key: "access-request:email:ana@example.com", max: 3, windowSeconds: 86_400, failClosed: true },
      { key: "access-request:global", max: 30, windowSeconds: 3600, failClosed: true },
    ]);
  });

  it("cannot be moved to a fresh network bucket by forging X-Forwarded-For (SEC-02)", async () => {
    for (const [index, forged] of ["10.0.0.1", "10.0.0.2", "172.16.5.4, 192.168.1.1"].entries()) {
      mocks.headers.mockResolvedValue(fakeHeaders({ "x-forwarded-for": `${forged}, 203.0.113.7` }));
      expect((await submit({ ...VALID, email: `ana${index}@example.com` })).ok).toBe(true);
    }
    const ipKeys = mocks.consumeRateLimit.mock.calls
      .map(([options]) => options.key as string)
      .filter((key) => key.startsWith("access-request:ip:"));
    expect(new Set(ipKeys)).toEqual(new Set(["access-request:ip:203.0.113.7"]));
  });

  it("honours the trusted client-IP settings", async () => {
    vi.stubEnv("CLIENT_IP_HEADER", "x-real-ip");
    mocks.headers.mockResolvedValue(fakeHeaders({ "x-real-ip": "198.51.100.8", "x-forwarded-for": "10.9.8.7, 203.0.113.7" }));
    await submit(VALID);
    expect(mocks.consumeRateLimit.mock.calls[0]?.[0].key).toBe("access-request:ip:198.51.100.8");
  });

  it("stops at the network limit without consuming the email or global buckets or storing", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "limited" });
    const state = await submit(VALID);
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/Too many requests have been sent from this network/);
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(fake.inserted).toEqual([]);
  });

  it("stops at the per-email limit without consuming the global bucket", async () => {
    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, degraded: false })
      .mockResolvedValueOnce({ allowed: false, reason: "limited" });
    const state = await submit(VALID);
    expect(state.message).toMatch(/several requests for this email address today/);
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(fake.inserted).toEqual([]);
  });

  it("stops at the global cap, whatever the client IP (SEC-02)", async () => {
    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, degraded: false })
      .mockResolvedValueOnce({ allowed: true, degraded: false })
      .mockResolvedValueOnce({ allowed: false, reason: "limited" });
    const state = await submit(VALID);
    expect(state).toMatchObject({ ok: false, values: { businessName: "EmeraldBar", email: "ana@example.com" } });
    expect(state.message).toMatch(/unusually large number of requests/);
    expect(mocks.consumeRateLimit.mock.calls[2]?.[0].key).toBe("access-request:global");
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(fake.inserted).toEqual([]);
  });

  it("fails closed when the global cap cannot be checked", async () => {
    mocks.consumeRateLimit
      .mockResolvedValueOnce({ allowed: true, degraded: false })
      .mockResolvedValueOnce({ allowed: true, degraded: false })
      .mockResolvedValueOnce({ allowed: false, reason: "unavailable" });
    const state = await submit(VALID);
    expect(state.message).toMatch(/couldn’t be sent right now/);
    expect(fake.inserted).toEqual([]);
  });

  it("does not store anything while the limiter is unavailable", async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false, reason: "unavailable" });
    const state = await submit(VALID);
    expect(state.message).toMatch(/couldn’t be sent right now/);
    expect(fake.inserted).toEqual([]);
  });

  it("uses a bounded key for very long email addresses", async () => {
    const local = "a".repeat(64);
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.example`;
    await submit({ ...VALID, email: `${local}@${domain}` });
    const emailKey = mocks.consumeRateLimit.mock.calls[1]?.[0].key as string;
    expect(emailKey.startsWith("access-request:email:")).toBe(true);
    expect(emailKey.length).toBeLessThanOrEqual(200);
  });
});

describe("requestAccess — setup mode", () => {
  it("explains that the service is not configured when Supabase is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const state = await submit(VALID);
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/not configured/);
    expect(state.values?.businessName).toBe("EmeraldBar");
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("explains that the service is not configured when the secret key is missing", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await submit(VALID)).message).toMatch(/not configured/);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("treats a configuration error from the client factory the same way", async () => {
    mocks.createSupabaseAdminClient.mockImplementation(() => {
      throw new EnvError("SUPABASE_SECRET_KEY", "missing");
    });
    expect((await submit(VALID)).message).toMatch(/not configured/);
  });
});
