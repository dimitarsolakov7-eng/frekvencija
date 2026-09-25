/**
 * Data-layer additions for the announcements studio (/admin/announcements): the venue selector's
 * loader and the ids returned by create/duplicate so the editor can continue with the new draft.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnnouncementsDataError,
  createAnnouncement,
  duplicateAnnouncement,
  loadAnnouncementVenues,
  type AnnouncementMutationDeps,
} from "@/lib/data/admin/announcements";
import { FakeSupabase } from "../../api/announcements/fake-supabase";
import { ACTIVE_ID, ADMIN_ID, BUSINESS_ID, BUSINESS_ROW, seedWorld, UNKNOWN_ID } from "../../api/announcements/fixtures";

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

describe("loadAnnouncementVenues", () => {
  it("lists every venue by name for the selector", async () => {
    db.seed("businesses", [
      { ...BUSINESS_ROW, id: "1b000000-0000-4000-8000-000000000002", name: "Hotel Aurora", station_name: "Hotel Aurora Radio", is_active: false },
      { ...BUSINESS_ROW, id: "1b000000-0000-4000-8000-000000000003", name: "Café Central", station_name: "Café Central Radio" },
    ]);
    const venues = await loadAnnouncementVenues(db.client("user"));
    expect(venues).toEqual([
      { id: "1b000000-0000-4000-8000-000000000003", name: "Café Central", stationName: "Café Central Radio", isActive: true },
      { id: BUSINESS_ID, name: "EmeraldBar", stationName: "EmeraldBar Radio", isActive: true },
      { id: "1b000000-0000-4000-8000-000000000002", name: "Hotel Aurora", stationName: "Hotel Aurora Radio", isActive: false },
    ]);
  });

  it("throws a data error when the query fails", async () => {
    db.failNext("db:businesses:select", { code: "42501", message: "denied" });
    await expect(loadAnnouncementVenues(db.client("user"))).rejects.toBeInstanceOf(AnnouncementsDataError);
  });
});

describe("ids returned for the editor", () => {
  it("createAnnouncement returns the new draft's id", async () => {
    const outcome = await createAnnouncement(
      deps,
      BUSINESS_ID,
      form({
        mode: "custom",
        customText: "Welcome to EmeraldBar.",
        placement: "welcome",
        language: "en",
        spokenText: "Welcome to Emmerald Bahr.",
      }),
    );
    expect(outcome.state.ok).toBe(true);
    const created = db.rows("announcements").at(-1)!;
    expect(outcome.announcementId).toBe(created.id);
    // The pronunciation typed in the editor only shapes this announcement: the venue is unchanged.
    expect(created).toMatchObject({ text: "Welcome to EmeraldBar.", spoken_text: "Welcome to Emmerald Bahr.", status: "draft" });
    expect(db.row("businesses", BUSINESS_ID)).toMatchObject({ name_pronunciation: "Emerald Bar" });
  });

  it("returns no id when nothing was created", async () => {
    const outcome = await createAnnouncement(deps, UNKNOWN_ID, form({ mode: "custom", customText: "Hi.", placement: "rotation", language: "en" }));
    expect(outcome.state.ok).toBe(false);
    expect(outcome.announcementId).toBeUndefined();
  });

  it("duplicateAnnouncement returns the copy's id and leaves the original on air", async () => {
    const outcome = await duplicateAnnouncement(deps, ACTIVE_ID);
    expect(outcome.state.ok).toBe(true);
    const copy = db.rows("announcements").at(-1)!;
    expect(outcome.announcementId).toBe(copy.id);
    expect(copy).toMatchObject({ status: "draft" });
    // The in-memory fake does not fill column defaults: an omitted audio_path means "no audio".
    expect(copy.audio_path ?? null).toBeNull();
    expect(db.row("announcements", ACTIVE_ID)).toMatchObject({ status: "active" });
  });
});
