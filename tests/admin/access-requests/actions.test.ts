import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeClient, eqValue, type FakeClient, type Responder } from "../businesses/fake-client";

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const REQUEST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeClient, revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  requireAdminAction: async () => ({
    ctx: { userId: ADMIN_ID, email: "admin@platform.example", role: "platform_admin", business: null },
    supabase: h.fake.client,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/server", () => ({ connection: async () => undefined }));

const { updateAccessRequestStatus, saveAccessRequestNotes } = await import("@/app/admin/businesses/requests/actions");
const {
  buildAccessRequestStatusUpdate,
  loadAccessRequests,
  loadAccessRequest,
  markAccessRequestApproved,
  toAccessRequestItem,
  ACCESS_REQUEST_LIST_LIMIT,
} = await import("@/lib/data/admin/access-requests");

function install(respond: Responder) {
  h.fake = createFakeClient(respond);
  return h.fake;
}

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

const IDLE = { ok: false, message: null, fieldErrors: {} };

const ROW = {
  id: REQUEST,
  business_name: "Bistro Lipa",
  business_type: "restaurant",
  contact_name: "Ana Petrović",
  email: "ana@bistrolipa.example",
  phone: null,
  message: "Two locations.",
  status: "new",
  admin_notes: null,
  handled_by: null,
  handled_at: null,
  created_at: "2026-09-24T19:12:00Z",
  updated_at: "2026-09-24T19:12:00Z",
  handler: null,
};

beforeEach(() => {
  h.revalidatePath.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("updateAccessRequestStatus", () => {
  it("changes the status only while it still has the expected one, stamped with the admin", async () => {
    const fake = install(() => ({ data: { business_name: "Bistro Lipa" } }));
    const state = await updateAccessRequestStatus(REQUEST, "new", "contacted");
    expect(state).toMatchObject({ ok: true, message: "The request from Bistro Lipa is marked as contacted." });
    const update = fake.calls[0];
    expect(update).toMatchObject({ table: "access_requests", op: "update" });
    expect(update.payload).toEqual({ status: "contacted", handled_by: ADMIN_ID, handled_at: "2026-09-25T12:00:00.000Z" });
    expect(eqValue(update, "id")).toBe(REQUEST);
    expect(eqValue(update, "status")).toBe("new");
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/businesses", "layout");
  });

  it("maps a reopened duplicate (23505) to a friendly conflict", async () => {
    install(() => ({ error: { code: "23505", message: 'duplicate key value violates unique constraint "access_requests_open_email_key"' } }));
    const state = await updateAccessRequestStatus(REQUEST, "declined", "new");
    expect(state.ok).toBe(false);
    expect(state.message).toMatch(/already an open request from this email address/);
  });

  it("tells a concurrent change apart from a deleted request", async () => {
    install((call) => (call.op === "update" ? { data: null } : { data: { status: "approved" } }));
    expect((await updateAccessRequestStatus(REQUEST, "new", "declined")).message).toMatch(/changed this request in the meantime/);
    install(() => ({ data: null }));
    expect((await updateAccessRequestStatus(REQUEST, "new", "declined")).message).toBe("This request no longer exists.");
  });

  it("rejects invalid input before touching the database", async () => {
    const fake = install(() => undefined);
    expect((await updateAccessRequestStatus(REQUEST, "new", "new")).ok).toBe(false);
    expect((await updateAccessRequestStatus("nope", "new", "contacted")).ok).toBe(false);
    expect((await updateAccessRequestStatus(REQUEST, "new", "archived" as never)).ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe("saveAccessRequestNotes", () => {
  it("saves trimmed notes with the handler stamp; blank clears them", async () => {
    const fake = install(() => ({ data: { id: REQUEST } }));
    const saved = await saveAccessRequestNotes(IDLE, form([["requestId", REQUEST], ["adminNotes", " Called Monday.\r\nDemo next week. "]]));
    expect(saved).toMatchObject({ ok: true, message: "Notes saved." });
    expect(fake.calls[0].payload).toEqual({ admin_notes: "Called Monday.\nDemo next week.", handled_by: ADMIN_ID, handled_at: "2026-09-25T12:00:00.000Z" });
    const cleared = await saveAccessRequestNotes(IDLE, form([["requestId", REQUEST], ["adminNotes", "  "]]));
    expect(cleared.message).toBe("Notes cleared.");
    expect(fake.calls[1].payload).toMatchObject({ admin_notes: null });
  });

  it("keeps what was typed when the notes are too long", async () => {
    const fake = install(() => undefined);
    const long = "x".repeat(2001);
    const state = await saveAccessRequestNotes(IDLE, form([["requestId", REQUEST], ["adminNotes", long]]));
    expect(state.ok).toBe(false);
    expect(state.fieldErrors.adminNotes).toMatch(/at most 2,000 characters/);
    expect(state.values?.adminNotes).toBe(long);
    expect(fake.calls).toEqual([]);
  });

  it("reports a request that no longer exists", async () => {
    install(() => ({ data: null }));
    expect(await saveAccessRequestNotes(IDLE, form([["requestId", REQUEST], ["adminNotes", "x"]]))).toMatchObject({
      ok: false,
      message: "This request no longer exists.",
    });
  });
});

describe("access request data", () => {
  it("maps rows, falling back to 'other' for an unknown type", () => {
    expect(toAccessRequestItem({ ...ROW, business_type: "pub", handler: { email: "admin@x.example" } } as never)).toMatchObject({
      businessName: "Bistro Lipa",
      businessType: "other",
      status: "new",
      handledByEmail: "admin@x.example",
      createdAt: "2026-09-24T19:12:00Z",
    });
  });

  it("lists newest first with per-status counts, filtered by status", async () => {
    const fake = install((call) => {
      if (call.selectOptions) {
        const status = eqValue(call, "status");
        return { count: { new: 2, contacted: 1, approved: 4, declined: 0 }[status as string] ?? 0 };
      }
      return { data: [ROW] };
    });
    const list = await loadAccessRequests(fake.client, "new");
    expect(list).toMatchObject({ filter: "new", truncated: false, counts: { new: 2, contacted: 1, approved: 4, declined: 0, all: 7 } });
    expect(list.items[0].businessName).toBe("Bistro Lipa");
    const query = fake.calls.find((call) => !call.selectOptions)!;
    expect(query.filters).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(query.filters).toContainEqual(["eq", "status", "new"]);
    expect(query.filters).toContainEqual(["limit", ACCESS_REQUEST_LIST_LIMIT + 1]);
  });

  it("still lists when the counts fail, and reports more rows than shown", async () => {
    const rows = Array.from({ length: ACCESS_REQUEST_LIST_LIMIT + 1 }, (_, index) => ({ ...ROW, id: `id-${index}` }));
    const fake = install((call) => (call.selectOptions ? { error: { code: "XX000", message: "down" } } : { data: rows }));
    const list = await loadAccessRequests(fake.client, "all");
    expect(list.counts).toBeNull();
    expect(list.truncated).toBe(true);
    expect(list.items).toHaveLength(ACCESS_REQUEST_LIST_LIMIT);
    expect(fake.calls.find((call) => !call.selectOptions)?.filters.some(([method]) => method === "eq")).toBe(false);
  });

  it("loads one request, or null", async () => {
    expect(await loadAccessRequest(install(() => ({ data: ROW })).client, REQUEST)).toMatchObject({ id: REQUEST });
    expect(await loadAccessRequest(install(() => ({ data: null })).client, REQUEST)).toBeNull();
    await expect(loadAccessRequest(install(() => ({ error: { code: "XX000", message: "x" } })).client, REQUEST)).rejects.toThrow();
  });

  it("marks a request approved after creating its business, only while it is open", async () => {
    const now = new Date("2026-09-25T12:00:00Z");
    const open = install(() => ({ data: [{ id: REQUEST }] }));
    expect(await markAccessRequestApproved(open.client, REQUEST, ADMIN_ID, now)).toBe("approved");
    expect(open.calls[0].payload).toEqual(buildAccessRequestStatusUpdate("approved", ADMIN_ID, now));
    expect(open.calls[0].filters).toContainEqual(["in", "status", ["new", "contacted"]]);

    const closed = install((call) => (call.op === "update" ? { data: [] } : { data: { id: REQUEST } }));
    expect(await markAccessRequestApproved(closed.client, REQUEST, ADMIN_ID, now)).toBe("already_closed");
    const gone = install((call) => (call.op === "update" ? { data: [] } : { data: null }));
    expect(await markAccessRequestApproved(gone.client, REQUEST, ADMIN_ID, now)).toBe("missing");
    const failing = install(() => ({ error: { code: "42501", message: "denied" } }));
    expect(await markAccessRequestApproved(failing.client, REQUEST, ADMIN_ID, now)).toBe("failed");
  });
});
