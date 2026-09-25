/**
 * Server Actions of /admin/announcements and the legacy nested route: every action authenticates
 * first, returns the new row's id where the editor needs it, and revalidates the studio and the
 * venue pages; the old per-venue URL redirects to the studio with the venue selected.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../../api/announcements/fake-supabase";
import { ACTIVE_ID, ADMIN_ID, BUSINESS_ID, seedWorld } from "../../api/announcements/fixtures";

const h = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireAdminAction: vi.fn(),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/navigation", () => ({ permanentRedirect: h.permanentRedirect }));
vi.mock("@/lib/auth/session", () => ({ requireAdminAction: h.requireAdminAction }));

const actions = await import("@/app/admin/announcements/actions");
const { default: LegacyPage } = await import("@/app/admin/businesses/[businessId]/announcements/page");

let db: FakeSupabase;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

beforeEach(() => {
  db = new FakeSupabase();
  seedWorld(db, Date.now());
  db.currentUserId = ADMIN_ID;
  h.revalidatePath.mockReset();
  h.requireAdminAction.mockReset();
  h.requireAdminAction.mockResolvedValue({ ctx: { userId: ADMIN_ID }, supabase: db.client("user") });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("announcements studio actions", () => {
  it("createAnnouncementDraftAction authenticates, returns the draft id and revalidates", async () => {
    const result = await actions.createAnnouncementDraftAction(
      BUSINESS_ID,
      form({ mode: "template", templateKey: "station_listening", placement: "rotation", language: "en", spokenText: "You’re listening to Emerald Bar Radio." }),
    );
    expect(h.requireAdminAction).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.announcementId).toBe(db.rows("announcements").at(-1)!.id);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/announcements");
    expect(h.revalidatePath).toHaveBeenCalledWith(`/admin/businesses/${BUSINESS_ID}`);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/businesses");
  });

  it("duplicateAnnouncementAction returns the copy's id", async () => {
    const result = await actions.duplicateAnnouncementAction(ACTIVE_ID);
    expect(result.ok).toBe(true);
    expect(result.announcementId).toBe(db.rows("announcements").at(-1)!.id);
  });

  it("rejects a forged payload without writing", async () => {
    const result = await actions.createAnnouncementDraftAction(BUSINESS_ID, "not a form" as unknown as FormData);
    expect(result).toMatchObject({ ok: false });
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not revalidate when nothing was written", async () => {
    const result = await actions.updateAnnouncementSettingsAction(
      BUSINESS_ID,
      { ok: false, message: null, fieldErrors: {} },
      form({ announcementEveryNTracks: "0", announcementVolumePercent: "70" }),
    );
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toHaveProperty("announcementEveryNTracks");
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("never runs a mutation when the admin check redirects", async () => {
    h.requireAdminAction.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(actions.deleteAnnouncementAction(ACTIVE_ID)).rejects.toThrow("NEXT_REDIRECT");
    expect(db.row("announcements", ACTIVE_ID)).toBeDefined();
  });
});

describe("legacy /admin/businesses/[id]/announcements", () => {
  it("redirects to the studio with the venue selected", async () => {
    await expect(LegacyPage({ params: Promise.resolve({ businessId: BUSINESS_ID }) } as never)).rejects.toThrow(
      `REDIRECT:/admin/announcements?business=${BUSINESS_ID}`,
    );
  });

  it("drops an invalid id", async () => {
    await expect(LegacyPage({ params: Promise.resolve({ businessId: "../etc" }) } as never)).rejects.toThrow("REDIRECT:/admin/announcements");
    expect(h.permanentRedirect).toHaveBeenLastCalledWith("/admin/announcements");
  });
});
