import { describe, expect, it } from "vitest";
import { DEV_SITE_ORIGIN, resolveSiteOrigin } from "@/lib/utils";

describe("resolveSiteOrigin", () => {
  it("returns the origin of a valid http(s) URL", () => {
    expect(resolveSiteOrigin("https://frekvencija.online")).toBe("https://frekvencija.online");
    expect(resolveSiteOrigin(" https://frekvencija.online/ ")).toBe("https://frekvencija.online");
    expect(resolveSiteOrigin("http://localhost:3001/some/path?x=1#y")).toBe("http://localhost:3001");
  });

  it("falls back for missing, malformed or non-http values", () => {
    expect(resolveSiteOrigin(undefined)).toBe(DEV_SITE_ORIGIN);
    expect(resolveSiteOrigin("")).toBe(DEV_SITE_ORIGIN);
    expect(resolveSiteOrigin("   ")).toBe(DEV_SITE_ORIGIN);
    expect(resolveSiteOrigin("frekvencija.online")).toBe(DEV_SITE_ORIGIN);
    expect(resolveSiteOrigin("javascript:alert(1)")).toBe(DEV_SITE_ORIGIN);
    expect(resolveSiteOrigin("ftp://example.com")).toBe(DEV_SITE_ORIGIN);
    expect(resolveSiteOrigin(null, "https://fallback.example")).toBe("https://fallback.example");
  });

  it("defaults to localhost:3000", () => {
    expect(DEV_SITE_ORIGIN).toBe("http://localhost:3000");
  });
});
