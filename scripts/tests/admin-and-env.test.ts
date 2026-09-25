import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildConfirmLink, parseCreateAdminArgs } from "../lib/admin-invite";
import { ScriptEnvError, getSiteUrl, getSupabaseAdminConfig, isLocalUrl, loadLocalEnv, readSupabaseUrl } from "../lib/env";
import { MIN_PASSWORD_LENGTH, generatePassword } from "../lib/passwords";
import { describeError } from "../lib/supabase-admin";

describe("parseCreateAdminArgs", () => {
  it("accepts one email and --link", () => {
    expect(parseCreateAdminArgs(["Boss@Example.com"])).toEqual({ kind: "run", email: "boss@example.com", link: false });
    expect(parseCreateAdminArgs(["boss@example.com", "--link"])).toEqual({ kind: "run", email: "boss@example.com", link: true });
    expect(parseCreateAdminArgs(["--help"])).toEqual({ kind: "help" });
  });

  it("rejects missing, extra or invalid emails and unknown flags", () => {
    expect(parseCreateAdminArgs([])).toMatchObject({ kind: "error", message: expect.stringMatching(/email address/) });
    expect(parseCreateAdminArgs(["a@example.com", "b@example.com"])).toMatchObject({ kind: "error" });
    expect(parseCreateAdminArgs(["not-an-email"])).toMatchObject({ kind: "error", message: expect.stringMatching(/not a valid email/) });
    expect(parseCreateAdminArgs(["a@example.com", "--password", "x"])).toMatchObject({ kind: "error" });
  });
});

describe("buildConfirmLink", () => {
  it("builds the /auth/confirm link the invite email would contain", () => {
    expect(buildConfirmLink("https://radio.example.com", "pkce_abc123", "invite")).toBe(
      "https://radio.example.com/auth/confirm?token_hash=pkce_abc123&type=invite&next=/reset-password",
    );
    expect(buildConfirmLink("http://localhost:3000/", "a+b/c", "recovery")).toBe(
      "http://localhost:3000/auth/confirm?token_hash=a%2Bb%2Fc&type=recovery&next=/reset-password",
    );
    expect(() => buildConfirmLink("http://localhost:3000", "", "invite")).toThrow();
  });
});

describe("generatePassword", () => {
  it("is long, mixes every character class and never repeats", () => {
    const passwords = Array.from({ length: 200 }, () => generatePassword());
    expect(new Set(passwords).size).toBe(200);
    for (const password of passwords) {
      expect(password).toHaveLength(24);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#%*\-_=+]/);
      expect(password).not.toMatch(/["'`$\\\s]/);
    }
    expect(() => generatePassword(MIN_PASSWORD_LENGTH - 1)).toThrow(RangeError);
  });
});

describe("script env", () => {
  const touched = ["VR_TEST_A", "VR_TEST_B"];
  afterEach(() => {
    for (const key of touched) delete process.env[key];
  });

  it("loads .env.local before .env without overriding the shell", async () => {
    const dir = await mkdtemp(join(tmpdir(), "venue-radio-env-"));
    try {
      await writeFile(join(dir, ".env.local"), "VR_TEST_A=from_local\n");
      await writeFile(join(dir, ".env"), "VR_TEST_A=from_env\nVR_TEST_B=from_env\n");
      expect(loadLocalEnv(dir)).toEqual([".env.local", ".env"]);
      expect([process.env.VR_TEST_A, process.env.VR_TEST_B]).toEqual(["from_local", "from_env"]);
      expect(loadLocalEnv(join(dir, "missing"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("explains an unsupported Node.js instead of failing on a missing process.loadEnvFile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "venue-radio-env-"));
    const original = process.loadEnvFile;
    try {
      await writeFile(join(dir, ".env.local"), "VR_TEST_A=from_local\n");
      Reflect.set(process, "loadEnvFile", undefined); // what Node.js < 20.12 looks like
      expect(() => loadLocalEnv(dir)).toThrow(ScriptEnvError);
      expect(() => loadLocalEnv(dir)).toThrow(/cannot read \.env\.local: process\.loadEnvFile needs Node\.js 20\.12 or newer.*"engines": \^22\.13\.0/);
      expect(process.env.VR_TEST_A).toBeUndefined();
    } finally {
      Reflect.set(process, "loadEnvFile", original);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads Supabase settings with the legacy fallback and names what is missing", () => {
    expect(readSupabaseUrl({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/" })).toBe("http://127.0.0.1:54321");
    expect(() => readSupabaseUrl({ NEXT_PUBLIC_SUPABASE_URL: "ftp://x" })).toThrow(ScriptEnvError);
    expect(getSupabaseAdminConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY: "legacy" })).toEqual({
      url: "http://localhost:54321",
      secretKey: "legacy",
    });
    expect(() => getSupabaseAdminConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" })).toThrow(/SUPABASE_SECRET_KEY is not set/);
  });

  it("classifies local URLs and validates the site URL", () => {
    expect(["http://localhost:54321", "http://127.0.0.1:54321", "http://[::1]:54321"].every(isLocalUrl)).toBe(true);
    expect(["https://abc.supabase.co", "http://localhost.example.com", "not a url"].some(isLocalUrl)).toBe(false);
    expect(getSiteUrl({ allowDefault: true }, {})).toBe("http://localhost:3000");
    expect(() => getSiteUrl({ allowDefault: false }, {})).toThrow(/NEXT_PUBLIC_SITE_URL is not set/);
    expect(getSiteUrl({ allowDefault: false }, { NEXT_PUBLIC_SITE_URL: "https://radio.example.com/" })).toBe("https://radio.example.com");
    expect(() => getSiteUrl({ allowDefault: true }, { NEXT_PUBLIC_SITE_URL: "https://radio.example.com/app" })).toThrow(/without a path/);
  });
});

describe("describeError", () => {
  it("keeps codes and details but drops empty codes and stack traces", () => {
    expect(describeError({ message: "duplicate key", code: "23505", details: "Key (slug)=(house) exists." })).toBe(
      "duplicate key (23505) - Key (slug)=(house) exists.",
    );
    expect(
      describeError({ message: "TypeError: fetch failed", code: "", details: "TypeError: fetch failed\n\nCaused by: Error: connect ECONNREFUSED\n    at x (y.js:1:1)" }),
    ).toBe("TypeError: fetch failed - Caused by: Error: connect ECONNREFUSED");
  });
});
