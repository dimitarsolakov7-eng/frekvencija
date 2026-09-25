import { createHmac, hkdfSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUploadToken,
  UPLOAD_TOKEN_TTL_SECONDS,
  verifyUploadToken,
  type UploadTokenClaims,
} from "@/lib/uploads/token";

const ADMIN_ID = "5b1b3a52-37a4-4b8e-9d3c-6a8b2f1e0c11";
const TRACK_CLAIMS: UploadTokenClaims = {
  kind: "track",
  bucket: "music",
  path: "tracks/0d6a7f7e-2d34-4c1c-9a53-1f7d0b3c9e21/Zx8k2.mp3",
  targetId: null,
  userId: ADMIN_ID,
};
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);

function tamperPayload(token: string, change: (payload: Record<string, unknown>) => void): string {
  const [segment, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
  change(payload);
  return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "fake_secret_test_key_for_upload_tokens");
  vi.stubEnv("UPLOAD_TOKEN_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("upload tokens", () => {
  it("round-trips a valid token", () => {
    const token = createUploadToken(TRACK_CLAIMS, { now: NOW });
    const result = verifyUploadToken(token, { now: NOW + 60_000, expectedUserId: ADMIN_ID, expectedKind: "track" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toMatchObject({ v: 1, ...TRACK_CLAIMS, exp: NOW / 1000 + UPLOAD_TOKEN_TTL_SECONDS });
      expect(result.payload.nonce.length).toBeGreaterThanOrEqual(16);
    }
  });

  it("issues a distinct token each time (random nonce)", () => {
    expect(createUploadToken(TRACK_CLAIMS, { now: NOW })).not.toBe(createUploadToken(TRACK_CLAIMS, { now: NOW }));
  });

  it("rejects a tampered payload", () => {
    const token = createUploadToken(TRACK_CLAIMS, { now: NOW });
    const forged = tamperPayload(token, (payload) => {
      payload.path = "tracks/other/evil.mp3";
    });
    expect(verifyUploadToken(forged, { now: NOW })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered signature", () => {
    const token = createUploadToken(TRACK_CLAIMS, { now: NOW });
    const [segment, signature] = token.split(".");
    const flipped = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    expect(verifyUploadToken(`${segment}.${flipped}`, { now: NOW })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyUploadToken(`${segment}.${signature.slice(0, 10)}`, { now: NOW })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects malformed tokens", () => {
    for (const token of ["", "abc", "a.b.c", "a b.c", "@@@.###", `${"a".repeat(5000)}.b`]) {
      expect(verifyUploadToken(token, { now: NOW })).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("rejects expired tokens", () => {
    const token = createUploadToken(TRACK_CLAIMS, { now: NOW });
    const justBefore = NOW + (UPLOAD_TOKEN_TTL_SECONDS - 1) * 1000;
    const atExpiry = NOW + UPLOAD_TOKEN_TTL_SECONDS * 1000;
    expect(verifyUploadToken(token, { now: justBefore }).ok).toBe(true);
    expect(verifyUploadToken(token, { now: atExpiry })).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a kind the caller does not expect", () => {
    const token = createUploadToken(TRACK_CLAIMS, { now: NOW });
    expect(verifyUploadToken(token, { now: NOW, expectedKind: "logo" })).toEqual({ ok: false, reason: "kind_mismatch" });
    expect(verifyUploadToken(token, { now: NOW, expectedKind: ["announcement", "logo"] })).toEqual({
      ok: false,
      reason: "kind_mismatch",
    });
    expect(verifyUploadToken(token, { now: NOW, expectedKind: ["track", "track-replace"] }).ok).toBe(true);
  });

  it("rejects a token completed by another user", () => {
    const token = createUploadToken(TRACK_CLAIMS, { now: NOW });
    expect(verifyUploadToken(token, { now: NOW, expectedUserId: "someone-else" })).toEqual({
      ok: false,
      reason: "user_mismatch",
    });
  });

  it("refuses to sign kind/bucket/target combinations that cannot be genuine", () => {
    expect(() => createUploadToken({ ...TRACK_CLAIMS, bucket: "logos" }, { now: NOW })).toThrow();
    expect(() => createUploadToken({ ...TRACK_CLAIMS, kind: "track-replace", targetId: null }, { now: NOW })).toThrow();
    expect(() => createUploadToken({ ...TRACK_CLAIMS, path: "../escape.mp3" }, { now: NOW })).toThrow();
  });

  it("rejects a correctly signed but inconsistent payload (kind/bucket mismatch)", () => {
    // Simulate an attacker who knows the key: the structural checks still apply.
    const key = Buffer.from(hkdfSync("sha256", "fake_secret_test_key_for_upload_tokens", "", "venue-radio/upload-token/v1", 32));
    const payload = { v: 1, ...TRACK_CLAIMS, kind: "logo", exp: NOW / 1000 + 600, nonce: "abcdefghijklmnopqrstuv" };
    const segment = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", key).update(segment).digest("base64url");
    expect(verifyUploadToken(`${segment}.${signature}`, { now: NOW })).toEqual({ ok: false, reason: "invalid_payload" });
  });

  it("rejects tokens whose expiry is further out than any genuine token", () => {
    const key = Buffer.from(hkdfSync("sha256", "fake_secret_test_key_for_upload_tokens", "", "venue-radio/upload-token/v1", 32));
    const payload = { v: 1, ...TRACK_CLAIMS, exp: NOW / 1000 + 86_400, nonce: "abcdefghijklmnopqrstuv" };
    const segment = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", key).update(segment).digest("base64url");
    expect(verifyUploadToken(`${segment}.${signature}`, { now: NOW })).toEqual({ ok: false, reason: "invalid_payload" });
  });

  it("tokens from one secret do not verify under another", () => {
    const token = createUploadToken(TRACK_CLAIMS, { now: NOW });
    vi.stubEnv("UPLOAD_TOKEN_SECRET", "a-dedicated-upload-token-secret-of-sufficient-length");
    expect(verifyUploadToken(token, { now: NOW })).toEqual({ ok: false, reason: "bad_signature" });
    const dedicated = createUploadToken(TRACK_CLAIMS, { now: NOW });
    expect(verifyUploadToken(dedicated, { now: NOW }).ok).toBe(true);
  });

  it("fails loudly when no secret is configured", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => createUploadToken(TRACK_CLAIMS, { now: NOW })).toThrow(/UPLOAD_TOKEN_SECRET or SUPABASE_SECRET_KEY/);
  });
});
