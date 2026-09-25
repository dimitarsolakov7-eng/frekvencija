/**
 * Pure authorization rules shared by page guards, API guards and Server Actions (no I/O here, so the
 * rules are unit-testable). Session lookup lives in ./session.ts.
 */
import type { AppRole } from "@/types/database";

export interface SessionBusiness {
  id: string;
  name: string;
  stationName: string;
  isActive: boolean;
}

export interface SessionContext {
  userId: string;
  email: string;
  role: AppRole;
  /** The user's business from `business_members` (any status), or null. */
  business: SessionBusiness | null;
}

export type AdminSessionContext = SessionContext & { role: "platform_admin" };
/** Venue user whose business may be missing or inactive (pages explain that state). */
export type VenueSessionContext = SessionContext & { role: "business_user" };
/** Venue user with an active business: the only context allowed to touch content. */
export type BusinessUserSessionContext = VenueSessionContext & { business: SessionBusiness & { isActive: true } };

export type AccessDenialCode = "unauthenticated" | "forbidden" | "no_business" | "business_inactive";

export interface AccessDenial {
  status: 401 | 403;
  code: AccessDenialCode;
  message: string;
}

export type AccessDecision<C> = { ok: true; ctx: C } | { ok: false; denial: AccessDenial };

export const ACCESS_DENIALS = {
  unauthenticated: { status: 401, code: "unauthenticated", message: "Your session has expired. Please sign in again." },
  adminOnly: { status: 403, code: "forbidden", message: "This action requires a platform administrator." },
  venueOnly: { status: 403, code: "forbidden", message: "This is only available to venue accounts." },
  noBusiness: {
    status: 403,
    code: "no_business",
    message: "Your account is not linked to a venue yet. Ask your administrator to add you to one.",
  },
  businessInactive: {
    status: 403,
    code: "business_inactive",
    message: "This venue is not active. Please contact your administrator.",
  },
} as const satisfies Record<string, AccessDenial>;

export function isAdminContext(ctx: SessionContext): ctx is AdminSessionContext {
  return ctx.role === "platform_admin";
}

export function isVenueContext(ctx: SessionContext): ctx is VenueSessionContext {
  return ctx.role === "business_user";
}

export function checkAdminAccess(ctx: SessionContext | null): AccessDecision<AdminSessionContext> {
  if (!ctx) return { ok: false, denial: ACCESS_DENIALS.unauthenticated };
  if (!isAdminContext(ctx)) return { ok: false, denial: ACCESS_DENIALS.adminOnly };
  return { ok: true, ctx };
}

export function checkBusinessUserAccess(ctx: SessionContext | null): AccessDecision<BusinessUserSessionContext> {
  if (!ctx) return { ok: false, denial: ACCESS_DENIALS.unauthenticated };
  if (!isVenueContext(ctx)) return { ok: false, denial: ACCESS_DENIALS.venueOnly };
  const { business } = ctx;
  if (!business) return { ok: false, denial: ACCESS_DENIALS.noBusiness };
  if (!business.isActive) return { ok: false, denial: ACCESS_DENIALS.businessInactive };
  return { ok: true, ctx: { ...ctx, business: { ...business, isActive: true } } };
}
