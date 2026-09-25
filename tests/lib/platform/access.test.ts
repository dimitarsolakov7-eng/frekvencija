import { describe, expect, it } from "vitest";
import { checkAdminAccess, checkBusinessUserAccess, type SessionContext } from "@/lib/auth/access";

const business = { id: "b1", name: "EmeraldBar", stationName: "EmeraldBar Radio", isActive: true };
const venueUser: SessionContext = { userId: "u1", email: "u1@example.com", role: "business_user", business };
const admin: SessionContext = { userId: "a1", email: "a1@example.com", role: "platform_admin", business: null };

describe("checkAdminAccess", () => {
  it("allows admins", () => {
    expect(checkAdminAccess(admin)).toEqual({ ok: true, ctx: admin });
  });

  it("denies signed-out users with 401 and venue users with 403", () => {
    expect(checkAdminAccess(null)).toMatchObject({ ok: false, denial: { status: 401, code: "unauthenticated" } });
    expect(checkAdminAccess(venueUser)).toMatchObject({ ok: false, denial: { status: 403, code: "forbidden" } });
  });
});

describe("checkBusinessUserAccess", () => {
  it("allows a venue user of an active business", () => {
    expect(checkBusinessUserAccess(venueUser)).toEqual({ ok: true, ctx: venueUser });
  });

  it("maps each denial to its status and code", () => {
    expect(checkBusinessUserAccess(null)).toMatchObject({ ok: false, denial: { status: 401, code: "unauthenticated" } });
    expect(checkBusinessUserAccess(admin)).toMatchObject({ ok: false, denial: { status: 403, code: "forbidden" } });
    expect(checkBusinessUserAccess({ ...venueUser, business: null })).toMatchObject({
      ok: false,
      denial: { status: 403, code: "no_business" },
    });
    expect(checkBusinessUserAccess({ ...venueUser, business: { ...business, isActive: false } })).toMatchObject({
      ok: false,
      denial: { status: 403, code: "business_inactive" },
    });
  });

  it("does not let an admin with a membership act as a venue user", () => {
    expect(checkBusinessUserAccess({ ...admin, business })).toMatchObject({ ok: false, denial: { code: "forbidden" } });
  });
});
