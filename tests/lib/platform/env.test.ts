import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnvError,
  getPublicEnv,
  getServerEnv,
  getSiteUrl,
  getSupabasePublicConfig,
  getSupabaseSecretKey,
  isSupabaseConfigured,
  isTtsConfigured,
} from "@/lib/env";

const ALL_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_DEFAULT_MODEL_ID",
  "MEDIA_URL_TTL_SECONDS",
  "UPLOAD_TOKEN_SECRET",
  "CLIENT_IP_HEADER",
  "TRUSTED_PROXY_HOPS",
  "VERCEL",
];

beforeEach(() => {
  for (const name of ALL_VARS) vi.stubEnv(name, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function captureEnvError(fn: () => unknown): EnvError {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error("expected an EnvError");
}

describe("Supabase public config", () => {
  it("is not configured when variables are missing, and names the missing one", () => {
    expect(isSupabaseConfigured()).toBe(false);
    expect(captureEnvError(getSupabasePublicConfig).variable).toBe("NEXT_PUBLIC_SUPABASE_URL");

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    const error = captureEnvError(getSupabasePublicConfig);
    expect(error.variable).toBe("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("prefers the publishable key and falls back to the legacy anon key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", " https://abc.supabase.co/ ");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "eyJ.legacy");
    expect(getSupabasePublicConfig()).toEqual({ url: "https://abc.supabase.co", publishableKey: "eyJ.legacy" });

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_new");
    expect(getSupabasePublicConfig().publishableKey).toBe("sb_publishable_new");
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("rejects a malformed URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    expect(isSupabaseConfigured()).toBe(false);
    expect(captureEnvError(getSupabasePublicConfig).message).toMatch(/absolute http\(s\) URL/);
  });
});

describe("site URL", () => {
  it("defaults to localhost outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("is required in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(captureEnvError(getSiteUrl).variable).toBe("NEXT_PUBLIC_SITE_URL");
  });

  it("normalises the origin and rejects paths", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://radio.example.com/");
    expect(getSiteUrl()).toBe("https://radio.example.com");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://radio.example.com/app");
    expect(captureEnvError(getSiteUrl).message).toMatch(/origin only/);
  });

  it("getPublicEnv combines everything", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://radio.example.com");
    expect(getPublicEnv()).toEqual({
      supabaseUrl: "https://abc.supabase.co",
      supabasePublishableKey: "sb_publishable_x",
      siteUrl: "https://radio.example.com",
      platformName: expect.any(String),
    });
  });
});

describe("server env", () => {
  it("defaults the media TTL and reports optional values as null", () => {
    expect(getServerEnv()).toEqual({
      supabaseSecretKey: null,
      elevenLabsApiKey: null,
      elevenLabsDefaultModelId: null,
      mediaUrlTtlSeconds: 7200,
      uploadTokenSecret: null,
      clientIpHeader: null,
      trustedProxyHops: null,
    });
    expect(isTtsConfigured()).toBe(false);
  });

  it.each([
    ["60", 900],
    ["900", 900],
    ["3600", 3600],
    ["43200", 43_200],
    ["999999", 43_200],
  ])("clamps MEDIA_URL_TTL_SECONDS=%s to %i", (raw, expected) => {
    vi.stubEnv("MEDIA_URL_TTL_SECONDS", raw);
    expect(getServerEnv().mediaUrlTtlSeconds).toBe(expected);
  });

  it.each(["abc", "1.5", "-100", "2h"])("rejects MEDIA_URL_TTL_SECONDS=%s", (raw) => {
    vi.stubEnv("MEDIA_URL_TTL_SECONDS", raw);
    expect(captureEnvError(getServerEnv).variable).toBe("MEDIA_URL_TTL_SECONDS");
  });

  it("uses SUPABASE_SERVICE_ROLE_KEY as a legacy fallback", () => {
    expect(captureEnvError(getSupabaseSecretKey).variable).toBe("SUPABASE_SECRET_KEY");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJ.service");
    expect(getSupabaseSecretKey()).toBe("eyJ.service");
    vi.stubEnv("SUPABASE_SECRET_KEY", "fake_secret_new");
    expect(getSupabaseSecretKey()).toBe("fake_secret_new");
  });

  it("requires a long UPLOAD_TOKEN_SECRET when set", () => {
    vi.stubEnv("UPLOAD_TOKEN_SECRET", "short");
    expect(captureEnvError(getServerEnv).variable).toBe("UPLOAD_TOKEN_SECRET");
    vi.stubEnv("UPLOAD_TOKEN_SECRET", "x".repeat(32));
    expect(getServerEnv().uploadTokenSecret).toBe("x".repeat(32));
  });

  it("detects TTS configuration", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "  sk_test  ");
    vi.stubEnv("ELEVENLABS_DEFAULT_MODEL_ID", "eleven_multilingual_v2");
    expect(isTtsConfigured()).toBe(true);
    expect(getServerEnv()).toMatchObject({ elevenLabsApiKey: "sk_test", elevenLabsDefaultModelId: "eleven_multilingual_v2" });
  });
});

describe("client IP settings", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads CLIENT_IP_HEADER as a lower-case header name", () => {
    vi.stubEnv("CLIENT_IP_HEADER", " X-Real-IP ");
    expect(getServerEnv().clientIpHeader).toBe("x-real-ip");
  });

  it("defaults to x-vercel-forwarded-for on Vercel, unless CLIENT_IP_HEADER is set", () => {
    vi.stubEnv("VERCEL", "1");
    expect(getServerEnv().clientIpHeader).toBe("x-vercel-forwarded-for");
    vi.stubEnv("CLIENT_IP_HEADER", "cf-connecting-ip");
    expect(getServerEnv().clientIpHeader).toBe("cf-connecting-ip");
  });

  it.each(["x real ip", "x-real-ip: 1.2.3.4", "x-real-ip,x-forwarded-for", "é-ip", "x".repeat(101)])(
    "ignores and logs a malformed CLIENT_IP_HEADER=%j instead of breaking every server feature",
    (raw) => {
      vi.stubEnv("CLIENT_IP_HEADER", raw);
      vi.stubEnv("SUPABASE_SECRET_KEY", "fake_secret_x");
      const env = getServerEnv();
      expect(env.clientIpHeader).toBeNull();
      expect(env.supabaseSecretKey).toBe("fake_secret_x");
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("CLIENT_IP_HEADER"));
      // A malformed explicit value still lets the Vercel default apply.
      vi.stubEnv("VERCEL", "1");
      expect(getServerEnv().clientIpHeader).toBe("x-vercel-forwarded-for");
    },
  );

  it.each([
    ["0", 0],
    ["1", 1],
    [" 2 ", 2],
    ["10", 10],
  ])("reads TRUSTED_PROXY_HOPS=%j as %i", (raw, expected) => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", raw);
    expect(getServerEnv().trustedProxyHops).toBe(expected);
  });

  it.each(["one", "-1", "1.5", "11", "100", "1e1", "0x2"])("ignores and logs a malformed TRUSTED_PROXY_HOPS=%j", (raw) => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", raw);
    expect(getServerEnv().trustedProxyHops).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`TRUSTED_PROXY_HOPS must be a whole number from 0 to 10 (got "${raw}")`));
  });

  it("logs each malformed value only once, although getServerEnv() runs on every request", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "three");
    getServerEnv();
    getServerEnv();
    getServerEnv();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
