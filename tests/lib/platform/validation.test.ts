import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AdminPreviewRequest,
  CompleteUploadRequest,
  GenerateAnnouncementRequest,
  SignMediaRequest,
  SignUploadRequest,
  UpdatePreferencesRequest,
} from "@/lib/api/contracts";
import {
  adminPreviewRequestSchema,
  announcementCreateSchema,
  announcementUpdateSchema,
  businessCreateSchema,
  businessUpdateSchema,
  checkUploadFile,
  completeUploadRequestSchema,
  formatBytes,
  formDataToObject,
  generateAnnouncementRequestSchema,
  genreCreateSchema,
  genreReorderSchema,
  genreUpdateSchema,
  getFileExtension,
  inviteUserSchema,
  MAX_ANNOUNCEMENT_BYTES,
  MAX_LOGO_BYTES,
  MAX_TRACK_BYTES,
  signMediaRequestSchema,
  signUploadRequestSchema,
  slugify,
  summarizeValidationError,
  toFieldErrors,
  trackMetadataUpdateSchema,
  updatePreferencesRequestSchema,
  type AdminPreviewRequestInput,
  type CompleteUploadRequestInput,
  type GenerateAnnouncementRequestInput,
  type SignMediaRequestInput,
  type SignUploadRequestInput,
  type UpdatePreferencesRequestInput,
} from "@/lib/validation";

const ID = "3f1c2b9a-8d7e-4f6a-b5c4-d3e2f1a0b9c8";
const SEED_ID = "11111111-1111-1111-1111-111111111111";

function fieldsOf(result: { success: boolean; error?: unknown }) {
  if (result.success) throw new Error("expected failure");
  return toFieldErrors(result.error as Parameters<typeof toFieldErrors>[0]);
}

describe("contract conformance (compile-time)", () => {
  it("schema outputs are assignable to the shared contracts", () => {
    expectTypeOf<SignMediaRequestInput>().toExtend<SignMediaRequest>();
    expectTypeOf<UpdatePreferencesRequestInput>().toExtend<UpdatePreferencesRequest>();
    expectTypeOf<SignUploadRequestInput>().toExtend<SignUploadRequest>();
    expectTypeOf<CompleteUploadRequestInput>().toExtend<CompleteUploadRequest>();
    expectTypeOf<AdminPreviewRequestInput>().toExtend<AdminPreviewRequest>();
    expectTypeOf<GenerateAnnouncementRequestInput>().toExtend<GenerateAnnouncementRequest>();
  });
});

describe("API request schemas", () => {
  it("signMediaRequestSchema discriminates on kind and strips a client businessId", () => {
    expect(signMediaRequestSchema.parse({ kind: "track", id: ID, genreId: SEED_ID, businessId: ID })).toEqual({
      kind: "track",
      id: ID,
      genreId: SEED_ID,
    });
    expect(signMediaRequestSchema.safeParse({ kind: "track", id: ID }).success).toBe(false);
    expect(signMediaRequestSchema.safeParse({ kind: "announcement", id: "not-a-uuid" }).success).toBe(false);
    expect(signMediaRequestSchema.safeParse({ kind: "logo", id: ID }).success).toBe(false);
  });

  it("updatePreferencesRequestSchema bounds volume and requires at least one field", () => {
    expect(updatePreferencesRequestSchema.parse({ genreId: null })).toEqual({ genreId: null });
    expect(updatePreferencesRequestSchema.parse({ volume: 0, muted: true })).toEqual({ volume: 0, muted: true });
    expect(updatePreferencesRequestSchema.safeParse({ volume: 1.01 }).success).toBe(false);
    expect(updatePreferencesRequestSchema.safeParse({ volume: -0.1 }).success).toBe(false);
    expect(updatePreferencesRequestSchema.safeParse({ volume: "0.5" }).success).toBe(false);
    const empty = updatePreferencesRequestSchema.safeParse({});
    expect(empty.success).toBe(false);
    if (!empty.success) expect(summarizeValidationError(empty.error)).toMatch(/at least one/);
  });

  it("signUploadRequestSchema requires the per-kind target id", () => {
    const file = { fileName: " song.mp3 ", fileSize: 1234, contentType: "audio/mpeg" };
    expect(signUploadRequestSchema.parse({ kind: "track", ...file })).toEqual({ kind: "track", ...file, fileName: "song.mp3" });
    expect(signUploadRequestSchema.safeParse({ kind: "track-replace", ...file }).success).toBe(false);
    expect(signUploadRequestSchema.safeParse({ kind: "announcement", announcementId: ID, ...file }).success).toBe(true);
    expect(signUploadRequestSchema.safeParse({ kind: "logo", businessId: ID, ...file, fileSize: 0 }).success).toBe(false);
    expect(signUploadRequestSchema.safeParse({ kind: "logo", businessId: ID, ...file, fileSize: 1.5 }).success).toBe(false);
    expect(signUploadRequestSchema.safeParse({ kind: "video", ...file }).success).toBe(false);
  });

  it("completeUploadRequestSchema treats blank overrides as absent and dedupes genres", () => {
    expect(
      completeUploadRequestSchema.parse({
        uploadToken: "a.b",
        metadata: { title: "  ", artist: " Nina ", genreIds: [ID, ID, SEED_ID] },
      }),
    ).toEqual({ uploadToken: "a.b", metadata: { title: undefined, artist: "Nina", genreIds: [ID, SEED_ID] } });
    expect(completeUploadRequestSchema.safeParse({ uploadToken: "" }).success).toBe(false);
    expect(completeUploadRequestSchema.safeParse({ uploadToken: "a.b", metadata: { genreIds: ["x"] } }).success).toBe(false);
  });

  it("adminPreviewRequestSchema", () => {
    expect(adminPreviewRequestSchema.safeParse({ kind: "announcement", id: ID }).success).toBe(true);
    expect(adminPreviewRequestSchema.safeParse({ kind: "logo", id: ID }).success).toBe(false);
  });

  it("generateAnnouncementRequestSchema only allows URL-safe provider ids", () => {
    expect(
      generateAnnouncementRequestSchema.parse({ voiceId: "21m00Tcm4TlvDq8ikWAM", modelId: "eleven_multilingual_v2", force: true }),
    ).toEqual({ voiceId: "21m00Tcm4TlvDq8ikWAM", modelId: "eleven_multilingual_v2", force: true });
    expect(generateAnnouncementRequestSchema.safeParse({ voiceId: "../../v1/user", modelId: "m" }).success).toBe(false);
    expect(generateAnnouncementRequestSchema.safeParse({ voiceId: "abc?x=1", modelId: "m" }).success).toBe(false);
    expect(generateAnnouncementRequestSchema.safeParse({ voiceId: "abc", modelId: "m", languageCode: "english" }).success).toBe(false);
    expect(generateAnnouncementRequestSchema.safeParse({ voiceId: "abc", modelId: "m", languageCode: "bg" }).success).toBe(true);
  });
});

describe("business form schemas", () => {
  it("create applies defaults and normalises optional text", () => {
    expect(
      businessCreateSchema.parse({ name: "  EmeraldBar ", stationName: "EmeraldBar Radio", namePronunciation: "  ", contactEmail: "" }),
    ).toEqual({
      name: "EmeraldBar",
      stationName: "EmeraldBar Radio",
      namePronunciation: null,
      stationNamePronunciation: null,
      contactEmail: null,
      announcementLanguage: "en",
      isActive: false,
      announcementEveryNTracks: 4,
      announcementVolume: 1,
    });
  });

  it("create parses FormData string values", () => {
    const form = new FormData();
    form.append("name", "Hotel Aurora");
    form.append("stationName", "Aurora Lounge");
    form.append("contactEmail", "desk@aurora.example");
    form.append("announcementLanguage", "bg");
    form.append("isActive", "false");
    form.append("isActive", "on");
    form.append("announcementEveryNTracks", "6");
    form.append("announcementVolume", "0.755");
    form.append("$ACTION_ID_abc", "");
    expect(businessCreateSchema.parse(formDataToObject(form))).toMatchObject({
      contactEmail: "desk@aurora.example",
      announcementLanguage: "bg",
      isActive: true,
      announcementEveryNTracks: 6,
      announcementVolume: 0.76,
    });
  });

  it("create enforces ranges and formats with field messages", () => {
    const result = businessCreateSchema.safeParse({
      name: "",
      stationName: "x".repeat(121),
      contactEmail: "not-an-email",
      announcementLanguage: "English",
      announcementEveryNTracks: "51",
      announcementVolume: "0.05",
    });
    const fields = fieldsOf(result);
    expect(Object.keys(fields).sort()).toEqual(
      ["announcementEveryNTracks", "announcementLanguage", "announcementVolume", "contactEmail", "name", "stationName"].sort(),
    );
    expect(fields.name).toBe("Business name is required.");
    expect(fields.announcementEveryNTracks).toBe("Announcement interval must be between 1 and 50.");
  });

  it("rejects non-integers and non-numbers for the interval", () => {
    expect(fieldsOf(businessCreateSchema.safeParse({ name: "a", stationName: "b", announcementEveryNTracks: "2.5" })).announcementEveryNTracks).toBe(
      "Announcement interval must be a whole number.",
    );
    expect(fieldsOf(businessCreateSchema.safeParse({ name: "a", stationName: "b", announcementEveryNTracks: "abc" })).announcementEveryNTracks).toBe(
      "Announcement interval must be a number.",
    );
  });

  it("update leaves omitted fields undefined (unchanged) and clears blank text", () => {
    expect(businessUpdateSchema.parse({ isActive: "true" })).toEqual({ isActive: true });
    expect(businessUpdateSchema.parse({ namePronunciation: "", announcementVolume: 0.1 })).toEqual({
      namePronunciation: null,
      announcementVolume: 0.1,
    });
    expect(businessUpdateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(businessUpdateSchema.safeParse({ isActive: "maybe" }).success).toBe(false);
  });
});

describe("genre schemas and slugify", () => {
  it("slugify produces DB-valid slugs", () => {
    expect(slugify("Chill Out")).toBe("chill-out");
    expect(slugify("  Café del Mar!! ")).toBe("cafe-del-mar");
    expect(slugify("R&B / Soul")).toBe("r-and-b-soul");
    expect(slugify("Джаз")).toBe("");
    expect(slugify("a".repeat(59) + " b")).toBe("a".repeat(59));
  });

  it("create derives the slug from the name when blank", () => {
    expect(genreCreateSchema.parse({ name: "Lounge Jazz", slug: "" })).toEqual({
      name: "Lounge Jazz",
      slug: "lounge-jazz",
      description: null,
      isEnabled: true,
      availableToAll: true,
      sortOrder: undefined,
    });
    expect(genreCreateSchema.parse({ name: "Lounge Jazz", slug: "jazz", isEnabled: "false" })).toMatchObject({
      slug: "jazz",
      isEnabled: false,
    });
  });

  it("create rejects invalid or underivable slugs on the slug field", () => {
    expect(fieldsOf(genreCreateSchema.safeParse({ name: "Jazz", slug: "Jazz Club" })).slug).toMatch(/lowercase/);
    expect(fieldsOf(genreCreateSchema.safeParse({ name: "Джаз" })).slug).toMatch(/Could not derive a slug/);
    expect(genreCreateSchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
    expect(genreCreateSchema.safeParse({ name: "Jazz", description: "d".repeat(281) }).success).toBe(false);
  });

  it("update keeps the slug when blank", () => {
    expect(genreUpdateSchema.parse({ name: "New name", slug: "" })).toEqual({ name: "New name", slug: undefined });
    expect(genreUpdateSchema.parse({ availableToAll: "off", sortOrder: "3" })).toEqual({ availableToAll: false, sortOrder: 3 });
  });

  it("reorder requires a non-empty id list", () => {
    expect(genreReorderSchema.parse({ genreIds: [ID, SEED_ID, ID] })).toEqual({ genreIds: [ID, SEED_ID] });
    expect(genreReorderSchema.safeParse({ genreIds: [] }).success).toBe(false);
  });
});

describe("track, announcement and invite schemas", () => {
  it("trackMetadataUpdateSchema defaults the artist and genre list", () => {
    expect(trackMetadataUpdateSchema.parse({ title: " Night Drive ", artist: "  " })).toEqual({
      title: "Night Drive",
      artist: "Unknown Artist",
      genreIds: [],
    });
    const form = new FormData();
    form.append("title", "Song");
    form.append("artist", "Band");
    form.append("genreIds", ID);
    form.append("genreIds", SEED_ID);
    expect(trackMetadataUpdateSchema.parse(formDataToObject(form, { arrays: ["genreIds"] }))).toEqual({
      title: "Song",
      artist: "Band",
      genreIds: [ID, SEED_ID],
    });
    expect(trackMetadataUpdateSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("announcementCreateSchema applies defaults and validates template keys", () => {
    expect(announcementCreateSchema.parse({ text: "Welcome to EmeraldBar", templateKey: "", spokenText: " " })).toEqual({
      templateKey: null,
      placement: "rotation",
      text: "Welcome to EmeraldBar",
      spokenText: null,
      language: undefined,
    });
    expect(announcementCreateSchema.safeParse({ text: "x", templateKey: "Bad Key!" }).success).toBe(false);
    expect(announcementCreateSchema.safeParse({ text: "x", placement: "intro" }).success).toBe(false);
    expect(announcementCreateSchema.safeParse({ text: "x".repeat(501) }).success).toBe(false);
    expect(announcementCreateSchema.safeParse({ text: "x", spokenText: "y".repeat(1001) }).success).toBe(false);
  });

  it("announcementUpdateSchema is partial", () => {
    expect(announcementUpdateSchema.parse({ placement: "both" })).toEqual({ placement: "both" });
    expect(announcementUpdateSchema.parse({ spokenText: "" })).toEqual({ spokenText: null });
  });

  it("inviteUserSchema normalises email and defaults delivery", () => {
    expect(inviteUserSchema.parse({ email: "  Manager@EmeraldBar.Example ", businessId: ID })).toEqual({
      email: "manager@emeraldbar.example",
      businessId: ID,
      delivery: "email",
    });
    expect(inviteUserSchema.safeParse({ email: "x@y.z", businessId: ID, delivery: "sms" }).success).toBe(false);
    expect(inviteUserSchema.safeParse({ email: "nope", businessId: ID }).success).toBe(false);
  });
});

describe("formDataToObject", () => {
  it("keeps the last value for scalars, arrays for listed keys, and drops React action fields", () => {
    const form = new FormData();
    form.append("$ACTION_REF_1", "");
    form.append("$ACTION_1:0", "{}");
    form.append("flag", "false");
    form.append("flag", "true");
    form.append("tags", "a");
    form.append("tags", "b");
    expect(formDataToObject(form, { arrays: ["tags", "empty"] })).toEqual({ flag: "true", tags: ["a", "b"], empty: [] });
  });
});

describe("upload limits", () => {
  it("exposes the bucket byte limits", () => {
    expect(MAX_TRACK_BYTES).toBe(52_428_800);
    expect(MAX_ANNOUNCEMENT_BYTES).toBe(10_485_760);
    expect(MAX_LOGO_BYTES).toBe(2_097_152);
  });

  it("getFileExtension and formatBytes", () => {
    expect(getFileExtension("My Song.MP3")).toBe(".mp3");
    expect(getFileExtension("folder.v2/noext")).toBe("");
    expect(getFileExtension(".hidden")).toBe("");
    expect(formatBytes(MAX_TRACK_BYTES)).toBe("50 MB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1)).toBe("1 byte");
  });

  it("accepts MP3s reported with common MIME variants and normalises to audio/mpeg", () => {
    for (const type of ["audio/mpeg", "audio/mp3", "audio/x-mpeg-3", "", "application/octet-stream"]) {
      expect(checkUploadFile("track", { name: "a.mp3", size: 1000, type })).toEqual({ ok: true, contentType: "audio/mpeg", extension: "mp3" });
    }
  });

  it("rejects wrong audio types, oversized and empty files", () => {
    expect(checkUploadFile("track", { name: "a.wav", size: 1000, type: "audio/wav" })).toMatchObject({ ok: false, code: "unsupported_media" });
    expect(checkUploadFile("track", { name: "a.mp3", size: 1000, type: "video/mp4" })).toMatchObject({ ok: false, code: "unsupported_media" });
    expect(checkUploadFile("track", { name: "a.mp3", size: MAX_TRACK_BYTES + 1, type: "audio/mpeg" })).toMatchObject({
      ok: false,
      code: "payload_too_large",
    });
    expect(checkUploadFile("track", { name: "a.mp3", size: MAX_TRACK_BYTES, type: "audio/mpeg" }).ok).toBe(true);
    expect(checkUploadFile("announcement", { name: "a.mp3", size: MAX_ANNOUNCEMENT_BYTES + 1, type: "audio/mpeg" })).toMatchObject({
      ok: false,
      code: "payload_too_large",
    });
    expect(checkUploadFile("track", { name: "a.mp3", size: 0, type: "audio/mpeg" })).toMatchObject({ ok: false, code: "invalid_request" });
  });

  it("checks logos by extension and type", () => {
    expect(checkUploadFile("logo", { name: "logo.JPEG", size: 10, type: "image/jpeg" })).toEqual({
      ok: true,
      contentType: "image/jpeg",
      extension: "jpg",
    });
    expect(checkUploadFile("logo", { name: "logo.webp", size: 10, type: "" })).toEqual({ ok: true, contentType: "image/webp", extension: "webp" });
    expect(checkUploadFile("logo", { name: "logo.png", size: 10, type: "image/jpeg" })).toMatchObject({ ok: false, code: "unsupported_media" });
    expect(checkUploadFile("logo", { name: "logo.gif", size: 10, type: "image/gif" })).toMatchObject({ ok: false, code: "unsupported_media" });
    expect(checkUploadFile("logo", { name: "logo.svg", size: 10, type: "image/svg+xml" })).toMatchObject({ ok: false, code: "unsupported_media" });
    expect(checkUploadFile("logo", { name: "logo.png", size: MAX_LOGO_BYTES + 1, type: "image/png" })).toMatchObject({
      ok: false,
      code: "payload_too_large",
    });
  });
});
