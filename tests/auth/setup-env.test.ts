import { describe, expect, it } from "vitest";
import { describeSetupEnv, type SetupEnvSnapshot } from "@/app/setup/_lib/env-status";

const SECRET = "fake_secret_do-not-render-me";
const PUBLISHABLE = "sb_publishable_do-not-render-me";

function statusOf(env: SetupEnvSnapshot, name: string) {
  return describeSetupEnv(env).checks.find((check) => check.name === name);
}

describe("describeSetupEnv", () => {
  it("lists every missing required variable at once (not only the first)", () => {
    const report = describeSetupEnv({ NODE_ENV: "development" });
    expect(report.supabaseConfigured).toBe(false);
    expect(report.blocking).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  });

  it("never includes values in the report", () => {
    const report = describeSetupEnv({
      NEXT_PUBLIC_SUPABASE_URL: "not a url",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      SUPABASE_SECRET_KEY: SECRET,
      NEXT_PUBLIC_SITE_URL: "https://my-venue-host.test/path",
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(PUBLISHABLE);
    expect(serialized).not.toContain("not a url");
    expect(serialized).not.toContain("my-venue-host");
  });

  it("reports malformed URLs as invalid", () => {
    const env: SetupEnvSnapshot = { NEXT_PUBLIC_SUPABASE_URL: "ftp://example.com", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x" };
    expect(statusOf(env, "NEXT_PUBLIC_SUPABASE_URL")?.status).toBe("invalid");
    expect(describeSetupEnv(env).blocking).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(statusOf({ NEXT_PUBLIC_SITE_URL: "https://radio.example.com/app" }, "NEXT_PUBLIC_SITE_URL")?.status).toBe("invalid");
    expect(statusOf({ NEXT_PUBLIC_SITE_URL: "https://radio.example.com" }, "NEXT_PUBLIC_SITE_URL")?.status).toBe("set");
  });

  it("accepts the legacy key names", () => {
    const report = describeSetupEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJ...",
      SUPABASE_SERVICE_ROLE_KEY: "eyJ...",
    });
    expect(report.supabaseConfigured).toBe(true);
    expect(report.blocking).toEqual([]);
    expect(report.checks.find((check) => check.name === "SUPABASE_SECRET_KEY")?.status).toBe("set");
  });

  it("treats blank values as missing", () => {
    expect(statusOf({ NEXT_PUBLIC_SUPABASE_URL: "   " }, "NEXT_PUBLIC_SUPABASE_URL")?.status).toBe("missing");
  });

  it("requires the site URL in production only", () => {
    const configured = { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x" };
    expect(describeSetupEnv({ ...configured, NODE_ENV: "development" }).blocking).toEqual([]);
    expect(describeSetupEnv({ ...configured, NODE_ENV: "production" }).blocking).toEqual(["NEXT_PUBLIC_SITE_URL"]);
  });

  it("marks ElevenLabs as optional", () => {
    expect(statusOf({}, "ELEVENLABS_API_KEY")).toMatchObject({ need: "optional", status: "missing" });
  });
});
