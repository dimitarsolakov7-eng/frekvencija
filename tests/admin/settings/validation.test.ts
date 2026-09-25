import { describe, expect, it } from "vitest";
import { toPlatformSettingsUpdate } from "@/lib/data/admin/settings";
import { formDataToObject } from "@/lib/validation/forms";
import {
  CONTACT_PHONE_PATTERN,
  normalizeLongText,
  PLATFORM_SETTINGS_FIELDS,
  PLATFORM_SETTINGS_LIMITS,
  platformSettingsSchema,
} from "@/lib/validation/settings";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";

function input(overrides: Record<string, string> = {}) {
  return {
    contactEmail: "hello@frekvencija.online",
    contactPhone: "+389 70 123 456",
    defaultAnnouncementEveryNTracks: "4",
    privacyPolicy: "We store what we need.",
    termsOfService: "",
    ...overrides,
  };
}

describe("platformSettingsSchema", () => {
  it("parses a submitted form, blank optional fields becoming null", () => {
    const data = new FormData();
    for (const [key, value] of Object.entries(input({ contactPhone: "   " }))) data.append(key, value);
    expect(platformSettingsSchema.parse(formDataToObject(data))).toEqual({
      contactEmail: "hello@frekvencija.online",
      contactPhone: null,
      defaultAnnouncementEveryNTracks: 4,
      privacyPolicy: "We store what we need.",
      termsOfService: null,
    });
  });

  it("stores policy text with plain line breaks, keeping blank lines between paragraphs", () => {
    const parsed = platformSettingsSchema.parse(input({ privacyPolicy: "  First paragraph.\r\nSame paragraph.\r\n\r\nSecond paragraph.\r\n  " }));
    expect(parsed.privacyPolicy).toBe("First paragraph.\nSame paragraph.\n\nSecond paragraph.");
    expect(normalizeLongText("a\rb")).toBe("a\nb");
    expect(normalizeLongText(" \r\n ")).toBeNull();
  });

  it("enforces the database limits", () => {
    const max = "x".repeat(PLATFORM_SETTINGS_LIMITS.policyText);
    expect(platformSettingsSchema.safeParse(input({ termsOfService: max })).success).toBe(true);
    const tooLong = platformSettingsSchema.safeParse(input({ termsOfService: `${max}y` }));
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0].message).toBe("The terms of service must be at most 50,000 characters.");
    // CRLF counts as one character, like the browser's own maxlength counter.
    expect(platformSettingsSchema.safeParse(input({ privacyPolicy: `${"x".repeat(49_998)}\r\ny` })).success).toBe(true);
  });

  it("checks the default announcement frequency (1–50, whole numbers)", () => {
    expect(platformSettingsSchema.parse(input({ defaultAnnouncementEveryNTracks: "50" })).defaultAnnouncementEveryNTracks).toBe(50);
    for (const bad of ["0", "51", "2.5", "four", ""]) {
      expect(platformSettingsSchema.safeParse(input({ defaultAnnouncementEveryNTracks: bad })).success).toBe(false);
    }
  });

  it("checks the contact email and phone", () => {
    expect(platformSettingsSchema.safeParse(input({ contactEmail: "not-an-email" })).success).toBe(false);
    expect(platformSettingsSchema.safeParse(input({ contactEmail: "" })).success).toBe(true);
    expect(platformSettingsSchema.parse(input({ contactPhone: " +1  (555) 010-0100 " })).contactPhone).toBe("+1 (555) 010-0100");
    expect(platformSettingsSchema.safeParse(input({ contactPhone: "call me" })).success).toBe(false);
    expect(platformSettingsSchema.safeParse(input({ contactPhone: "+++" })).success).toBe(false);
    expect(platformSettingsSchema.safeParse(input({ contactPhone: "1".repeat(41) })).success).toBe(false);
    expect(CONTACT_PHONE_PATTERN.test("+389 70/123-456.")).toBe(true);
  });

  it("lists the form fields in display order", () => {
    expect([...PLATFORM_SETTINGS_FIELDS]).toEqual(Object.keys(input()));
  });
});

describe("toPlatformSettingsUpdate", () => {
  it("writes every column and records who saved it", () => {
    const parsed = platformSettingsSchema.parse(input());
    expect(toPlatformSettingsUpdate(parsed, ADMIN_ID)).toEqual({
      contact_email: "hello@frekvencija.online",
      contact_phone: "+389 70 123 456",
      privacy_policy: "We store what we need.",
      terms_of_service: null,
      default_announcement_every_n_tracks: 4,
      updated_by: ADMIN_ID,
    });
  });
});
