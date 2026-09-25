import { describe, expect, it } from "vitest";
import {
  ACCESS_REQUEST_STATUS_ORDER,
  ACCESS_REQUEST_TRANSITIONS,
  accessRequestActions,
  canTransitionAccessRequest,
  createFromRequestHref,
  describeAccessRequestChange,
  isOpenAccessRequestStatus,
  isReopening,
  toAccessRequestPrefill,
  type AccessRequestStatus,
} from "@/components/admin/businesses/access-request-rules";
import {
  ACCESS_REQUEST_STATUSES,
  accessRequestNotesSchema,
  accessRequestStatusChangeSchema,
  MAX_ADMIN_NOTES_LENGTH,
  parseAccessRequestFilter,
} from "@/lib/validation/access-requests";

const REQUEST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("status transitions", () => {
  it("covers exactly the database enum", () => {
    expect([...ACCESS_REQUEST_STATUS_ORDER]).toEqual([...ACCESS_REQUEST_STATUSES]);
  });

  it("never 'changes' a request to the status it already has, and can reach every other status", () => {
    for (const from of ACCESS_REQUEST_STATUS_ORDER) {
      expect(canTransitionAccessRequest(from, from)).toBe(false);
      for (const to of ACCESS_REQUEST_TRANSITIONS[from]) expect(to).not.toBe(from);
    }
    // Every status is reachable from every other one within two steps (via new).
    for (const to of ACCESS_REQUEST_STATUS_ORDER) {
      for (const from of ACCESS_REQUEST_STATUS_ORDER) {
        if (from === to) continue;
        const direct = canTransitionAccessRequest(from, to);
        const viaNew = canTransitionAccessRequest(from, "new") && canTransitionAccessRequest("new", to);
        expect(direct || viaNew).toBe(true);
      }
    }
  });

  it("follows the owner's workflow", () => {
    expect(canTransitionAccessRequest("new", "contacted")).toBe(true);
    expect(canTransitionAccessRequest("contacted", "approved")).toBe(true);
    expect(canTransitionAccessRequest("contacted", "declined")).toBe(true);
    expect(canTransitionAccessRequest("declined", "new")).toBe(true);
    expect(canTransitionAccessRequest("approved", "contacted")).toBe(true);
  });

  it("knows which statuses are open and when a change reopens a request", () => {
    expect(ACCESS_REQUEST_STATUS_ORDER.filter(isOpenAccessRequestStatus)).toEqual(["new", "contacted"]);
    expect(isReopening("declined", "new")).toBe(true);
    expect(isReopening("approved", "contacted")).toBe(true);
    expect(isReopening("new", "contacted")).toBe(false);
    expect(isReopening("contacted", "declined")).toBe(false);
  });

  it("offers the usual next steps as buttons, only allowed ones", () => {
    const labels = (status: AccessRequestStatus) => accessRequestActions(status).map((action) => action.label);
    expect(labels("new")).toEqual(["Mark contacted", "Mark approved", "Decline"]);
    expect(labels("contacted")).toEqual(["Mark approved", "Decline", "Move back to new"]);
    expect(labels("approved")).toEqual(["Reopen"]);
    expect(labels("declined")).toEqual(["Reopen"]);
    for (const status of ACCESS_REQUEST_STATUS_ORDER) {
      for (const action of accessRequestActions(status)) expect(canTransitionAccessRequest(status, action.status)).toBe(true);
    }
  });

  it("describes a change honestly (declining sends nothing)", () => {
    expect(describeAccessRequestChange("Bistro Lipa", "declined")).toMatch(/Nothing is sent to them automatically/);
    expect(describeAccessRequestChange("Bistro Lipa", "new")).toBe("The request from Bistro Lipa is open again.");
  });
});

describe("create business from a request", () => {
  it("maps name, type and contact email, and suggests the station name", () => {
    expect(
      toAccessRequestPrefill({
        id: REQUEST,
        businessName: "  Bistro   Lipa ",
        businessType: "restaurant",
        contactName: " Ana Petrović ",
        email: " Ana@BistroLipa.example ",
      }),
    ).toEqual({
      requestId: REQUEST,
      name: "Bistro Lipa",
      businessType: "restaurant",
      stationName: "Bistro Lipa Radio",
      contactEmail: "ana@bistrolipa.example",
      contactName: "Ana Petrović",
    });
  });

  it("falls back to 'other' for an unknown type and keeps names already ending in Radio", () => {
    const prefill = toAccessRequestPrefill({ id: REQUEST, businessName: "Jazz Radio", businessType: "pub", contactName: "", email: "a@b.example" });
    expect(prefill.businessType).toBe("other");
    expect(prefill.stationName).toBe("Jazz Radio");
    // A name that is too long for "<name> Radio" gets no suggestion (the admin types one).
    expect(toAccessRequestPrefill({ id: REQUEST, businessName: "x".repeat(118), businessType: "bar", contactName: "", email: "a@b.example" }).stationName).toBe("");
  });

  it("links to the prefilled add form", () => {
    expect(createFromRequestHref("/admin/businesses", REQUEST)).toBe(`/admin/businesses/new?fromRequest=${REQUEST}`);
  });
});

describe("validation", () => {
  it("parses the status filter, defaulting to all", () => {
    expect(parseAccessRequestFilter("contacted")).toBe("contacted");
    expect(parseAccessRequestFilter(["declined", "new"])).toBe("declined");
    expect(parseAccessRequestFilter("everything")).toBe("all");
    expect(parseAccessRequestFilter(undefined)).toBe("all");
  });

  it("requires a real status change with a valid id", () => {
    expect(accessRequestStatusChangeSchema.safeParse({ requestId: REQUEST, status: "contacted", expectedStatus: "new" }).success).toBe(true);
    const same = accessRequestStatusChangeSchema.safeParse({ requestId: REQUEST, status: "new", expectedStatus: "new" });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0].message).toBe("The request already has this status.");
    expect(accessRequestStatusChangeSchema.safeParse({ requestId: REQUEST, status: "archived", expectedStatus: "new" }).success).toBe(false);
    expect(accessRequestStatusChangeSchema.safeParse({ requestId: "x", status: "contacted", expectedStatus: "new" }).success).toBe(false);
  });

  it("normalises notes (CRLF, blank → null) and enforces the 2000-character limit", () => {
    expect(accessRequestNotesSchema.parse({ requestId: REQUEST, adminNotes: " Called.\r\n\r\nWants a demo. " }).adminNotes).toBe(
      "Called.\n\nWants a demo.",
    );
    expect(accessRequestNotesSchema.parse({ requestId: REQUEST, adminNotes: "   " }).adminNotes).toBeNull();
    expect(accessRequestNotesSchema.safeParse({ requestId: REQUEST, adminNotes: "x".repeat(MAX_ADMIN_NOTES_LENGTH) }).success).toBe(true);
    expect(accessRequestNotesSchema.safeParse({ requestId: REQUEST, adminNotes: "x".repeat(MAX_ADMIN_NOTES_LENGTH + 1) }).success).toBe(false);
  });
});
