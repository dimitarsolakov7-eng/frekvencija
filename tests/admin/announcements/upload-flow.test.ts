/**
 * ANN-01: uploading a recording from the studio must not clear or delete anything before the new MP3
 * has passed the server's checks. The studio's order (runRecordingUpload) is tested with injected
 * steps, then played through the real wording mutation on the fake database: a rejected upload leaves
 * the generated audio and the respelled spoken wording intact, and wording edits saved after an
 * accepted upload keep the uploaded audio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnouncementBusiness, AnnouncementItem } from "@/components/admin/announcements/rules";
import {
  editorStateFromRecording,
  spokenWordingEdited,
  wordingSaveFields,
  type EditorState,
} from "@/components/admin/announcements/studio-model";
import { runRecordingUpload, type RecordingUploadSteps } from "@/components/admin/announcements/upload-flow";
import type { ActionState } from "@/lib/actions/state";
import { updateAnnouncementWording, type AnnouncementMutationDeps } from "@/lib/data/admin/announcements";
import { UploadError } from "@/lib/uploads/client";
import { FakeSupabase } from "../../api/announcements/fake-supabase";
import { ADMIN_ID, BUSINESS_ID, READY_TTS_ID, READY_TTS_PATH, seedWorld } from "../../api/announcements/fixtures";

const OK: ActionState = { ok: true, message: null, fieldErrors: {} };

function recordedSteps(overrides: Partial<RecordingUploadSteps> = {}) {
  const calls: string[] = [];
  const steps: RecordingUploadSteps = {
    existingId: "rec-1",
    createDraft: async () => {
      calls.push("createDraft");
      return "new-draft";
    },
    upload: async (announcementId) => {
      calls.push(`upload:${announcementId}`);
    },
    saveWording: async (announcementId) => {
      calls.push(`saveWording:${announcementId}`);
      return OK;
    },
    ...overrides,
  };
  return { calls, steps };
}

describe("runRecordingUpload: the order of the steps", () => {
  it("saves an existing recording's wording edits only after the file was accepted", async () => {
    const { calls, steps } = recordedSteps();
    await expect(runRecordingUpload(steps)).resolves.toEqual({ kind: "uploaded", announcementId: "rec-1", wording: OK });
    expect(calls).toEqual(["upload:rec-1", "saveWording:rec-1"]);
  });

  it("changes nothing when the server rejects the file", async () => {
    const { calls, steps } = recordedSteps();
    const rejected = new UploadError("unsupported_media", "This is not an MP3 file.");
    steps.upload = async (announcementId) => {
      calls.push(`upload:${announcementId}`);
      throw rejected;
    };
    await expect(runRecordingUpload(steps)).rejects.toBe(rejected);
    expect(calls).toEqual(["upload:rec-1"]);
  });

  it("changes nothing when the admin cancels the upload", async () => {
    const { calls, steps } = recordedSteps();
    steps.upload = async () => {
      calls.push("upload");
      throw new UploadError("aborted", "Upload cancelled.");
    };
    await expect(runRecordingUpload(steps)).rejects.toMatchObject({ code: "aborted" });
    expect(calls).toEqual(["upload"]);
  });

  it("creates a new announcement's draft first and saves no separate wording", async () => {
    const { calls, steps } = recordedSteps({ existingId: null });
    await expect(runRecordingUpload(steps)).resolves.toEqual({ kind: "uploaded", announcementId: "new-draft", wording: null });
    expect(calls).toEqual(["createDraft", "upload:new-draft"]);
  });

  it("uploads nothing when the new draft could not be created", async () => {
    const upload = vi.fn(async () => undefined);
    const { steps } = recordedSteps({ existingId: null, createDraft: async () => null, upload });
    await expect(runRecordingUpload(steps)).resolves.toEqual({ kind: "not-started" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("reports a wording save that failed after the upload without undoing the upload", async () => {
    const refused: ActionState = { ok: false, message: "Check the highlighted fields.", fieldErrors: { text: "Too long" } };
    const { steps } = recordedSteps({ saveWording: async () => refused });
    await expect(runRecordingUpload(steps)).resolves.toEqual({ kind: "uploaded", announcementId: "rec-1", wording: refused });
  });
});

describe("the wording saved with an upload", () => {
  const business: AnnouncementBusiness = {
    id: BUSINESS_ID,
    name: "EmeraldBar",
    stationName: "EmeraldBar Radio",
    namePronunciation: "Emerald Bar",
    stationNamePronunciation: null,
    language: "en",
    isActive: true,
    everyNTracks: 4,
    volume: 1,
    brandingVersion: 2,
  };
  const recording = {
    id: READY_TTS_ID,
    text: "Welcome to EmeraldBar. Enjoy the music.",
    spokenText: "Welcome to Emerald Bar. Enjoy the music.",
    placement: "welcome",
    language: "en",
  } as const;

  it("leaves the stored spoken wording out unless the admin edited what the voice says", () => {
    const placementOnly = { text: recording.text, spokenText: null, placement: "both" as const, language: "en" };
    expect(wordingSaveFields(recording, placementOnly, false)).toEqual({ text: recording.text, placement: "both", language: "en" });
    expect(wordingSaveFields(recording, { ...placementOnly, placement: "welcome" }, false)).toBeNull();

    const rewritten = { text: "Thanks for visiting EmeraldBar.", spokenText: "Thanks for visiting Emerald Bar.", placement: "welcome" as const, language: "en" };
    expect(wordingSaveFields(recording, rewritten, true)).toEqual({ ...rewritten });
    // A spoken wording identical to the text is stored as "speak the text".
    expect(wordingSaveFields(recording, { ...rewritten, spokenText: null }, true)).toMatchObject({ spokenText: "" });
  });

  it("counts text and pronunciation edits as spoken-wording edits, not placement", () => {
    const item = { ...recording, placement: "welcome" } as unknown as AnnouncementItem;
    const state = editorStateFromRecording(item, business, "edit");
    const placementChanged: EditorState = { ...state, placement: "both" };
    expect(spokenWordingEdited(state)).toBe(false);
    expect(spokenWordingEdited(placementChanged)).toBe(false);
    expect(spokenWordingEdited({ ...state, text: `${state.text} Cheers!` })).toBe(true);
    expect(spokenWordingEdited({ ...state, pronunciation: "Emmerald Bar" })).toBe(true);
  });
});

describe("upload flow against the wording rules (fake database)", () => {
  const NEW_PATH = `${BUSINESS_ID}/${READY_TTS_ID}/${"e".repeat(32)}.mp3`;
  let db: FakeSupabase;
  let deps: AnnouncementMutationDeps;

  beforeEach(() => {
    db = new FakeSupabase();
    seedWorld(db, Date.now());
    db.currentUserId = ADMIN_ID;
    deps = { supabase: db.client("user"), userId: ADMIN_ID, storageAdmin: () => db.client("admin"), now: new Date() };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  /** The wording step exactly as the studio sends it: text changed, spoken wording rebuilt from it. */
  function saveEditedWording(announcementId: string): Promise<ActionState> {
    const data = new FormData();
    data.set("text", "Welcome to EmeraldBar, friends.");
    data.set("spokenText", "Welcome to Emerald Bar, friends.");
    data.set("placement", "both");
    data.set("language", "en");
    return updateAnnouncementWording(deps, announcementId, data).then((outcome) => outcome.state);
  }

  /** What /api/admin/uploads/complete writes once the file is valid (the previous object is removed afterwards). */
  async function attachUpload(announcementId: string): Promise<void> {
    db.patchRow("announcements", announcementId, {
      status: "ready",
      source: "upload",
      audio_path: NEW_PATH,
      audio_duration_seconds: 4,
      audio_size_bytes: 60_000,
      generation_hash: null,
      voice_id: null,
      voice_name: null,
      model_id: null,
      approved_at: null,
      approved_by: null,
    });
    db.putObject("announcements", NEW_PATH, new Uint8Array([0x49, 0x44, 0x33]), "audio/mpeg");
  }

  it("a rejected upload leaves the generated audio, its status and the respelled wording as they were", async () => {
    const before = { ...db.row("announcements", READY_TTS_ID) };
    const outcome = runRecordingUpload({
      existingId: READY_TTS_ID,
      createDraft: async () => null,
      upload: async () => {
        throw new UploadError("unsupported_media", "This is not an MP3 file.");
      },
      saveWording: saveEditedWording,
    });
    await expect(outcome).rejects.toThrow("This is not an MP3 file.");
    expect(db.row("announcements", READY_TTS_ID)).toEqual(before);
    expect(db.row("announcements", READY_TTS_ID)).toMatchObject({
      status: "ready",
      source: "tts",
      audio_path: READY_TTS_PATH,
      spoken_text: "Welcome to Emerald Bar. Enjoy the music.",
    });
    expect(db.hasObject("announcements", READY_TTS_PATH)).toBe(true);
    expect(db.events).toEqual([]);
  });

  it("an accepted upload is attached first; the new wording saved afterwards keeps the uploaded audio", async () => {
    const outcome = await runRecordingUpload({
      existingId: READY_TTS_ID,
      createDraft: async () => null,
      upload: attachUpload,
      saveWording: saveEditedWording,
    });
    expect(outcome).toMatchObject({ kind: "uploaded", wording: { ok: true } });
    expect(db.row("announcements", READY_TTS_ID)).toMatchObject({
      status: "ready",
      source: "upload",
      audio_path: NEW_PATH,
      text: "Welcome to EmeraldBar, friends.",
      spoken_text: "Welcome to Emerald Bar, friends.",
      placement: "both",
    });
    expect(db.hasObject("announcements", NEW_PATH)).toBe(true);
    expect(db.events.filter((event) => event.startsWith("storage:") && event.includes(":remove:"))).toEqual([]);
  });

  it("saving that wording first would discard the generated audio, which is why the studio uploads first", async () => {
    // What the studio did before ANN-01 was fixed: the TTS audio went before the upload was checked.
    await saveEditedWording(READY_TTS_ID);
    expect(db.row("announcements", READY_TTS_ID)).toMatchObject({ status: "draft", audio_path: null });
    expect(db.hasObject("announcements", READY_TTS_PATH)).toBe(false);
  });
});
