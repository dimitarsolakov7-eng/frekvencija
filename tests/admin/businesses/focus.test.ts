/**
 * Focus rules of the business screens: where focus goes when the directory switches between the
 * list and a detail on a narrow screen (A11Y-14), and after a failed or finished form submit (A11Y-07).
 */
import { describe, expect, it, vi } from "vitest";
import { detailHeadingSelector, directoryFocusMove } from "@/components/admin/businesses/detail-focus";
import { focusFirstProblem, focusWasLost, INVALID_CONTROL_SELECTOR } from "@/components/admin/businesses/form-focus";

const VENUE = "0f6b1c8e-2a41-4f6d-9c1e-6b0f8a3d2e11";
const OTHER = "1a7c2d9f-3b52-4a7e-8d2f-7c1a9b4e3f22";

describe("directoryFocusMove (A11Y-14)", () => {
  it("moves to the opened venue's heading when the list (and its focused link) was hidden", () => {
    expect(directoryFocusMove(null, VENUE, true)).toEqual({ kind: "detail", selected: VENUE });
    expect(directoryFocusMove(VENUE, OTHER, true)).toEqual({ kind: "detail", selected: OTHER });
    expect(directoryFocusMove(null, "new", true)).toEqual({ kind: "detail", selected: "new" });
  });

  it("moves back to the venue's row when returning to the list", () => {
    expect(directoryFocusMove(VENUE, null, true)).toEqual({ kind: "row", businessId: VENUE });
    expect(directoryFocusMove("new", null, true)).toEqual({ kind: "list" });
  });

  it("leaves focus alone while it is still on something visible (desktop keeps the list)", () => {
    expect(directoryFocusMove(null, VENUE, false)).toBeNull();
    expect(directoryFocusMove(VENUE, null, false)).toBeNull();
    expect(directoryFocusMove(VENUE, VENUE, true)).toBeNull();
  });

  it("targets the heading of exactly the selected venue, or the not-found placeholder", () => {
    expect(detailHeadingSelector(VENUE)).toBe(`[data-detail-heading="${VENUE}"], [data-detail-heading="*"]`);
    expect(detailHeadingSelector('a"b')).toContain('[data-detail-heading="a\\"b"]');
  });
});

describe("focus after a form result (A11Y-07)", () => {
  function focusable(name: string) {
    return { name, focus: vi.fn() };
  }

  it("focuses the first invalid field of the form", () => {
    const field = focusable("stationName");
    const message = focusable("message");
    const form = { querySelector: vi.fn((selector: string) => (selector === INVALID_CONTROL_SELECTOR ? field : null)) };
    expect(focusFirstProblem(form, message)).toBe(field);
    expect(field.focus).toHaveBeenCalledTimes(1);
    expect(message.focus).not.toHaveBeenCalled();
  });

  it("falls back to the form's message when no field is marked invalid", () => {
    const message = focusable("message");
    expect(focusFirstProblem({ querySelector: () => null }, message)).toBe(message);
    expect(message.focus).toHaveBeenCalledTimes(1);
    expect(focusFirstProblem(null, null)).toBeNull();
  });

  it("only counts focus as lost when nothing or the page body has it", () => {
    const body = {} as Element;
    const button = {} as Element;
    expect(focusWasLost(null, body)).toBe(true);
    expect(focusWasLost(body, body)).toBe(true);
    expect(focusWasLost(button, body)).toBe(false);
  });
});
