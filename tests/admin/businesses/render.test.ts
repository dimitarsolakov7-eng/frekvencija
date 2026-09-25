/**
 * Server-render smoke tests for the screen-06 components (list, detail panel, add form, access
 * requests) and the settings screen: they must render with realistic data and expose the labels,
 * states and links the admin relies on. Fixtures are the development-preview fixtures.
 */
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/admin/businesses" }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement(
      "a",
      { href, ...Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "prefetch" && key !== "scroll")) },
      children,
    ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  usePathname: () => nav.pathname,
  redirect: () => {
    throw new Error("redirect");
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const { ToastProvider } = await import("@/components/ui");
const { BusinessesDirectory } = await import("@/components/admin/businesses/BusinessesDirectory");
const { BusinessDetailPanel } = await import("@/components/admin/businesses/BusinessDetailPanel");
const { NewBusinessForm } = await import("@/components/admin/businesses/NewBusinessForm");
const { AccessRequestsView } = await import("@/components/admin/businesses/AccessRequestsView");
const { BusinessDetailPlaceholder, BusinessDetailSkeleton, BusinessNotFound } = await import(
  "@/components/admin/businesses/DetailPlaceholders"
);
const { toAccessRequestPrefill } = await import("@/components/admin/businesses/access-request-rules");
const { SettingsForm } = await import("@/components/admin/settings/SettingsForm");
const { IntegrationStatusCard } = await import("@/components/admin/settings/IntegrationStatusCard");
const { default: AdminNotFound } = await import("@/app/admin/not-found");
const fixtures = await import("@/app/dev/preview/businesses/fixtures");

const BASE = "/admin/businesses";
const noop = async () => ({ ok: true, message: "ok", fieldErrors: {} });
const directoryActions = { setBusinessActive: noop, sendBusinessPasswordReset: noop, deleteBusiness: noop };
const detailActions = {
  saveBusinessProfile: noop,
  removeBusinessLogo: noop,
  inviteMember: async () => ({ ok: true, message: "ok", fieldErrors: {}, link: null }),
  sendMemberAccess: async () => ({ ok: true, message: "ok", fieldErrors: {}, link: null }),
  removeMember: noop,
};

function render(node: ReactNode, pathname = BASE): string {
  nav.pathname = pathname;
  // React separates adjacent text nodes with <!-- --> in server HTML; drop them to match visible text.
  return renderToString(createElement(ToastProvider, null, node)).replace(/<!-- -->/g, "");
}

/** Whether some <tag …> in the markup carries every given attribute (in any order). */
function hasTag(html: string, tag: string, attributes: string[]): boolean {
  const tags = html.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g")) ?? [];
  return tags.some((markup) => attributes.every((attribute) => markup.includes(attribute)));
}

type DirectoryProps = Omit<Parameters<typeof BusinessesDirectory>[0], "children">;
const Directory = BusinessesDirectory as unknown as ComponentType<DirectoryProps>;

function directory(children: ReactNode, list: DirectoryProps["list"] = { items: fixtures.fixtureListItems(), statusNote: null }) {
  const props: DirectoryProps = {
    list,
    newRequestCount: 2,
    basePath: BASE,
    announcementsPath: "/admin/announcements",
    actions: directoryActions,
    accessUnavailableReason: null,
  };
  return createElement(Directory, props, children);
}

describe("business list", () => {
  it("renders every venue with its type, station, status and menu, and the page heading", () => {
    const html = render(directory(createElement(BusinessDetailPlaceholder, { basePath: BASE })));
    expect(html).toContain(">Businesses</h1>");
    expect(html).toContain("A personal station for every space.");
    expect(html).toContain(`href="${BASE}/new"`);
    for (const name of ["EmeraldBar", "Hotel Aurora", "Café Central", "Restaurant Olive"]) expect(html).toContain(name);
    expect(html).toContain("Restaurant Olive Radio");
    expect(html).toContain(">Active<");
    expect(html).toContain(">Invited<");
    expect(html).toContain(">Inactive<");
    expect(html).toContain('aria-label="Actions for EmeraldBar"');
    expect(html).toContain('aria-label="Search businesses"');
    expect(html).toContain('<option value="invited">Invited</option>');
    expect(html).toContain(`href="${BASE}/requests"`);
    expect(html).toContain("2 new");
    expect(html).toContain("Select a business");
  });

  it("marks the open venue and, on small screens, shows only its detail with a way back", () => {
    const html = render(directory(createElement("p", null, "DETAIL")), `${BASE}/${fixtures.EMERALDBAR_ID}`);
    expect(hasTag(html, "a", [`href="${BASE}/${fixtures.EMERALDBAR_ID}"`, 'aria-current="page"'])).toBe(true);
    expect(hasTag(html, "section", ['aria-label="Business list"', "hidden lg:block"])).toBe(true);
    expect(html).toContain("All businesses");
    expect(html).toContain("DETAIL");
  });

  it("has honest empty and error states", () => {
    const empty = render(directory(null, { items: [], statusNote: null }));
    expect(empty).toContain("No businesses yet");
    const failed = render(directory(null, null));
    expect(failed).toContain("The businesses couldn’t be loaded");
    expect(failed).toContain("Try again");
    const unverified = render(directory(null, { items: fixtures.fixtureListItems({ statusesKnown: false }), statusNote: "No secret key." }));
    expect(unverified).toContain("No secret key.");
  });
});

describe("business detail panel", () => {
  function panel(id: string, extra: Record<string, unknown> = {}) {
    const detail = fixtures.fixtureDetail(id)!;
    return render(
      directory(
        createElement(BusinessDetailPanel, {
          detail,
          actions: detailActions,
          invitesUnavailableReason: null,
          genresHref: "/admin/genres",
          ...extra,
        }),
      ),
      `${BASE}/${id}`,
    );
  }

  it("shows the tabs, identity and the profile form with every saved value", () => {
    const html = panel(fixtures.EMERALDBAR_ID);
    for (const tab of ["Profile", "Access", "Announcements"]) expect(html).toMatch(new RegExp(`role="tab"[^>]*>${tab}<`));
    expect(html).toContain(">EmeraldBar</h2>");
    expect(html).toContain("Business details");
    expect(hasTag(html, "input", ['name="stationName"', 'value="EmeraldBar Radio"'])).toBe(true);
    expect(hasTag(html, "input", ['name="contactEmail"', 'value="manager@emeraldbar.example"'])).toBe(true);
    expect(html).toMatch(/<option value="bar" selected="">Bar<\/option>/);
    expect(html).toContain('name="isActive"');
    expect(html).toContain("Pronunciation for announcements");
    expect(html).toContain("Save changes");
    expect(html).toContain("Send password reset");
    expect(html).toContain("Passwords are managed securely by the business.");
    expect(html).toContain(`href="/admin/announcements?business=${fixtures.EMERALDBAR_ID}"`);
    expect(html).toContain('href="/admin/genres"');
    expect(html).toContain("Replace logo");
    expect(html).toContain(`aria-label="More actions for EmeraldBar"`);
  });

  it("renders genre access as tiles: exclusive ones tickable, shared ones included and locked", () => {
    const html = panel(fixtures.EMERALDBAR_ID);
    const exclusive = (html.match(/name="genreIds"/g) ?? []).length;
    expect(exclusive).toBe(3); // Deep House, Balkan Hits, Chillout
    expect((html.match(/name="shownGenreIds"/g) ?? []).length).toBe(3);
    expect(html).toContain("All venues");
    expect(html).toContain("1 disabled genre is hidden here");
    expect(html).toContain("Choose which genres this business can access on their station.");
  });

  it("includes the Access and Announcements tabs' content", () => {
    const html = panel(fixtures.HOTEL_AURORA_ID);
    expect(html).toContain("Staff accounts");
    expect(html).toContain("nights@hotelaurora.example");
    expect(html).toContain("Invitation pending");
    expect(hasTag(html, "button", ['name="delivery"', 'value="link"'])).toBe(true);
    expect(html).toContain("Station identity");
    expect(html).toContain("1 announcement needs review");
    expect(html).toContain("after every 6 completed songs");
  });

  it("explains a venue without staff and a just-created venue", () => {
    const html = panel(fixtures.CAFE_CENTRAL_ID, { justCreated: true });
    expect(html).toContain("Café Central was created");
    expect(html).toContain("Shown as Invited until a staff account accepts its invitation.");
  });

  it("offers placeholders for loading and missing venues", () => {
    expect(render(createElement(BusinessDetailSkeleton))).toContain("Loading the business…");
    expect(render(directory(createElement(BusinessNotFound, { basePath: BASE })))).toContain("This business doesn’t exist");
  });
});

describe("add business form", () => {
  it("prefills from an access request and invites the contact by default", () => {
    const request = fixtures.FIXTURE_REQUESTS[0];
    const html = render(
      directory(
        createElement(NewBusinessForm, {
          action: async () => ({ ok: false, message: null, fieldErrors: {}, created: null, link: null, warnings: [] }),
          genres: fixtures.fixtureGenres(),
          prefill: toAccessRequestPrefill(request),
          notices: ["That request is already declined."],
          defaultFrequency: { everyNTracks: 4, fromSettings: true },
          invitesUnavailableReason: null,
          basePath: BASE,
          settingsHref: "/admin/settings",
          genresHref: "/admin/genres",
        }),
      ),
      `${BASE}/new`,
    );
    expect(hasTag(html, "input", ['name="name"', 'value="Bistro Lipa"'])).toBe(true);
    expect(hasTag(html, "input", ['name="stationName"', 'value="Bistro Lipa Radio"'])).toBe(true);
    expect(hasTag(html, "input", ['name="contactEmail"', 'value="ana@bistrolipa.example"'])).toBe(true);
    expect(hasTag(html, "input", ['name="fromRequest"', `value="${request.id}"`])).toBe(true);
    expect(html).toMatch(/<option value="restaurant" selected="">Restaurant<\/option>/);
    expect(html).toContain("From the access request of Ana Petrović");
    expect(html).toContain("That request is already declined.");
    expect(html).toContain("Invite the contact now");
    expect(html).toContain('role="switch" aria-checked="true"');
    expect(hasTag(html, "input", ['type="hidden"', 'name="inviteContact"', 'value="false"'])).toBe(true);
    expect(html).toContain("after every 4 completed songs");
    expect(html).toContain("Create business");
  });

  it("switches the invitation off when invitations are unavailable", () => {
    const html = render(
      directory(
        createElement(NewBusinessForm, {
          action: async () => ({ ok: false, message: null, fieldErrors: {}, created: null, link: null, warnings: [] }),
          genres: [],
          prefill: null,
          notices: [],
          defaultFrequency: { everyNTracks: 4, fromSettings: false },
          invitesUnavailableReason: "SUPABASE_SECRET_KEY is not set on the server.",
          basePath: BASE,
          settingsHref: "/admin/settings",
          genresHref: "/admin/genres",
        }),
      ),
      `${BASE}/new`,
    );
    expect(html).toContain('role="switch" aria-checked="false"');
    expect(html).toContain("SUPABASE_SECRET_KEY is not set on the server.");
    expect(html).toContain("the built-in default");
    expect(html).toContain("There are no enabled genres yet.");
  });
});

describe("access requests", () => {
  it("lists requests as labelled cards with their status actions", () => {
    const html = render(
      createElement(AccessRequestsView, {
        requests: fixtures.FIXTURE_REQUESTS,
        counts: fixtures.fixtureRequestCounts(),
        filter: "all",
        truncated: false,
        basePath: BASE,
        requestsPath: `${BASE}/requests`,
        actions: { updateAccessRequestStatus: noop, saveAccessRequestNotes: noop },
      }),
    );
    expect(html).toContain("Bistro Lipa");
    expect(html).toContain('href="mailto:ana@bistrolipa.example"');
    expect(html).toContain('href="tel:+381641234567"');
    expect(html).toContain(`href="${BASE}/new?fromRequest=${fixtures.FIXTURE_REQUEST_ID}"`);
    expect(html).toContain("Mark contacted");
    expect(html).toContain("Reopen");
    expect(html).toContain("Called on Monday.");
    expect(hasTag(html, "a", [`href="${BASE}/requests"`, 'aria-current="page"'])).toBe(true);
    expect(html).toContain('name="adminNotes"');
    expect(html).toContain('maxLength="2000"');
    // Closed requests are not offered for creation.
    expect((html.match(/Create business from request/g) ?? []).length).toBe(2);
  });

  it("has an honest empty state per filter", () => {
    const html = render(
      createElement(AccessRequestsView, {
        requests: [],
        counts: null,
        filter: "approved",
        truncated: false,
        basePath: BASE,
        requestsPath: `${BASE}/requests`,
        actions: { updateAccessRequestStatus: noop, saveAccessRequestNotes: noop },
      }),
    );
    expect(html).toContain("No approved requests");
    expect(html).toContain("Show all requests");
    expect(html).toContain("couldn’t be counted");
  });
});

describe("settings", () => {
  it("renders the settings form with the saved values and the plain-text hint", () => {
    const html = render(
      createElement(SettingsForm, {
        settings: {
          contactEmail: "hello@frekvencija.online",
          contactPhone: "+389 70 123 456",
          privacyPolicy: "First paragraph.\n\nSecond paragraph.",
          termsOfService: null,
          defaultAnnouncementEveryNTracks: 5,
          updatedAt: "2026-09-24T16:05:00Z",
          updatedByEmail: "admin@frekvencija.online",
          rowMissing: false,
        },
        action: async () => ({ ok: true, message: "Saved", fieldErrors: {} }),
        privacyHref: "/privacy",
        termsHref: "/terms",
      }),
      "/admin/settings",
    );
    expect(hasTag(html, "input", ['name="contactEmail"', 'value="hello@frekvencija.online"'])).toBe(true);
    expect(hasTag(html, "input", ['name="defaultAnnouncementEveryNTracks"', 'value="5"', 'min="1"', 'max="50"'])).toBe(true);
    expect(html).toContain("leave a blank line between paragraphs");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain("Last saved 24 Sep 2026, 16:05 UTC by admin@frekvencija.online.");
  });

  it("warns when the settings row is missing and disables saving", () => {
    const html = render(
      createElement(SettingsForm, {
        settings: {
          contactEmail: null,
          contactPhone: null,
          privacyPolicy: null,
          termsOfService: null,
          defaultAnnouncementEveryNTracks: 4,
          updatedAt: null,
          updatedByEmail: null,
          rowMissing: true,
        },
        action: async () => ({ ok: true, message: "Saved", fieldErrors: {} }),
        privacyHref: "/privacy",
        termsHref: "/terms",
      }),
      "/admin/settings",
    );
    expect(html).toContain("The settings row is missing");
    expect(hasTag(html, "button", ['type="submit"', 'disabled=""'])).toBe(true);
  });

  it("renders the integration status read-only", () => {
    const html = render(
      createElement(IntegrationStatusCard, {
        items: [
          { key: "supabase", name: "Supabase", state: "ok", summary: "Configured.", details: [{ label: "Project", value: "x.supabase.co" }] },
          { key: "elevenlabs", name: "ElevenLabs voice generation", state: "off", summary: "Not configured.", details: [] },
          { key: "email", name: "Email delivery", state: "info", summary: "Custom SMTP recommended.", details: [] },
        ],
      }),
    );
    expect(html).toContain("Integration status");
    expect(html).toContain("x.supabase.co");
    expect(html).toContain("Not configured");
    expect(html).toContain("Custom SMTP recommended.");
    expect(html).not.toContain("<input");
  });
});

describe("admin not found", () => {
  it("keeps the admin navigation available", () => {
    const html = render(createElement(AdminNotFound));
    expect(html).toContain("This page isn’t here");
    expect(html).toContain('href="/admin/music"');
  });
});
