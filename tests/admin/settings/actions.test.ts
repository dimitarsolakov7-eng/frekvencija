import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeClient, eqValue, type FakeClient, type Responder } from "../businesses/fake-client";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const SECRET = "sk_live_super_secret_value";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeClient, revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  requireAdminAction: async () => ({
    ctx: { userId: ADMIN_ID, email: "admin@platform.example", role: "platform_admin", business: null },
    supabase: h.fake.client,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

const { savePlatformSettings } = await import("@/app/admin/settings/actions");
const {
  describeCharacterUsage,
  describeSubscriptionError,
  loadDefaultAnnouncementFrequency,
  loadIntegrationStatus,
  loadPlatformSettings,
} = await import("@/lib/data/admin/settings");
const { ElevenLabsError } = await import("@/lib/tts/elevenlabs");
const { EnvError } = await import("@/lib/env");

function install(respond: Responder) {
  h.fake = createFakeClient(respond);
  return h.fake;
}

function settingsForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields = {
    contactEmail: "hello@frekvencija.online",
    contactPhone: "",
    defaultAnnouncementEveryNTracks: "5",
    privacyPolicy: "Line one.\r\n\r\nLine two.",
    termsOfService: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const IDLE = { ok: false, message: null, fieldErrors: {} };

beforeEach(() => {
  h.revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("savePlatformSettings", () => {
  it("updates the singleton row with the admin's id and refreshes the public pages", async () => {
    const fake = install(() => ({ data: { id: true } }));
    const state = await savePlatformSettings(IDLE, settingsForm());
    expect(state).toMatchObject({ ok: true, message: "Settings saved." });
    const update = fake.calls[0];
    expect(update).toMatchObject({ table: "platform_settings", op: "update", returning: "id" });
    expect(update.payload).toEqual({
      contact_email: "hello@frekvencija.online",
      contact_phone: null,
      privacy_policy: "Line one.\n\nLine two.",
      terms_of_service: null,
      default_announcement_every_n_tracks: 5,
      updated_by: ADMIN_ID,
    });
    expect(eqValue(update, "id")).toBe(true);
    for (const path of ["/admin/settings", "/privacy", "/terms"]) expect(h.revalidatePath).toHaveBeenCalledWith(path);
  });

  it("echoes the input with field errors and writes nothing", async () => {
    const fake = install(() => undefined);
    const state = await savePlatformSettings(IDLE, settingsForm({ contactEmail: "nope", defaultAnnouncementEveryNTracks: "99" }));
    expect(state.ok).toBe(false);
    expect(state.fieldErrors).toMatchObject({
      contactEmail: "Enter a valid email address.",
      defaultAnnouncementEveryNTracks: "The default announcement frequency must be between 1 and 50.",
    });
    expect(state.values).toMatchObject({ contactEmail: "nope", defaultAnnouncementEveryNTracks: "99", privacyPolicy: "Line one.\r\n\r\nLine two." });
    expect(fake.calls).toEqual([]);
  });

  it("explains a missing settings row and database errors", async () => {
    install(() => ({ data: null }));
    expect((await savePlatformSettings(IDLE, settingsForm())).message).toMatch(/settings row is missing.*20260926000100_frekvencija\.sql/);
    install(() => ({ error: { code: "42501", message: "denied" } }));
    expect((await savePlatformSettings(IDLE, settingsForm())).message).toBe("You don't have permission to do that.");
  });
});

describe("loading the settings", () => {
  const row = {
    contact_email: "hello@frekvencija.online",
    contact_phone: null,
    privacy_policy: "Text",
    terms_of_service: null,
    default_announcement_every_n_tracks: 6,
    updated_at: "2026-09-24T16:05:00Z",
    editor: { email: "admin@frekvencija.online" },
  };

  it("maps the row, including who saved it last", async () => {
    const fake = install(() => ({ data: row }));
    expect(await loadPlatformSettings(fake.client)).toEqual({
      contactEmail: "hello@frekvencija.online",
      contactPhone: null,
      privacyPolicy: "Text",
      termsOfService: null,
      defaultAnnouncementEveryNTracks: 6,
      updatedAt: "2026-09-24T16:05:00Z",
      updatedByEmail: "admin@frekvencija.online",
      rowMissing: false,
    });
    expect(eqValue(fake.calls[0], "id")).toBe(true);
  });

  it("treats a missing row as defaults and throws on errors", async () => {
    expect(await loadPlatformSettings(install(() => ({ data: null })).client)).toMatchObject({ rowMissing: true, defaultAnnouncementEveryNTracks: 4 });
    await expect(loadPlatformSettings(install(() => ({ error: { code: "XX000", message: "down" } })).client)).rejects.toThrow();
  });

  it("reads the default announcement frequency for new venues, never throwing", async () => {
    expect(await loadDefaultAnnouncementFrequency(install(() => ({ data: { default_announcement_every_n_tracks: 7 } })).client)).toEqual({
      everyNTracks: 7,
      fromSettings: true,
    });
    expect(await loadDefaultAnnouncementFrequency(install(() => ({ data: null })).client)).toEqual({ everyNTracks: 4, fromSettings: false });
    expect(await loadDefaultAnnouncementFrequency(install(() => ({ error: { code: "XX000", message: "down" } })).client)).toEqual({
      everyNTracks: 4,
      fromSettings: false,
    });
  });
});

describe("integration status", () => {
  const deps = (overrides: Partial<Parameters<typeof loadIntegrationStatus>[0] & object> = {}) => ({
    isSupabaseConfigured: () => true,
    supabaseHost: () => "abcd.supabase.co",
    secretKeyPresent: () => true,
    siteUrl: () => "https://frekvencija.online",
    elevenLabsKeyPresent: () => true,
    getSubscription: async () => ({ tier: "creator", status: "active", characterCount: 12_480, characterLimit: 100_000, nextResetUnix: 1_792_886_400 }),
    ...overrides,
  });

  it("reports every service, with ElevenLabs plan and credits", async () => {
    const items = await loadIntegrationStatus(deps());
    expect(items.map((item) => [item.key, item.state])).toEqual([
      ["supabase", "ok"],
      ["secret-key", "ok"],
      ["site-url", "ok"],
      ["elevenlabs", "ok"],
      ["email", "info"],
    ]);
    const elevenLabs = items.find((item) => item.key === "elevenlabs")!;
    expect(elevenLabs.details).toEqual([
      { label: "Plan", value: "Creator" },
      { label: "Status", value: "Active" },
      { label: "Credits", value: "12,480 of 100,000 characters used (12%)" },
      { label: "Credits reset", value: "25 Oct 2026, 00:00 UTC" },
    ]);
    expect(items.find((item) => item.key === "email")?.summary).toMatch(/about 2 emails per hour.*Create invite link/);
  });

  it("is honest about missing configuration", async () => {
    const getSubscription = vi.fn();
    const items = await loadIntegrationStatus(
      deps({
        secretKeyPresent: () => false,
        elevenLabsKeyPresent: () => false,
        getSubscription,
        siteUrl: () => {
          throw new EnvError("NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SITE_URL is not set.");
        },
      }),
    );
    expect(items.find((item) => item.key === "secret-key")).toMatchObject({ state: "error", summary: expect.stringContaining("SUPABASE_SECRET_KEY") });
    expect(items.find((item) => item.key === "site-url")).toMatchObject({ state: "error", summary: "NEXT_PUBLIC_SITE_URL is not set." });
    expect(items.find((item) => item.key === "elevenlabs")).toMatchObject({ state: "off" });
    expect(getSubscription).not.toHaveBeenCalled();
  });

  it("explains subscription failures without ever showing the key", async () => {
    const rejected = new ElevenLabsError("auth", `ElevenLabs 401: invalid key ${SECRET}`, { status: 401 });
    const items = await loadIntegrationStatus(deps({ getSubscription: async () => Promise.reject(rejected) }));
    const elevenLabs = items.find((item) => item.key === "elevenlabs")!;
    expect(elevenLabs.state).toBe("error");
    expect(elevenLabs.summary).toMatch(/User: Read/);
    expect(JSON.stringify(items)).not.toContain(SECRET);

    expect(describeSubscriptionError(new ElevenLabsError("timeout", "slow")).state).toBe("warning");
    expect(describeSubscriptionError(new ElevenLabsError("rate_limited", "busy")).summary).toMatch(/rate-limiting/);
    expect(describeSubscriptionError(new Error(SECRET)).summary).not.toContain(SECRET);
  });

  it("flags used-up credits", async () => {
    const items = await loadIntegrationStatus(
      deps({ getSubscription: async () => ({ tier: "free", status: "active", characterCount: 10_000, characterLimit: 10_000, nextResetUnix: null }) }),
    );
    expect(items.find((item) => item.key === "elevenlabs")).toMatchObject({ state: "warning", summary: expect.stringContaining("used up") });
  });

  it("formats character usage", () => {
    expect(describeCharacterUsage(0, 10_000)).toBe("0 of 10,000 characters used (0%)");
    expect(describeCharacterUsage(12_000, 10_000)).toBe("12,000 of 10,000 characters used (100%)");
    expect(describeCharacterUsage(5, 0)).toBe("5 characters used");
  });
});
