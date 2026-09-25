import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateAnnouncement,
  approveAnnouncement,
  createAnnouncement,
  deactivateAnnouncement,
  deleteAnnouncement,
  duplicateAnnouncement,
  loadAnnouncementsPage,
  markGenerationFailed,
  STALLED_GENERATION_MESSAGE,
  updateAnnouncementWording,
  updatePlaybackSettings,
  type AnnouncementMutationDeps,
} from "@/lib/data/admin/announcements";
import { FakeSupabase } from "../../api/announcements/fake-supabase";
import {
  ACTIVE_ID,
  ACTIVE_PATH,
  ADMIN_ID,
  APPROVED_AT,
  BUSINESS_ID,
  DRAFT_ID,
  FLAGGED_ACTIVE_ID,
  GENERATING_ID,
  READY_TTS_ID,
  READY_TTS_PATH,
  seedWorld,
  STALE_GENERATING_ID,
  UNKNOWN_ID,
  UPLOADED_READY_ID,
  UPLOADED_READY_PATH,
} from "../../api/announcements/fixtures";

let db: FakeSupabase;
let deps: AnnouncementMutationDeps;
const NOW = new Date();

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

beforeEach(() => {
  db = new FakeSupabase();
  seedWorld(db, NOW.getTime());
  db.currentUserId = ADMIN_ID;
  deps = { supabase: db.client("user"), userId: ADMIN_ID, storageAdmin: () => db.client("admin"), now: NOW };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("loadAnnouncementsPage", () => {
  it("maps the venue and its announcements, oldest first, with approver emails and a suggested voice", async () => {
    db.patchRow("announcements", DRAFT_ID, { created_at: "2026-09-19T10:00:00.000Z" });
    const data = await loadAnnouncementsPage(db.client("user"), BUSINESS_ID);
    expect(data?.business).toMatchObject({ name: "EmeraldBar", stationName: "EmeraldBar Radio", everyNTracks: 4, volume: 1, brandingVersion: 2 });
    expect(data?.announcements[0].id).toBe(DRAFT_ID);
    expect(data?.announcements.find((item) => item.id === ACTIVE_ID)).toMatchObject({ approvedByEmail: "admin@example.com", brandingVersion: 2 });
    expect(data?.suggestedVoiceId).toBe("voiceRachel01");
    expect(await loadAnnouncementsPage(db.client("user"), UNKNOWN_ID)).toBeNull();
  });
});

describe("updatePlaybackSettings", () => {
  it("saves the interval and converts the volume percentage to a gain", async () => {
    const outcome = await updatePlaybackSettings(deps, BUSINESS_ID, form({ announcementEveryNTracks: "6", announcementVolumePercent: "75" }));
    expect(outcome).toMatchObject({ businessId: BUSINESS_ID, state: { ok: true } });
    expect(db.row("businesses", BUSINESS_ID)).toMatchObject({ announcement_every_n_tracks: 6, announcement_volume: 0.75 });
  });

  it("rejects out-of-range values with field errors and echoes the input", async () => {
    const outcome = await updatePlaybackSettings(deps, BUSINESS_ID, form({ announcementEveryNTracks: "0", announcementVolumePercent: "5" }));
    expect(outcome.businessId).toBeNull();
    expect(outcome.state.ok).toBe(false);
    expect(Object.keys(outcome.state.fieldErrors).sort()).toEqual(["announcementEveryNTracks", "announcementVolumePercent"]);
    expect(outcome.state.values).toEqual({ announcementEveryNTracks: "0", announcementVolumePercent: "5" });
    expect(db.events).toEqual([]);
  });

  it("reports a missing venue", async () => {
    const outcome = await updatePlaybackSettings(deps, UNKNOWN_ID, form({ announcementEveryNTracks: "4", announcementVolumePercent: "100" }));
    expect(outcome.state).toMatchObject({ ok: false, message: "This venue no longer exists." });
  });
});

describe("createAnnouncement", () => {
  it("renders a template with the venue's current names and pronunciations as a draft", async () => {
    db.patchRow("businesses", BUSINESS_ID, { announcement_language: "bg" });
    const outcome = await createAnnouncement(
      deps,
      BUSINESS_ID,
      form({ mode: "template", templateKey: "station_listening", placement: "rotation", language: "", spokenText: "" }),
    );
    expect(outcome.state.ok).toBe(true);
    const created = db.rows("announcements").at(-1)!;
    expect(created).toMatchObject({
      business_id: BUSINESS_ID,
      template_key: "station_listening",
      placement: "rotation",
      text: "You’re listening to EmeraldBar Radio.",
      spoken_text: "You’re listening to Emerald Bar Radio.",
      language: "bg",
      status: "draft",
      branding_version: 2,
      created_by: ADMIN_ID,
    });
  });

  it("renders custom wording with placeholders and honours a spoken override", async () => {
    await createAnnouncement(
      deps,
      BUSINESS_ID,
      form({ mode: "custom", customText: "Happy hour at {business_name}!", placement: "both", language: "en", spokenText: "Happy hour at Emerald Bar, from five!" }),
    );
    expect(db.rows("announcements").at(-1)).toMatchObject({
      template_key: null,
      text: "Happy hour at EmeraldBar!",
      spoken_text: "Happy hour at Emerald Bar, from five!",
      placement: "both",
    });
  });

  it("stores no spoken wording when the override equals the display text", async () => {
    await createAnnouncement(deps, BUSINESS_ID, form({ mode: "custom", customText: "Last orders.", spokenText: "Last orders.", placement: "rotation", language: "en" }));
    expect(db.rows("announcements").at(-1)).toMatchObject({ text: "Last orders.", spoken_text: null });
  });

  it("reports invalid wording, unknown templates and bad languages on the right fields", async () => {
    const bad = await createAnnouncement(deps, BUSINESS_ID, form({ mode: "custom", customText: "Hi {guest}", placement: "rotation", language: "en" }));
    expect(bad.state.fieldErrors.customText).toContain("{guest}");
    expect(bad.state.values?.customText).toBe("Hi {guest}");

    const unknown = await createAnnouncement(deps, BUSINESS_ID, form({ mode: "template", templateKey: "nope", placement: "rotation", language: "en" }));
    expect(unknown.state.fieldErrors).toHaveProperty("templateKey");

    const language = await createAnnouncement(deps, BUSINESS_ID, form({ mode: "template", templateKey: "good_music", placement: "rotation", language: "English" }));
    expect(language.state.fieldErrors).toHaveProperty("language");
    expect(db.events.filter((event) => event.includes("insert"))).toEqual([]);
  });
});

describe("updateAnnouncementWording", () => {
  const edit = (id: string, values: Record<string, string>) => updateAnnouncementWording(deps, id, form(values));
  const base = { text: "Welcome to EmeraldBar. Enjoy the music.", placement: "welcome", language: "en" };

  it("discards generated audio when the spoken wording changes, removing the object after the update", async () => {
    const outcome = await edit(READY_TTS_ID, { ...base, spokenText: "Welcome to Emmerald Bar. Enjoy!" });
    expect(outcome.state).toMatchObject({ ok: true, message: expect.stringContaining("generated audio was removed") });
    expect(db.row("announcements", READY_TTS_ID)).toMatchObject({
      status: "draft",
      audio_path: null,
      source: null,
      generation_hash: null,
      spoken_text: "Welcome to Emmerald Bar. Enjoy!",
      voice_id: "voiceRachel01",
    });
    const update = db.events.indexOf("db:user:update:announcements");
    expect(db.events.indexOf(`storage:admin:remove:announcements/${READY_TTS_PATH}`)).toBeGreaterThan(update);
    expect(db.hasObject("announcements", READY_TTS_PATH)).toBe(false);
  });

  it("takes on-air generated audio off air when its spoken wording changes (the UI warns first)", async () => {
    await edit(ACTIVE_ID, { ...base, spokenText: "Something else." });
    expect(db.row("announcements", ACTIVE_ID)).toMatchObject({ status: "draft", approved_at: null, audio_path: null });
    expect(db.hasObject("announcements", ACTIVE_PATH)).toBe(false);
  });

  it("keeps uploaded audio and says so", async () => {
    const outcome = await edit(UPLOADED_READY_ID, { ...base, text: "Welcome, friends.", spokenText: "" });
    expect(outcome.state.message).toContain("uploaded audio was kept");
    expect(db.row("announcements", UPLOADED_READY_ID)).toMatchObject({ status: "ready", audio_path: UPLOADED_READY_PATH, text: "Welcome, friends.", spoken_text: null });
    expect(db.hasObject("announcements", UPLOADED_READY_PATH)).toBe(true);
  });

  it("keeps generated audio when only the display text or placement changes", async () => {
    await edit(READY_TTS_ID, { ...base, text: "Welcome to EmeraldBar!", spokenText: "Welcome to Emerald Bar. Enjoy the music.", placement: "both" });
    expect(db.row("announcements", READY_TTS_ID)).toMatchObject({ status: "ready", audio_path: READY_TTS_PATH, placement: "both" });
  });

  it("clears the review flag of a draft once its wording is saved", async () => {
    db.patchRow("announcements", DRAFT_ID, { needs_review: true, review_reason: "Branding changed" });
    await edit(DRAFT_ID, { ...base, text: "Welcome to the new EmeraldBar.", spokenText: "" });
    expect(db.row("announcements", DRAFT_ID)).toMatchObject({ needs_review: false, review_reason: null });
  });

  it("refuses placeholders, edits during a generation, and reports no-op saves", async () => {
    const braces = await edit(DRAFT_ID, { ...base, text: "Welcome to {business_name}", spokenText: "" });
    expect(braces.state.fieldErrors).toHaveProperty("text");

    const busy = await edit(GENERATING_ID, { ...base, spokenText: "" });
    expect(busy.state).toMatchObject({ ok: false, message: expect.stringContaining("being generated") });

    const same = await edit(DRAFT_ID, { ...base, spokenText: "Welcome to Emerald Bar. Enjoy the music." });
    expect(same).toMatchObject({ businessId: null, state: { ok: true, message: "Nothing changed." } });
    expect(db.events.filter((event) => event.includes("update"))).toEqual([]);
  });

  // ANN-01: the studio's upload path saves text/placement/language without spokenText.
  it("keeps generated audio and its spoken wording when a save leaves spokenText out", async () => {
    const outcome = await edit(READY_TTS_ID, { text: base.text, placement: "both", language: "en" });
    expect(outcome.state.ok).toBe(true);
    expect(outcome.state.message).not.toContain("removed");
    expect(db.row("announcements", READY_TTS_ID)).toMatchObject({
      status: "ready",
      source: "tts",
      audio_path: READY_TTS_PATH,
      spoken_text: "Welcome to Emerald Bar. Enjoy the music.",
      placement: "both",
      generation_hash: "0".repeat(64),
    });
    expect(db.hasObject("announcements", READY_TTS_PATH)).toBe(true);
    expect(db.events.some((event) => event.startsWith("storage:"))).toBe(false);
  });

  it("changes only the fields the form sent", async () => {
    await edit(READY_TTS_ID, { placement: "rotation" });
    expect(db.row("announcements", READY_TTS_ID)).toMatchObject({
      status: "ready",
      audio_path: READY_TTS_PATH,
      placement: "rotation",
      text: "Welcome to EmeraldBar. Enjoy the music.",
      spoken_text: "Welcome to Emerald Bar. Enjoy the music.",
      language: "en",
    });
    const same = await edit(READY_TTS_ID, { language: "en" });
    expect(same.state.message).toBe("Nothing changed.");
  });

  it("still clears the spoken wording when an empty spokenText is sent on purpose", async () => {
    await edit(UPLOADED_READY_ID, { spokenText: "" });
    expect(db.row("announcements", UPLOADED_READY_ID)).toMatchObject({ spoken_text: null, audio_path: UPLOADED_READY_PATH });
  });

  it("does not overwrite a row that changed after it was read", async () => {
    db.beforeNext("db:announcements:update", () => db.patchRow("announcements", READY_TTS_ID, { generation_attempts: 5 }));
    const outcome = await edit(READY_TTS_ID, { ...base, spokenText: "Changed." });
    expect(outcome.state).toMatchObject({ ok: false, message: expect.stringContaining("changed in the meantime") });
    expect(db.hasObject("announcements", READY_TTS_PATH)).toBe(true);
  });
});

describe("approve / activate / deactivate", () => {
  it("approves ready audio: active, approved by the admin under the current branding version", async () => {
    const row = db.row("announcements", READY_TTS_ID)!;
    db.patchRow("announcements", READY_TTS_ID, { branding_version: 1, last_error: "old" });
    const outcome = await approveAnnouncement(deps, READY_TTS_ID, row.updated_at as string);
    expect(outcome.state).toMatchObject({ ok: true, message: "Approved. It is on air now." });
    expect(db.row("announcements", READY_TTS_ID)).toMatchObject({
      status: "active",
      approved_at: NOW.toISOString(),
      approved_by: ADMIN_ID,
      branding_version: 2,
      needs_review: false,
      review_reason: null,
      last_error: null,
    });
  });

  it("re-approves flagged on-air audio", async () => {
    await approveAnnouncement(deps, FLAGGED_ACTIVE_ID, null);
    expect(db.row("announcements", FLAGGED_ACTIVE_ID)).toMatchObject({ status: "active", needs_review: false, branding_version: 2 });
  });

  it("refuses to approve audio that changed since the page was loaded, or that does not exist", async () => {
    expect((await approveAnnouncement(deps, READY_TTS_ID, "2020-01-01T00:00:00.000Z")).state.message).toContain("changed since the page was loaded");
    expect((await approveAnnouncement(deps, DRAFT_ID, null)).state.message).toContain("no audio to approve");
    expect((await approveAnnouncement(deps, ACTIVE_ID, null)).state.message).toContain("already approved");
    expect((await approveAnnouncement(deps, "nope", null)).state.ok).toBe(false);
  });

  it("deactivates (keeping the approval) and re-activates without a new approval", async () => {
    expect((await deactivateAnnouncement(deps, ACTIVE_ID)).state.ok).toBe(true);
    expect(db.row("announcements", ACTIVE_ID)).toMatchObject({ status: "ready", approved_at: APPROVED_AT });
    expect((await activateAnnouncement(deps, ACTIVE_ID, null)).state.ok).toBe(true);
    expect(db.row("announcements", ACTIVE_ID)).toMatchObject({ status: "active", approved_at: APPROVED_AT });
  });

  it("will not re-activate audio approved under older branding", async () => {
    db.patchRow("announcements", ACTIVE_ID, { status: "ready", branding_version: 1 });
    const outcome = await activateAnnouncement(deps, ACTIVE_ID, null);
    expect(outcome.state).toMatchObject({ ok: false, message: expect.stringContaining("branding changed") });
    expect((await deactivateAnnouncement(deps, DRAFT_ID)).state.ok).toBe(false);
  });
});

describe("delete / duplicate / stalled generations", () => {
  it("deletes the row first, then its audio object", async () => {
    const outcome = await deleteAnnouncement(deps, ACTIVE_ID);
    expect(outcome).toMatchObject({ businessId: BUSINESS_ID, state: { ok: true } });
    expect(db.row("announcements", ACTIVE_ID)).toBeUndefined();
    expect(db.events.indexOf(`storage:admin:remove:announcements/${ACTIVE_PATH}`)).toBeGreaterThan(db.events.indexOf("db:user:delete:announcements"));
    expect(db.hasObject("announcements", ACTIVE_PATH)).toBe(false);
  });

  it("keeps the object when the row could not be deleted, and refuses during a generation", async () => {
    db.failNext("db:announcements:delete", { code: "42501", message: "permission denied" });
    expect((await deleteAnnouncement(deps, ACTIVE_ID)).state.message).toBe("You don't have permission to do that.");
    expect(db.hasObject("announcements", ACTIVE_PATH)).toBe(true);

    expect((await deleteAnnouncement(deps, GENERATING_ID)).state.ok).toBe(false);
    expect(db.row("announcements", GENERATING_ID)).toBeDefined();
  });

  it("duplicates wording and the voice suggestion into a new draft without audio", async () => {
    const outcome = await duplicateAnnouncement(deps, ACTIVE_ID);
    expect(outcome.state.message).toContain("original keeps playing");
    const copy = db.rows("announcements").at(-1)!;
    expect(copy.id).not.toBe(ACTIVE_ID);
    expect(copy).toMatchObject({
      status: "draft",
      text: "Welcome to EmeraldBar. Enjoy the music.",
      spoken_text: "Welcome to Emerald Bar. Enjoy the music.",
      placement: "welcome",
      voice_id: "voiceRachel01",
      model_id: "eleven_multilingual_v2",
      branding_version: 2,
      created_by: ADMIN_ID,
    });
    expect(copy.audio_path ?? null).toBeNull();
    expect(copy.approved_at ?? null).toBeNull();
    expect(db.row("announcements", ACTIVE_ID)).toMatchObject({ status: "active" });
  });

  it("marks a stalled generation as failed, but not a running one", async () => {
    expect((await markGenerationFailed(deps, GENERATING_ID)).state.message).toContain("still being generated");
    const outcome = await markGenerationFailed(deps, STALE_GENERATING_ID);
    expect(outcome.state.ok).toBe(true);
    expect(db.row("announcements", STALE_GENERATING_ID)).toMatchObject({
      status: "failed",
      generation_started_at: null,
      last_error: STALLED_GENERATION_MESSAGE,
    });
  });

  it("returns a stalled generation that still has audio to ready", async () => {
    db.patchRow("announcements", READY_TTS_ID, { status: "generating", generation_started_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() });
    await markGenerationFailed(deps, READY_TTS_ID);
    expect(db.row("announcements", READY_TTS_ID)).toMatchObject({ status: "ready", audio_path: READY_TTS_PATH });
  });
});
