import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_BYTES, passwordPageMode, validateNewPassword } from "@/app/(auth)/_lib/password";

describe("validateNewPassword", () => {
  it("accepts a password of at least 10 characters that is confirmed exactly", () => {
    expect(validateNewPassword("correct horse", "correct horse")).toEqual({ ok: true, password: "correct horse" });
  });

  it("does not trim: surrounding spaces are part of the password", () => {
    expect(validateNewPassword("  padded pass  ", "  padded pass  ")).toEqual({ ok: true, password: "  padded pass  " });
  });

  it("requires both fields", () => {
    const result = validateNewPassword("", "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.password).toBe("Enter a new password.");
      expect(result.fieldErrors.confirmPassword).toMatch(/again/);
    }
  });

  it("rejects short passwords and passwords made only of whitespace", () => {
    const short = validateNewPassword("short", "short");
    expect(short.ok === false && short.fieldErrors.password).toBe("Use at least 10 characters.");
    const blank = validateNewPassword("            ", "            ");
    expect(blank.ok === false && blank.fieldErrors.password).toMatch(/only of spaces/);
  });

  it("counts characters, not UTF-16 units, for the minimum length", () => {
    // 9 emoji = 18 UTF-16 units but only 9 characters.
    const emoji = "🎵".repeat(9);
    const result = validateNewPassword(emoji, emoji);
    expect(result.ok).toBe(false);
  });

  it("rejects passwords longer than 72 bytes (bcrypt limit), counting multi-byte characters", () => {
    const ascii = "a".repeat(PASSWORD_MAX_BYTES + 1);
    expect(validateNewPassword(ascii, ascii).ok).toBe(false);
    expect(validateNewPassword("a".repeat(PASSWORD_MAX_BYTES), "a".repeat(PASSWORD_MAX_BYTES)).ok).toBe(true);
    const accented = "é".repeat(40); // 40 characters, 80 bytes
    const result = validateNewPassword(accented, accented);
    expect(result.ok === false && result.fieldErrors.password).toMatch(/at most 72/);
  });

  it("reports a mismatch on the confirmation field only", () => {
    const result = validateNewPassword("long enough password", "long enough passwort");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors).toEqual({ confirmPassword: "The two passwords don’t match." });
    }
  });

  it("treats non-string input as empty", () => {
    expect(validateNewPassword(null, undefined).ok).toBe(false);
  });
});

describe("passwordPageMode", () => {
  it("reads the session's authentication methods", () => {
    expect(passwordPageMode([{ method: "invite", timestamp: 1 }])).toBe("invite");
    expect(passwordPageMode([{ method: "recovery", timestamp: 1 }])).toBe("recovery");
    expect(passwordPageMode([{ method: "password", timestamp: 1 }])).toBe("change");
    expect(passwordPageMode(["otp"])).toBe("change");
    expect(passwordPageMode(undefined)).toBe("change");
    expect(passwordPageMode("invite")).toBe("change");
  });
});
