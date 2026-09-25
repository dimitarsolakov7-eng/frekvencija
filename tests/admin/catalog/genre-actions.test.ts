import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGenreAction,
  deleteGenreAction,
  removeGenreCoverAction,
  reorderGenresAction,
  saveGenreAction,
  setGenreAccessAction,
  setGenreAvailabilityAction,
  setGenreEnabledAction,
  updateGenreAction,
} from "@/app/admin/genres/actions";
import { genreDraftFormData, genreDraftFromItem, rebaseGenreDraft } from "@/components/admin/catalog/genre-draft";
import type { AdminGenreItem } from "@/components/admin/catalog/types";
import { callsTo, createFakeSupabase, verbOf, type FakeSupabase, type QueryResponder, type RpcResponder, type StorageFake } from "./fake-supabase";

const mocks = vi.hoisted(() => ({ requireAdminAction: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAdminAction: mocks.requireAdminAction }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const G3 = "33333333-3333-4333-8333-333333333333";
const B1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const B3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let fake: FakeSupabase;

function useFake(respond: QueryResponder, rpc?: RpcResponder, storage?: StorageFake) {
  fake = createFakeSupabase({ respond, rpc, storage });
  mocks.requireAdminAction.mockResolvedValue({ ctx: { userId: "admin-1", role: "platform_admin" }, supabase: fake.client });
}

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  useFake(() => ({ data: null }));
});

describe("createGenreAction", () => {
  it("derives the slug, appends to the order and revalidates", async () => {
    useFake((query) => {
      if (query.table === "genres" && verbOf(query) === "select") return { data: { sort_order: 4 } };
      if (query.table === "genres" && verbOf(query) === "insert") return { data: { id: G1, name: "Chill Out" } };
      return { data: null };
    });
    const result = await createGenreAction(form([["name", "  Chill Out "], ["slug", ""], ["description", ""], ["isEnabled", "true"], ["availableToAll", "true"]]));

    expect(mocks.requireAdminAction).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Chill Out");
    // The editor selects the new genre by this id.
    expect(result.values?.createdGenreId).toBe(G1);
    const insert = fake.queries.find((query) => verbOf(query) === "insert")!;
    expect(callsTo(insert, "insert")[0][0]).toEqual({
      name: "Chill Out",
      slug: "chill-out",
      description: null,
      is_enabled: true,
      available_to_all: true,
      sort_order: 5,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/genres");
    expect(fake.queries.some((query) => query.table === "business_genre_access")).toBe(false);
  });

  it("returns field errors without touching the database", async () => {
    const result = await createGenreAction(form([["name", "   "], ["slug", "Bad Slug"]]));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.name).toBe("Genre name is required.");
    expect(result.fieldErrors.slug).toMatch(/lowercase/);
    expect(fake.queries).toHaveLength(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps unique violations to the clashing field", async () => {
    useFake((query) =>
      verbOf(query) === "insert"
        ? { error: { code: "23505", message: 'duplicate key value violates unique constraint "genres_slug_key"', details: "Key (slug)=(jazz) already exists." } }
        : { data: { sort_order: 1 } },
    );
    const slugClash = await createGenreAction(form([["name", "Jazz"]]));
    expect(slugClash.ok).toBe(false);
    expect(slugClash.fieldErrors.slug).toMatch(/already uses this slug/);

    useFake((query) =>
      verbOf(query) === "insert"
        ? { error: { code: "23505", message: 'duplicate key value violates unique constraint "genres_name_lower_key"' } }
        : { data: { sort_order: 1 } },
    );
    const nameClash = await createGenreAction(form([["name", "JAZZ"], ["slug", "jazz-2"]]));
    expect(nameClash.fieldErrors.name).toMatch(/already has this name/);
  });

  it("creates access rows for an assigned-only genre", async () => {
    useFake((query) => {
      if (verbOf(query) === "insert") return { data: { id: G1, name: "Lounge" } };
      if (query.table === "genres") return { data: { sort_order: 0 } };
      return { data: null };
    });
    const result = await createGenreAction(
      form([["name", "Lounge"], ["availableToAll", "false"], ["businessIds", B1], ["businessIds", B2], ["businessIds", B1]]),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("2 businesses");
    const upsert = fake.queries.find((query) => verbOf(query) === "upsert")!;
    expect(callsTo(upsert, "upsert")[0]).toEqual([
      [
        { business_id: B1, genre_id: G1 },
        { business_id: B2, genre_id: G1 },
      ],
      { onConflict: "business_id,genre_id", ignoreDuplicates: true },
    ]);
  });

  it("ignores business ids when the genre is available to all", async () => {
    useFake((query) => (verbOf(query) === "insert" ? { data: { id: G1, name: "Pop" } } : { data: { sort_order: 0 } }));
    await createGenreAction(form([["name", "Pop"], ["availableToAll", "true"], ["businessIds", B1]]));
    expect(fake.queries.some((query) => query.table === "business_genre_access")).toBe(false);
  });

  it("tells the form the genre exists when only its access rows failed", async () => {
    useFake((query) => {
      if (verbOf(query) === "insert") return { data: { id: G1, name: "Lounge" } };
      if (verbOf(query) === "upsert") return { error: { code: "23503", message: "fk" } };
      return { data: { sort_order: 0 } };
    });
    const result = await createGenreAction(form([["name", "Lounge"], ["availableToAll", "false"], ["businessIds", B1]]));
    expect(result.ok).toBe(false);
    expect(result.values?.createdGenreId).toBe(G1);
    expect(result.message).toMatch(/was created, but business access could not be saved/);
  });
});

describe("updateGenreAction", () => {
  it("rejects an invalid id before reading the form", async () => {
    const result = await updateGenreAction("not-a-uuid", form([["name", "Jazz"]]));
    expect(result.ok).toBe(false);
    expect(fake.queries).toHaveLength(0);
  });

  it("updates only the submitted fields; a blank slug keeps the current one", async () => {
    useFake(() => ({ data: { id: G1, name: "Smooth Jazz" } }));
    const result = await updateGenreAction(G1, form([["name", "Smooth Jazz"], ["slug", ""], ["description", "  "]]));
    expect(result).toMatchObject({ ok: true, message: "Saved “Smooth Jazz”." });
    const update = fake.queries[0];
    expect(callsTo(update, "update")[0][0]).toEqual({ name: "Smooth Jazz", description: null });
    expect(callsTo(update, "eq")).toEqual([["id", G1]]);
  });

  it("reports a genre that no longer exists", async () => {
    useFake(() => ({ data: null }));
    const result = await updateGenreAction(G1, form([["name", "Jazz"]]));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no longer exists/);
  });
});

describe("switches", () => {
  it("enables and disables", async () => {
    useFake(() => ({ data: { name: "Jazz" } }));
    const result = await setGenreEnabledAction(G1, false);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/inactive/);
    expect(result.message).toMatch(/tracks stay/);
    expect(callsTo(fake.queries[0], "update")[0][0]).toEqual({ is_enabled: false });
  });

  it("rejects non-boolean flags from forged calls", async () => {
    const result = await setGenreEnabledAction(G1, "yes" as unknown as boolean);
    expect(result.ok).toBe(false);
    expect(fake.queries).toHaveLength(0);
  });

  it("warns when an assigned-only genre has no businesses yet", async () => {
    useFake(() => ({ data: { name: "Jazz", business_genre_access: [{ count: 0 }] } }));
    const result = await setGenreAvailabilityAction(G1, false);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/none are selected yet/);
    expect(callsTo(fake.queries[0], "update")[0][0]).toEqual({ available_to_all: false });
  });
});

describe("reorderGenresAction", () => {
  it("sends the complete, de-duplicated order to reorder_genres", async () => {
    useFake(() => ({ data: null }));
    const result = await reorderGenresAction([G2, G1, G2, G3]);
    expect(result.ok).toBe(true);
    expect(fake.rpcCalls).toEqual([{ name: "reorder_genres", args: { p_genre_ids: [G2, G1, G3] } }]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/genres");
  });

  it("rejects an empty or malformed list without calling the database", async () => {
    expect((await reorderGenresAction([])).ok).toBe(false);
    expect((await reorderGenresAction(["x"])).ok).toBe(false);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("explains a genre that disappeared and refreshes the list", async () => {
    useFake(() => ({ data: null }), () => ({ error: { code: "23503", message: "Genre does not exist" } }));
    const result = await reorderGenresAction([G1, G2]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no longer exists/);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/genres");
  });
});

describe("setGenreAccessAction", () => {
  function accessResponder(options: { deleteError?: { code: string; message: string } } = {}): QueryResponder {
    return (query) => {
      if (query.table === "genres") return { data: { id: G1, name: "Jazz", available_to_all: false } };
      if (query.table === "business_genre_access" && verbOf(query) === "select") return { data: [{ business_id: B1 }, { business_id: B2 }] };
      if (verbOf(query) === "delete" && options.deleteError) return { error: options.deleteError };
      return { data: null };
    };
  }

  it("inserts the new rows and deletes the removed ones", async () => {
    useFake(accessResponder());
    const result = await setGenreAccessAction(G1, [B2, B3]);
    expect(result).toMatchObject({ ok: true, message: "2 businesses have access to “Jazz”." });

    const upsert = fake.queries.find((query) => verbOf(query) === "upsert")!;
    expect(callsTo(upsert, "upsert")[0][0]).toEqual([{ business_id: B3, genre_id: G1 }]);
    const remove = fake.queries.find((query) => verbOf(query) === "delete")!;
    expect(callsTo(remove, "eq")).toEqual([["genre_id", G1]]);
    expect(callsTo(remove, "in")).toEqual([["business_id", [B1]]]);
  });

  it("does nothing when the set is unchanged", async () => {
    useFake(accessResponder());
    const result = await setGenreAccessAction(G1, [B2, B1]);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/No changes/);
    expect(fake.queries.some((query) => verbOf(query) === "upsert" || verbOf(query) === "delete")).toBe(false);
  });

  it("reports a partial failure honestly", async () => {
    useFake(accessResponder({ deleteError: { code: "42501", message: "denied" } }));
    const result = await setGenreAccessAction(G1, [B3]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/New access was saved, but removing access failed/);
  });

  it("validates the business ids", async () => {
    const result = await setGenreAccessAction(G1, ["nope"]);
    expect(result.ok).toBe(false);
    expect(fake.queries).toHaveLength(0);
  });
});

describe("deleteGenreAction", () => {
  it("deletes and confirms that tracks stay", async () => {
    useFake(() => ({ data: { id: G1, name: "Jazz" } }));
    const result = await deleteGenreAction(G1);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/tracks are still in the music catalogue/);
    expect(verbOf(fake.queries[0])).toBe("delete");
    expect(callsTo(fake.queries[0], "eq")).toEqual([["id", G1]]);
  });

  it("maps permission errors", async () => {
    useFake(() => ({ error: { code: "42501", message: "denied" } }));
    const result = await deleteGenreAction(G1);
    expect(result).toMatchObject({ ok: false, message: "You don't have permission to do that." });
  });
});

const COVER = `${G1}/${"c".repeat(32)}.png`;

describe("deleteGenreAction — cover image", () => {
  it("deletes the cover image from Storage after the row, with the admin's own client", async () => {
    useFake(() => ({ data: { id: G1, name: "Jazz", cover_path: COVER } }));
    const result = await deleteGenreAction(G1);
    expect(result.ok).toBe(true);
    expect(fake.events).toEqual(["genres:delete", "storage:remove"]);
    expect(fake.storageCalls).toEqual([{ bucket: "genre-covers", method: "remove", args: [[COVER]] }]);
  });

  it("still reports the deletion when the image cannot be removed", async () => {
    useFake(() => ({ data: { id: G1, name: "Jazz", cover_path: COVER } }), undefined, { remove: () => ({ error: { message: "storage down" } }) });
    const result = await deleteGenreAction(G1);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/deleted/);
  });

  it("leaves Storage alone for a genre without a cover", async () => {
    useFake(() => ({ data: { id: G1, name: "Jazz", cover_path: null } }));
    await deleteGenreAction(G1);
    expect(fake.storageCalls).toEqual([]);
  });
});

describe("saveGenreAction", () => {
  function saveResponder(
    options: { genre?: Record<string, unknown> | null; current?: string[]; upsertError?: { code: string; message: string } } = {},
  ): QueryResponder {
    return (query) => {
      if (query.table === "genres") {
        return { data: options.genre === undefined ? { id: G1, name: "Jazz", available_to_all: false } : options.genre };
      }
      if (query.table === "business_genre_access" && verbOf(query) === "select") {
        return { data: (options.current ?? [B1, B2]).map((business_id) => ({ business_id })) };
      }
      if (verbOf(query) === "upsert" && options.upsertError) return { error: options.upsertError };
      return { data: null };
    };
  }

  function editorForm(entries: [string, string][]): FormData {
    return form([["name", "Jazz"], ["slug", ""], ["description", "Classic vibes."], ["isEnabled", "true"], ...entries]);
  }

  it("saves the fields and replaces the business access with the selected set", async () => {
    useFake(saveResponder());
    const result = await saveGenreAction(
      G1,
      editorForm([["availableToAll", "false"], ["accessListed", "true"], ["businessIds", B2], ["businessIds", B3]]),
    );
    expect(result).toMatchObject({ ok: true, message: "Saved “Jazz”. 2 businesses have access." });

    const update = fake.queries.find((query) => query.table === "genres")!;
    expect(callsTo(update, "update")[0][0]).toEqual({ name: "Jazz", description: "Classic vibes.", is_enabled: true, available_to_all: false });
    const upsert = fake.queries.find((query) => verbOf(query) === "upsert")!;
    expect(callsTo(upsert, "upsert")[0][0]).toEqual([{ business_id: B3, genre_id: G1 }]);
    const remove = fake.queries.find((query) => verbOf(query) === "delete")!;
    expect(callsTo(remove, "in")).toEqual([["business_id", [B1]]]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/genres");
  });

  it("clears every access row when Selected businesses is saved with none chosen, and warns", async () => {
    useFake(saveResponder());
    const result = await saveGenreAction(G1, editorForm([["availableToAll", "false"], ["accessListed", "true"]]));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/No business has access yet/);
    const remove = fake.queries.find((query) => verbOf(query) === "delete")!;
    expect(callsTo(remove, "in")).toEqual([["business_id", [B1, B2]]]);
  });

  it("keeps the access rows when the genre is available to all businesses", async () => {
    useFake(saveResponder({ genre: { id: G1, name: "Jazz", available_to_all: true } }));
    const result = await saveGenreAction(G1, editorForm([["availableToAll", "true"]]));
    expect(result).toMatchObject({ ok: true, message: "Saved “Jazz”." });
    expect(fake.queries.some((query) => query.table === "business_genre_access")).toBe(false);
  });

  it("reports honestly when the fields were saved but access could not be", async () => {
    useFake(saveResponder({ upsertError: { code: "23503", message: "fk" } }));
    const result = await saveGenreAction(G1, editorForm([["availableToAll", "false"], ["accessListed", "true"], ["businessIds", B3]]));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/was saved, but business access could not be updated/);
    expect(result.message).toMatch(/no longer exists/);
  });

  it("maps a duplicate name to the name field", async () => {
    useFake(() => ({ error: { code: "23505", message: "duplicate key value violates unique constraint \"genres_name_lower_key\"" } }));
    const result = await saveGenreAction(G1, editorForm([["availableToAll", "true"]]));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors.name).toMatch(/already has this name/);
  });

  it("validates before touching the database", async () => {
    const invalidId = await saveGenreAction("nope", editorForm([]));
    expect(invalidId.ok).toBe(false);
    const blankName = await saveGenreAction(G1, form([["name", "  "]]));
    expect(blankName.fieldErrors.name).toBe("Genre name is required.");
    const badBusinesses = await saveGenreAction(G1, editorForm([["accessListed", "true"], ["businessIds", "not-a-uuid"]]));
    expect(badBusinesses.ok).toBe(false);
    expect(fake.queries).toHaveLength(0);
  });

  it("reports a genre that no longer exists", async () => {
    useFake(saveResponder({ genre: null }));
    const result = await saveGenreAction(G1, editorForm([["availableToAll", "true"]]));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no longer exists/);
  });

  // GEN-01: the admin edits Jazz's description, deactivates Jazz with "Deactivate genre" (unsaved
  // edits still open), then presses Save. The editor's request must not write is_enabled back.
  it("saves only what the editor changed, so a deactivation made meanwhile stays", async () => {
    useFake(saveResponder({ genre: { id: G1, name: "Jazz", available_to_all: true } }));
    const jazz: AdminGenreItem = {
      id: G1,
      name: "Jazz",
      slug: "jazz",
      description: null,
      sortOrder: 1,
      isEnabled: true,
      availableToAll: true,
      playableCount: 3,
      totalCount: 3,
      accessBusinessIds: [],
      coverPath: null,
      coverUrl: null,
    };
    const opened = genreDraftFromItem(jazz, []);
    const deactivated = genreDraftFromItem({ ...jazz, isEnabled: false }, []);
    const values = rebaseGenreDraft({ ...opened, description: "Classic vibes." }, opened, deactivated);

    const result = await saveGenreAction(G1, genreDraftFormData(values, deactivated));
    expect(result).toMatchObject({ ok: true, message: "Saved “Jazz”." });
    const update = fake.queries.find((query) => query.table === "genres")!;
    expect(callsTo(update, "update")[0][0]).toEqual({ description: "Classic vibes." });
    expect(fake.queries.some((query) => query.table === "business_genre_access")).toBe(false);
  });
});

describe("removeGenreCoverAction", () => {
  function coverResponder(options: { coverPath?: string | null; cleared?: boolean } = {}): QueryResponder {
    return (query) => {
      if (verbOf(query) === "select") {
        return { data: { id: G1, name: "Jazz", cover_path: options.coverPath === undefined ? COVER : options.coverPath } };
      }
      if (verbOf(query) === "update") return { data: options.cleared === false ? null : { id: G1 } };
      return { data: null };
    };
  }

  it("clears cover_path guarded on the current cover, then deletes the image", async () => {
    useFake(coverResponder());
    const result = await removeGenreCoverAction(G1);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/default artwork/);
    const update = fake.queries.find((query) => verbOf(query) === "update")!;
    expect(callsTo(update, "update")[0][0]).toEqual({ cover_path: null });
    expect(callsTo(update, "eq")).toEqual([
      ["id", G1],
      ["cover_path", COVER],
    ]);
    expect(fake.events).toEqual(["genres:select", "genres:update", "storage:remove"]);
    expect(fake.storageCalls).toEqual([{ bucket: "genre-covers", method: "remove", args: [[COVER]] }]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/genres");
  });

  it("does nothing for a genre without a cover", async () => {
    useFake(coverResponder({ coverPath: null }));
    const result = await removeGenreCoverAction(G1);
    expect(result.ok).toBe(true);
    expect(fake.queries.some((query) => verbOf(query) === "update")).toBe(false);
    expect(fake.storageCalls).toEqual([]);
  });

  it("keeps the file when the cover changed meanwhile", async () => {
    useFake(coverResponder({ cleared: false }));
    const result = await removeGenreCoverAction(G1);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/changed/);
    expect(fake.storageCalls).toEqual([]);
  });

  it("says so when the image file could not be deleted", async () => {
    useFake(coverResponder(), undefined, { remove: () => ({ error: { message: "storage down" } }) });
    const result = await removeGenreCoverAction(G1);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/could not be deleted from storage/);
  });

  it("rejects an invalid id", async () => {
    const result = await removeGenreCoverAction("nope");
    expect(result.ok).toBe(false);
    expect(fake.queries).toHaveLength(0);
  });
});
