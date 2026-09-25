import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeHeaders } from "./auth-mocks";
import {
  clientIpFromHeaders,
  globalAuthRateLimit,
  MAX_RATE_LIMIT_KEY_LENGTH,
  normaliseClientIp,
  rateLimitKey,
  RESET_GLOBAL_LIMIT,
  resolveClientIp,
  type ClientIpSettings,
} from "@/app/(auth)/_lib/request";

const UNCONFIGURED: ClientIpSettings = { clientIpHeader: null, trustedProxyHops: null };
const xff = (value: string) => fakeHeaders({ "x-forwarded-for": value });

beforeEach(() => {
  for (const name of ["CLIENT_IP_HEADER", "TRUSTED_PROXY_HOPS", "VERCEL", "UPLOAD_TOKEN_SECRET", "MEDIA_URL_TTL_SECONDS"]) {
    vi.stubEnv(name, "");
  }
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("normaliseClientIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["203.0.113.7:51234", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["[::ffff:cb00:7107]:443", "203.0.113.7"],
    ["2001:DB8::1", "2001:db8:0:0::/64"],
    ["2001:db8::2", "2001:db8:0:0::/64"],
    ["[2001:db8::2]:443", "2001:db8:0:0::/64"],
    ["[2001:db8:1:2::9]", "2001:db8:1:2::/64"],
    ["2001:0db8:0001:0002:0003:0004:0005:0006", "2001:db8:1:2::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
  ])("normalises %j to %j", (input, expected) => {
    expect(normaliseClientIp(input)).toBe(expected);
  });

  it("puts every address of one IPv6 /64 into the same bucket", () => {
    expect(normaliseClientIp("2001:db8:aa:bb:1::1")).toBe(normaliseClientIp("2001:db8:aa:bb:ffff:ffff:ffff:ffff"));
    expect(normaliseClientIp("2001:db8:aa:bb::1")).not.toBe(normaliseClientIp("2001:db8:aa:bc::1"));
  });

  it.each([null, undefined, "", "unknown", "not an ip", "1.2.3.4; drop table", "256.1.1.1", "01.2.3.4", "1.2.3", "2001:db8::1::2", "[2001:db8::1", "a".repeat(100), "_hidden"])(
    "rejects %j",
    (input) => {
      expect(normaliseClientIp(input)).toBeNull();
    },
  );
});

describe("resolveClientIp — nothing configured (untrusted)", () => {
  it("uses the right-most X-Forwarded-For entry, as appended by the nearest proxy, and marks it untrusted", () => {
    expect(resolveClientIp(xff("198.51.100.23, 203.0.113.7"), UNCONFIGURED)).toEqual({ ip: "203.0.113.7", trusted: false });
    // Next.js fills the header from the socket when a client sends none.
    expect(resolveClientIp(xff("203.0.113.7"), UNCONFIGURED)).toEqual({ ip: "203.0.113.7", trusted: false });
    expect(resolveClientIp(xff("::ffff:203.0.113.7"), UNCONFIGURED)).toEqual({ ip: "203.0.113.7", trusted: false });
  });

  it("collapses missing or malformed values into 'unknown' instead of walking further left", () => {
    expect(resolveClientIp(fakeHeaders({}), UNCONFIGURED)).toEqual({ ip: "unknown", trusted: false });
    expect(resolveClientIp(xff(""), UNCONFIGURED).ip).toBe("unknown");
    expect(resolveClientIp(xff(" , "), UNCONFIGURED).ip).toBe("unknown");
    expect(resolveClientIp(xff("203.0.113.7, not an ip"), UNCONFIGURED).ip).toBe("unknown");
    expect(resolveClientIp(xff("203.0.113.7, 1.2.3.4; drop table"), UNCONFIGURED).ip).toBe("unknown");
  });

  it("treats TRUSTED_PROXY_HOPS=0 (next start reached directly) like the unconfigured case", () => {
    expect(resolveClientIp(xff("198.51.100.23, 203.0.113.7"), { clientIpHeader: null, trustedProxyHops: 0 })).toEqual({
      ip: "203.0.113.7",
      trusted: false,
    });
  });
});

describe("resolveClientIp — TRUSTED_PROXY_HOPS", () => {
  it("ignores a spoofed left-most hop with one trusted proxy", () => {
    const one: ClientIpSettings = { clientIpHeader: null, trustedProxyHops: 1 };
    // The client sent "X-Forwarded-For: 10.9.8.7"; the proxy appended the address it saw.
    expect(resolveClientIp(xff("10.9.8.7, 203.0.113.7"), one)).toEqual({ ip: "203.0.113.7", trusted: true });
    // Rotating the forged value does not move the bucket.
    for (let i = 0; i < 5; i += 1) {
      expect(resolveClientIp(xff(`10.0.0.${i}, 1.1.1.${i}, 203.0.113.7`), one).ip).toBe("203.0.113.7");
    }
  });

  it("takes the Nth entry from the right with N trusted proxies", () => {
    const two: ClientIpSettings = { clientIpHeader: null, trustedProxyHops: 2 };
    expect(resolveClientIp(xff("10.9.8.7, 203.0.113.7, 192.0.2.10"), two)).toEqual({ ip: "203.0.113.7", trusted: true });
    expect(resolveClientIp(xff("203.0.113.7, 192.0.2.10"), two).ip).toBe("203.0.113.7");
  });

  it("uses the shared 'unknown' bucket when the chain is shorter than configured (request bypassed a proxy)", () => {
    const two: ClientIpSettings = { clientIpHeader: null, trustedProxyHops: 2 };
    expect(resolveClientIp(xff("203.0.113.7"), two)).toEqual({ ip: "unknown", trusted: true });
    expect(resolveClientIp(fakeHeaders({}), two)).toEqual({ ip: "unknown", trusted: true });
    expect(resolveClientIp(xff("10.9.8.7, garbage"), { clientIpHeader: null, trustedProxyHops: 1 })).toEqual({
      ip: "unknown",
      trusted: true,
    });
  });
});

describe("resolveClientIp — CLIENT_IP_HEADER", () => {
  const realIp: ClientIpSettings = { clientIpHeader: "x-real-ip", trustedProxyHops: null };

  it("honours the header the edge overwrites and ignores X-Forwarded-For", () => {
    const headers = fakeHeaders({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "10.9.8.7, 198.51.100.23" });
    expect(resolveClientIp(headers, realIp)).toEqual({ ip: "203.0.113.7", trusted: true });
  });

  it("uses the right-most entry if the header holds a list (the one the edge added)", () => {
    expect(resolveClientIp(fakeHeaders({ "x-real-ip": "10.9.8.7, 203.0.113.7" }), realIp).ip).toBe("203.0.113.7");
  });

  it("never falls back to a client-supplied X-Forwarded-For when the header is missing or malformed", () => {
    expect(resolveClientIp(xff("10.9.8.7"), realIp)).toEqual({ ip: "unknown", trusted: true });
    expect(resolveClientIp(fakeHeaders({ "x-real-ip": "garbage", "x-forwarded-for": "10.9.8.7" }), realIp)).toEqual({
      ip: "unknown",
      trusted: true,
    });
  });

  it("falls back to TRUSTED_PROXY_HOPS when both are configured and the header is missing", () => {
    const both: ClientIpSettings = { clientIpHeader: "x-real-ip", trustedProxyHops: 1 };
    expect(resolveClientIp(xff("10.9.8.7, 203.0.113.7"), both)).toEqual({ ip: "203.0.113.7", trusted: true });
    expect(resolveClientIp(fakeHeaders({ "x-real-ip": "192.0.2.44", "x-forwarded-for": "10.9.8.7, 203.0.113.7" }), both).ip).toBe(
      "192.0.2.44",
    );
  });
});

describe("clientIpFromHeaders (settings from the environment)", () => {
  const spoofed = { "x-forwarded-for": "10.9.8.7, 203.0.113.7" };

  it("uses the right-most hop when nothing is configured", () => {
    expect(clientIpFromHeaders(fakeHeaders(spoofed))).toBe("203.0.113.7");
  });

  it("honours TRUSTED_PROXY_HOPS", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIpFromHeaders(fakeHeaders(spoofed))).toBe("10.9.8.7");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(clientIpFromHeaders(fakeHeaders(spoofed))).toBe("203.0.113.7");
  });

  it("honours CLIENT_IP_HEADER (case-insensitive name)", () => {
    vi.stubEnv("CLIENT_IP_HEADER", "CF-Connecting-IP");
    expect(clientIpFromHeaders(fakeHeaders({ ...spoofed, "cf-connecting-ip": "192.0.2.44" }))).toBe("192.0.2.44");
    expect(clientIpFromHeaders(fakeHeaders(spoofed))).toBe("unknown");
  });

  it("uses x-vercel-forwarded-for automatically on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(clientIpFromHeaders(fakeHeaders({ ...spoofed, "x-vercel-forwarded-for": "192.0.2.44" }))).toBe("192.0.2.44");
    // An explicit CLIENT_IP_HEADER wins over the Vercel default.
    vi.stubEnv("CLIENT_IP_HEADER", "x-real-ip");
    expect(
      clientIpFromHeaders(fakeHeaders({ ...spoofed, "x-vercel-forwarded-for": "192.0.2.44", "x-real-ip": "198.51.100.9" })),
    ).toBe("198.51.100.9");
  });

  it("ignores malformed settings (logged by getServerEnv) and falls back to the untrusted policy", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "one");
    vi.stubEnv("CLIENT_IP_HEADER", "x real ip");
    expect(clientIpFromHeaders(fakeHeaders(spoofed))).toBe("203.0.113.7");
  });

  it("keeps working (untrusted policy, logged) when another server variable is malformed", () => {
    vi.stubEnv("MEDIA_URL_TTL_SECONDS", "2h");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    // With the settings readable this would be "10.9.8.7"; getServerEnv() throws, so the right-most hop is used.
    expect(clientIpFromHeaders(fakeHeaders(spoofed))).toBe("203.0.113.7");
    expect(console.error).toHaveBeenCalledWith("[rate-limit] could not read the client IP settings", expect.any(Error));
  });

  it("warns once in production when the client IP is untrusted, and not when it is trusted", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    clientIpFromHeaders(fakeHeaders(spoofed));
    expect(console.warn).not.toHaveBeenCalled();

    vi.stubEnv("TRUSTED_PROXY_HOPS", "");
    clientIpFromHeaders(fakeHeaders(spoofed));
    clientIpFromHeaders(fakeHeaders(spoofed));
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toMatch(/CLIENT_IP_HEADER or TRUSTED_PROXY_HOPS/);
  });
});

describe("rateLimitKey", () => {
  it("keeps short keys readable", () => {
    expect(rateLimitKey("login:email", "venue@example.com")).toBe("login:email:venue@example.com");
  });

  it("hashes values that would exceed the 200-character limit", () => {
    const longEmail = `${"a".repeat(240)}@example.com`;
    const key = rateLimitKey("login:email", longEmail);
    expect(key.length).toBeLessThanOrEqual(MAX_RATE_LIMIT_KEY_LENGTH);
    expect(key).toMatch(/^login:email:sha256:[0-9a-f]{64}$/);
    expect(rateLimitKey("login:email", longEmail)).toBe(key);
  });
});

describe("globalAuthRateLimit", () => {
  it("builds one bucket shared by every visitor that fails open", () => {
    expect(globalAuthRateLimit(RESET_GLOBAL_LIMIT)).toEqual({ key: "reset:global", max: 60, windowSeconds: 3600, failClosed: false });
  });
});
