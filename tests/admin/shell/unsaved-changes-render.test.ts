/**
 * NAV-01 / A11Y-06: the React side of the admin unsaved-changes guard, rendered on the server (no
 * browser here): AdminShell mounts one provider around the workspace without needing the router,
 * and the hooks work inside and outside it. The link and registry rules are in
 * unsaved-changes-rules.test.ts.
 */
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminShell } from "@/components/admin/shell";
import {
  UnsavedChangesProvider,
  useConfirmDiscard,
  useUnsavedChangesGuard,
  type ConfirmDiscard,
} from "@/components/admin/shell/unsaved-changes";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Renders a component that captures what useConfirmDiscard() returned. */
function captureConfirmDiscard(withProvider: boolean): ConfirmDiscard {
  const captured: { value: ConfirmDiscard | null } = { value: null };
  function Probe() {
    useUnsavedChangesGuard(true, { message: "Your edits to “Afterglow” haven’t been saved." });
    captured.value = useConfirmDiscard();
    return h("p", null, "editor");
  }
  const html = renderToString(withProvider ? h(UnsavedChangesProvider, null, h(Probe)) : h(Probe));
  expect(html).toContain("editor");
  if (!captured.value) throw new Error("useConfirmDiscard() was not called");
  return captured.value;
}

describe("UnsavedChangesProvider in AdminShell", () => {
  it("wraps the workspace and shows no dialog until something asks", () => {
    const html = renderToString(
      h(PathnameContext, { value: "/admin/music" }, h(AdminShell, { email: "admin@example.com", children: h("p", null, "page content") })),
    );
    expect(html).toContain("page content");
    // The question is only mounted while it is asked.
    expect(html).not.toContain("Discard unsaved changes?");
    expect(html).not.toContain("Keep editing");
  });
});

describe("useConfirmDiscard", () => {
  it("inside the provider: nothing is dirty yet (effects have not run), so it resolves true without asking", async () => {
    const confirmDiscard = captureConfirmDiscard(true);
    expect(confirmDiscard.confirmDiscard).toBe(confirmDiscard);
    await expect(confirmDiscard()).resolves.toBe(true);
    await expect(confirmDiscard.confirmDiscard({ message: "x" })).resolves.toBe(true);
  });

  it("outside a provider: falls back to the browser's confirm() with the message", async () => {
    const confirmDiscard = captureConfirmDiscard(false);
    expect(confirmDiscard.confirmDiscard).toBe(confirmDiscard);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });

    await expect(confirmDiscard({ message: "Your changes to “Jazz” haven’t been saved." })).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith("Your changes to “Jazz” haven’t been saved.");

    confirm.mockReturnValue(true);
    await expect(confirmDiscard()).resolves.toBe(true);
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("haven’t been saved"));
  });
});
