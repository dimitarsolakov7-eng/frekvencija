import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteTrackAction,
  removeTrackAction,
  removeTracksAction,
  restoreTrackAction,
  setTrackActiveAction,
  setTracksActiveAction,
  updateTrackAction,
} from "@/app/admin/music/actions";
import { callsTo, createFakeSupabase, verbOf, type FakeSupabase, type QueryResponder, type RpcResponder, type StorageFake } from "./fake-supabase";

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  revalidatePath: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireAdminAction: mocks.requireAdminAction }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

const TRACK = "44444444-4444-4444-8444-444444444444";
const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";

let user: FakeSupabase;
let admin: FakeSupabase;
let events: string[];

function useFakes(options: { respond?: QueryResponder; rpc?: RpcResponder; storage?: StorageFake } = {}) {
  events = [];
  user = createFakeSupabase({ respond: options.respond, rpc: options.rpc, events });
  admin = createFakeSupabase({ storage: options.storage, events });
  mocks.requireAdminAction.mockResolvedValue({ ctx: { userId: "admin-1", role: "platform_admin" }, supabase: user.client });
  mocks.createSupabaseAdminClient.mockReturnValue(admin.client);
}

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  useFakes();
});

describe("updateTrackAction", () => {
  it("saves title/artist, then replaces the genres with set_track_genres", async () => {
    useFakes({ respond: () => ({ data: { id: TRACK } }) });
    const result = await updateTrackAction(
      TRACK,
      form([["title", "  Blue Moon "], ["artist", "  "], ["genreIds", G1], ["genreIds", G2], ["genreIds", G1]]),
    );
    expect(result).toMatchObject({ ok: true, message: "Saved “Blue Moon”." });
    expect(callsTo(user.queries[0], "update")[0][0]).toEqual({ title: "Blue Moon", artist: "Unknown Artist" });
    expect(user.rpcCalls).toEqual([{ name: "set_track_genres", args: { p_track_id: TRACK, p_genre_ids: [G1, G2] } }]);
    expect(events).toEqual(["tracks:update", "rpc:set_track_genres"]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/music");
  });

  it("clears the genres when none are ticked and warns that the track won't play", async () => {
    useFakes({ respond: () => ({ data: { id: TRACK } }) });
    const result = await updateTrackAction(TRACK, form([["title", "Blue Moon"], ["artist", "Ella"]]));
    expect(user.rpcCalls[0].args).toEqual({ p_track_id: TRACK, p_genre_ids: [] });
    expect(result.message).toMatch(/won't play anywhere/);
  });

  it("validates before writing", async () => {
    const result = await updateTrackAction(TRACK, form([["title", ""], ["genreIds", "nope"]]));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.title).toBe("Title is required.");
    expect(result.fieldErrors.genreIds).toBeTruthy();
    expect(user.queries).toHaveLength(0);
  });

  it("says what was saved when the genres fail", async () => {
    useFakes({ respond: () => ({ data: { id: TRACK } }), rpc: () => ({ error: { code: "23503", message: "Genre does not exist" } }) });
    const result = await updateTrackAction(TRACK, form([["title", "Blue Moon"], ["genreIds", G1]]));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Title and artist were saved/);
    expect(result.fieldErrors.genreIds).toBeTruthy();
  });

  it("stops when the track is gone", async () => {
    useFakes({ respond: () => ({ data: null }) });
    const result = await updateTrackAction(TRACK, form([["title", "Blue Moon"]]));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no longer exists/);
    expect(user.rpcCalls).toHaveLength(0);
  });
});

describe("enable / remove / restore", () => {
  it("disables a track", async () => {
    useFakes({ respond: () => ({ data: { title: "Blue Moon", removed_at: null } }) });
    const result = await setTrackActiveAction(TRACK, false);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/inactive/);
    expect(callsTo(user.queries[0], "update")[0][0]).toEqual({ is_active: false });
  });

  it("explains that enabling a removed track does not put it back into playback", async () => {
    useFakes({ respond: () => ({ data: { title: "Blue Moon", removed_at: "2026-09-25T10:00:00Z" } }) });
    const result = await setTrackActiveAction(TRACK, true);
    expect(result.message).toMatch(/until you restore it/);
  });

  it("removes from playback only tracks that are not removed yet", async () => {
    useFakes({ respond: () => ({ data: { title: "Blue Moon" } }) });
    const result = await removeTrackAction(TRACK);
    expect(result.ok).toBe(true);
    const update = user.queries[0];
    const patch = callsTo(update, "update")[0][0] as { removed_at: string };
    expect(Number.isNaN(Date.parse(patch.removed_at))).toBe(false);
    expect(callsTo(update, "is")).toEqual([["removed_at", null]]);
  });

  it("treats removing an already removed track as done", async () => {
    useFakes({
      respond: (query) =>
        verbOf(query) === "update" ? { data: null } : { data: { title: "Blue Moon", removed_at: "2026-09-25T10:00:00Z" } },
    });
    const result = await removeTrackAction(TRACK);
    expect(result).toMatchObject({ ok: true });
    expect(result.message).toMatch(/already removed/);
  });

  it("restores a removed track and says when it is still inactive", async () => {
    useFakes({ respond: () => ({ data: { title: "Blue Moon", is_active: false } }) });
    const result = await restoreTrackAction(TRACK);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/still inactive/);
    expect(callsTo(user.queries[0], "update")[0][0]).toEqual({ removed_at: null });
    expect(callsTo(user.queries[0], "not")).toEqual([["removed_at", "is", null]]);
  });

  it("rejects invalid ids and flags", async () => {
    expect((await setTrackActiveAction("x", true)).ok).toBe(false);
    expect((await setTrackActiveAction(TRACK, "no" as unknown as boolean)).ok).toBe(false);
    expect((await removeTrackAction("x")).ok).toBe(false);
    expect(user.queries).toHaveLength(0);
  });
});

describe("deleteTrackAction", () => {
  const removedRow = { id: TRACK, title: "Blue Moon", storage_path: `tracks/${TRACK}/abc.mp3`, removed_at: "2026-09-25T10:00:00Z" };

  it("refuses tracks that were not removed first", async () => {
    useFakes({ respond: () => ({ data: { ...removedRow, removed_at: null } }) });
    const result = await deleteTrackAction(TRACK);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Remove it first/);
    expect(admin.storageCalls).toHaveLength(0);
    expect(user.queries.some((query) => verbOf(query) === "delete")).toBe(false);
  });

  it("deletes the audio with the secret-key client first, then the row", async () => {
    useFakes({
      respond: (query) => (verbOf(query) === "delete" ? { data: { id: TRACK } } : { data: removedRow }),
      storage: { list: () => ({ data: [{ name: "abc.mp3", id: "o1" }] }) },
    });
    const result = await deleteTrackAction(TRACK);
    expect(result).toMatchObject({ ok: true, message: "“Blue Moon” was deleted permanently." });
    expect(events).toEqual(["tracks:select", "storage:list", "storage:remove", "tracks:delete"]);
    expect(admin.storageCalls.at(-1)).toEqual({ bucket: "music", method: "remove", args: [[removedRow.storage_path]] });
    const deletion = user.queries.find((query) => verbOf(query) === "delete")!;
    expect(callsTo(deletion, "not")).toEqual([["removed_at", "is", null]]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/music");
  });

  it("keeps the row when the audio could not be deleted", async () => {
    useFakes({ respond: () => ({ data: removedRow }), storage: { remove: () => ({ error: { message: "storage down" } }) } });
    const result = await deleteTrackAction(TRACK);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/track was kept/);
    expect(user.queries.some((query) => verbOf(query) === "delete")).toBe(false);
  });

  it("explains a missing storage configuration without deleting anything", async () => {
    useFakes({ respond: () => ({ data: removedRow }) });
    mocks.createSupabaseAdminClient.mockImplementation(() => {
      throw new Error("SUPABASE_SECRET_KEY is not set");
    });
    const result = await deleteTrackAction(TRACK);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not configured/);
    expect(user.queries.some((query) => verbOf(query) === "delete")).toBe(false);
  });

  it("tells the admin to retry when only the row delete failed", async () => {
    useFakes({ respond: (query) => (verbOf(query) === "delete" ? { error: { code: "42501", message: "denied" } } : { data: removedRow }) });
    const result = await deleteTrackAction(TRACK);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/audio file was deleted, but the track entry could not be removed/);
  });
});

const TRACK_2 = "55555555-5555-4555-8555-555555555555";
const TRACK_3 = "66666666-6666-4666-8666-666666666666";

describe("bulk actions", () => {
  it("activates the selected tracks in one update and notes removed ones", async () => {
    useFakes({ respond: () => ({ data: [{ id: TRACK, removed_at: null }, { id: TRACK_2, removed_at: "2026-09-20T10:00:00Z" }] }) });
    const result = await setTracksActiveAction([TRACK, TRACK_2, TRACK], true);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/^2 tracks are active\./);
    expect(result.message).toMatch(/1 of them is still removed from playback/);
    expect(user.queries).toHaveLength(1);
    expect(callsTo(user.queries[0], "update")[0][0]).toEqual({ is_active: true });
    expect(callsTo(user.queries[0], "in")).toEqual([["id", [TRACK, TRACK_2]]]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/music");
  });

  it("deactivates and reports tracks that no longer exist", async () => {
    useFakes({ respond: () => ({ data: [{ id: TRACK, removed_at: null }] }) });
    const result = await setTracksActiveAction([TRACK, TRACK_2], false);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/1 track is inactive/);
    expect(result.message).toMatch(/1 selected track no longer exists/);
  });

  it("fails honestly when none of the tracks exist", async () => {
    useFakes({ respond: () => ({ data: [] }) });
    const result = await setTracksActiveAction([TRACK], true);
    expect(result.ok).toBe(false);
  });

  it("removes only tracks that are not removed yet", async () => {
    useFakes({ respond: () => ({ data: [{ id: TRACK }, { id: TRACK_2 }] }) });
    const result = await removeTracksAction([TRACK, TRACK_2, TRACK_3]);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/^2 tracks were removed from playback/);
    expect(result.message).toMatch(/1 other was already removed or no longer exist/);
    const update = user.queries[0];
    expect(Object.keys(callsTo(update, "update")[0][0] as object)).toEqual(["removed_at"]);
    expect(callsTo(update, "in")).toEqual([["id", [TRACK, TRACK_2, TRACK_3]]]);
    expect(callsTo(update, "is")).toEqual([["removed_at", null]]);
  });

  it("validates the selection and the flag before touching the database", async () => {
    expect((await setTracksActiveAction([], true)).ok).toBe(false);
    expect((await setTracksActiveAction(["nope"], true)).ok).toBe(false);
    expect((await setTracksActiveAction([TRACK], "yes" as unknown as boolean)).ok).toBe(false);
    expect((await removeTracksAction([])).ok).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, index) => `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`);
    expect((await removeTracksAction(tooMany)).ok).toBe(false);
    expect(user.queries).toHaveLength(0);
  });

  it("maps database errors", async () => {
    useFakes({ respond: () => ({ error: { code: "42501", message: "denied" } }) });
    const result = await removeTracksAction([TRACK]);
    expect(result).toMatchObject({ ok: false, message: "You don't have permission to do that." });
  });
});
