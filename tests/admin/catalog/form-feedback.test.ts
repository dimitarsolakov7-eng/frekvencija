/**
 * A11Y-09: when the genre or track editor refuses to save because of an invalid field, a polite live
 * region says what to fix and focus moves to the first invalid field (opening "More settings" when
 * the slug is the problem).
 */
import { describe, expect, it, vi } from "vitest";
import { describeFieldProblems, focusFirstInvalidField } from "@/components/admin/catalog/form-feedback";

describe("describeFieldProblems", () => {
  it("names each field that blocks saving and what to do", () => {
    expect(
      describeFieldProblems([
        { label: "Genre name", message: "Enter a genre name." },
        { label: "Description", message: undefined },
      ]),
    ).toBe("Fix 1 field before saving. Genre name: Enter a genre name.");
    expect(
      describeFieldProblems([
        { label: "Title", message: "Enter a title." },
        { label: "Artist", message: "Use at most 200 characters" },
      ]),
    ).toBe("Fix 2 fields before saving. Title: Enter a title. Artist: Use at most 200 characters.");
    expect(describeFieldProblems([{ label: "Genre name", message: "Enter a genre name." }], "creating the genre")).toBe(
      "Fix 1 field before creating the genre. Genre name: Enter a genre name.",
    );
  });

  it("is empty when every field is fine", () => {
    expect(describeFieldProblems([])).toBe("");
    expect(
      describeFieldProblems([
        { label: "Title", message: null },
        { label: "Artist", message: "  " },
      ]),
    ).toBe("");
  });
});

describe("focusFirstInvalidField", () => {
  function fakeForm(details: { open: boolean } | null, found = true) {
    const openWhenFocused: boolean[] = [];
    const field = {
      focus: vi.fn(() => {
        if (details) openWhenFocused.push(details.open);
      }),
      closest: vi.fn((selector: string) => (selector === "details" ? details : null)),
    };
    const querySelector = vi.fn(() => (found ? field : null));
    return { form: { querySelector } as unknown as ParentNode, field, querySelector, openWhenFocused };
  }

  it("focuses the first control marked aria-invalid", () => {
    const { form, field, querySelector } = fakeForm(null);
    expect(focusFirstInvalidField(form)).toBe(true);
    expect(querySelector).toHaveBeenCalledWith('[aria-invalid="true"]');
    expect(field.focus).toHaveBeenCalledTimes(1);
  });

  it("opens a collapsed <details> around it before focusing (the slug under More settings)", () => {
    const details = { open: false };
    const { form, field, openWhenFocused } = fakeForm(details);
    expect(focusFirstInvalidField(form)).toBe(true);
    expect(details.open).toBe(true);
    expect(field.focus).toHaveBeenCalledTimes(1);
    expect(openWhenFocused).toEqual([true]);
  });

  it("does nothing without an invalid field or a form", () => {
    expect(focusFirstInvalidField(fakeForm(null, false).form)).toBe(false);
    expect(focusFirstInvalidField(null)).toBe(false);
  });
});
