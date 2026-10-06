/**
 * NAV-01: the business and settings editors report unsaved work to the admin-wide guard (mounted in
 * AdminShell), which holds back every link; navigation started from code (menu items such as "Open"
 * and "Manage announcements") asks through the guard's confirmDiscard() first.
 */
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  confirm: vi.fn<() => Promise<boolean>>(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "prefetch" && key !== "scroll")) }, children),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: h.push, replace: h.replace }),
  usePathname: () => "/admin/businesses",
}));
vi.mock("@/components/admin/shell/unsaved-changes", () => ({
  useUnsavedChangesGuard: h.guard,
  useConfirmDiscard: () => h.confirm,
}));

const { ToastProvider } = await import("@/components/ui");
const { useGuardedNavigation } = await import("@/components/admin/businesses/unsaved-changes");
const { BusinessesDirectory } = await import("@/components/admin/businesses/BusinessesDirectory");
const { BusinessDetailPanel } = await import("@/components/admin/businesses/BusinessDetailPanel");
const { NewBusinessForm } = await import("@/components/admin/businesses/NewBusinessForm");
const { SettingsForm } = await import("@/components/admin/settings/SettingsForm");
const { AccessRequestsView } = await import("@/components/admin/businesses/AccessRequestsView");
const fixtures = await import("@/app/dev/preview/businesses/fixtures");

type DirectoryProps = Omit<Parameters<typeof BusinessesDirectory>[0], "children">;
const Directory = BusinessesDirectory as unknown as ComponentType<DirectoryProps>;

type Navigation = ReturnType<typeof useGuardedNavigation>;

function navigation(): Navigation {
  let captured: Navigation | null = null;
  function Probe() {
    captured = useGuardedNavigation();
    return null;
  }
  renderToString(createElement(Probe));
  if (!captured) throw new Error("The hook did not run.");
  return captured;
}

const noop = async () => ({ ok: true, message: "ok", fieldErrors: {} });

function render(node: ReactNode): string {
  return renderToString(createElement(ToastProvider, null, node));
}

beforeEach(() => {
  h.guard.mockReset();
  h.confirm.mockReset();
  h.push.mockReset();
  h.replace.mockReset();
});

describe("useGuardedNavigation", () => {
  it("asks the guard first and navigates when nothing is lost or the admin discards", async () => {
    h.confirm.mockResolvedValue(true);
    await expect(navigation().navigate("/admin/announcements?business=1")).resolves.toBe(true);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith("/admin/announcements?business=1", { scroll: true });

    await navigation().navigate("/admin/businesses", { replace: true, scroll: false });
    expect(h.replace).toHaveBeenCalledWith("/admin/businesses", { scroll: false });
  });

  it("stays when the admin keeps editing", async () => {
    h.confirm.mockResolvedValue(false);
    await expect(navigation().navigate("/admin/businesses/abc")).resolves.toBe(false);
    expect(h.push).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
  });
});

describe("editors register with the admin-wide guard", () => {
  it("the Profile form reports its unsaved state for the venue", () => {
    const detail = fixtures.fixtureDetail(fixtures.EMERALDBAR_ID)!;
    render(
      createElement(
        Directory,
        {
          list: { items: fixtures.fixtureListItems(), statusNote: null },
          newRequestCount: 0,
          basePath: "/admin/businesses",
          announcementsPath: "/admin/announcements",
          actions: { setBusinessActive: noop, sendBusinessPasswordReset: noop, deleteBusiness: noop },
          accessUnavailableReason: null,
        },
        createElement(BusinessDetailPanel, {
          detail,
          actions: {
            saveBusinessProfile: noop,
            removeBusinessLogo: noop,
            inviteMember: async () => ({ ok: true, message: "ok", fieldErrors: {}, link: null }),
            sendMemberAccess: async () => ({ ok: true, message: "ok", fieldErrors: {}, link: null }),
            removeMember: noop,
          },
          invitesUnavailableReason: null,
          genresHref: "/admin/genres",
        }),
      ),
    );
    expect(h.guard).toHaveBeenCalledWith(false, { message: "Your changes to EmeraldBar haven’t been saved." });
  });

  it("the add form and the settings form report theirs", () => {
    render(
      createElement(NewBusinessForm, {
        action: async () => ({ ok: false, message: null, fieldErrors: {}, created: null, link: null, warnings: [] }),
        genres: [],
        prefill: null,
        notices: [],
        defaultFrequency: { everyNTracks: 4, fromSettings: true },
        invitesUnavailableReason: null,
        basePath: "/admin/businesses",
        settingsHref: "/admin/settings",
        genresHref: "/admin/genres",
      }),
    );
    expect(h.guard).toHaveBeenCalledWith(false, { message: "The new business hasn’t been created yet." });

    render(
      createElement(SettingsForm, {
        settings: {
          contactEmail: null,
          contactPhone: null,
          privacyPolicy: null,
          termsOfService: null,
          defaultAnnouncementEveryNTracks: 4,
          updatedAt: null,
          updatedByEmail: null,
          rowMissing: false,
        },
        action: noop,
        privacyHref: "/privacy",
        termsHref: "/terms",
      }),
    );
    expect(h.guard).toHaveBeenCalledWith(false, { message: "Your settings changes haven’t been saved." });
  });

  // A11Y-08 follow-up: notes typed on an access-request card are unsaved work too.
  it("each access-request card reports its unsaved notes", () => {
    render(
      createElement(AccessRequestsView, {
        requests: fixtures.FIXTURE_REQUESTS,
        counts: fixtures.fixtureRequestCounts(),
        filter: "all",
        truncated: false,
        basePath: "/admin/businesses",
        requestsPath: "/admin/businesses/requests",
        actions: { updateAccessRequestStatus: noop, saveAccessRequestNotes: noop },
      }),
    );
    for (const request of fixtures.FIXTURE_REQUESTS) {
      expect(h.guard).toHaveBeenCalledWith(false, { message: `Your notes on the request from ${request.businessName} haven’t been saved.` });
    }
  });
});
