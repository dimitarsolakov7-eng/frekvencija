/**
 * Server-render smoke tests for the announcements studio (screen 07), rendered through the dev
 * preview's fixtures: it must render without a browser and expose the labels, states and
 * accessible structure the admin relies on.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/admin/announcements",
}));
const guard = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@/components/admin/shell/unsaved-changes", () => ({
  useUnsavedChangesGuard: guard.register,
  useConfirmDiscard: () => async () => true,
}));

const { ToastProvider } = await import("@/components/ui");
const { AnnouncementsPreview } = await import("@/app/dev/preview/announcements/AnnouncementsPreview");
const { AnnouncementSettingsCard } = await import("@/components/admin/announcements/AnnouncementSettingsCard");
const { default: AnnouncementsLoading } = await import("@/app/admin/announcements/loading");

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(ToastProvider, null, node));
}

/** Whether some <tag …> in the markup carries every given attribute (in any order). */
function hasTag(html: string, tag: string, attributes: string[]): boolean {
  const tags = html.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g")) ?? [];
  return tags.some((markup) => attributes.every((attribute) => markup.includes(attribute)));
}

describe("announcements studio renders", () => {
  it("default: heading, editor with the ready clip, settings and recordings", () => {
    const html = render(createElement(AnnouncementsPreview, { tts: "on", scenario: "default" }));

    // Heading and venue selector.
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/admin/businesses"');
    expect(html).toMatch(/<h1[^>]*>EmeraldBar Radio<\/h1>/);
    expect(html).toContain("Your music. Their name.");
    expect(html).toContain(">Hotel Aurora</option>");
    expect(html).toContain(">Restaurant Olive (inactive)</option>");

    // Segmented tabs.
    expect(hasTag(html, "button", ['role="tab"', 'aria-selected="true"'])).toBe(true);
    expect(html).toContain("Generate voice");
    expect(html).toContain("Upload recording");

    // Editor bound to the ready recording.
    expect(html).toContain("Create an announcement");
    expect(html).toContain("You’re listening to EmeraldBar Radio.</textarea>");
    expect(html).toContain("37/500");
    expect(html).toContain("Pronunciation spelling");
    expect(html).toContain('aria-label="About pronunciation spelling"');
    expect(html).toContain("“You’re listening to Emerald Bar Radio.”");
    expect(html).toContain("Station identity");
    expect(html).toContain("Welcome message");
    expect(html).toContain("Plays between songs, after every 4 completed songs.");
    // Voices load in the browser: the skeleton keeps the final geometry meanwhile.
    expect(html).toContain('aria-label="Loading voices and models"');

    // Audio preview with the explicit publish step.
    expect(html).toContain("Audio preview");
    expect(html).toContain("Ready for review");
    expect(html).toContain("Approve &amp; activate");
    expect(html).toContain("Regenerate");
    expect(html).toContain("0:00 / 0:06");
    expect(html).toContain('aria-label="Play the audio preview"');

    // Upload with the real limit.
    expect(html).toContain("Drop an MP3 file here");
    expect(html).toContain("MP3 only, max 10 MB");

    // Settings and recordings.
    expect(html).toContain("Announcement settings");
    expect(html).toContain('<option value="4" selected="">4 completed songs</option>');
    expect(html).toContain("Announcements play between songs.");
    expect(html).toContain('aria-valuetext="70%"');
    expect(html).toContain("Save settings");
    expect(html).toContain("Active recordings");
    expect(html).toContain('aria-label="Actions for Station identity “Good music. Good company. This is EmeraldBar Radio.”"');
    expect(html).toContain("Other recordings");
    expect(html).toContain("In editor");
  });

  it("voice not configured: clear notice, upload tab first and still usable", () => {
    const html = render(createElement(AnnouncementsPreview, { tts: "off", scenario: "empty" }));
    expect(html).toContain("The AI voice isn&#x27;t set up yet");
    expect(hasTag(html, "button", ['role="tab"', 'aria-selected="true"', 'data-value="upload"'])).toBe(true);
    expect(html).toContain("Drop an MP3 file here");
    expect(html).not.toContain("Loading voices and models");
    expect(html).toContain("Nothing is on air yet");
  });

  it("needs review: banner, Re-approve, failed recording with Retry, draft with Continue", () => {
    const html = render(createElement(AnnouncementsPreview, { tts: "on", scenario: "review" }));
    expect(html).toContain("1 recording needs review");
    expect(html).toContain("Branding changed: &quot;Emerald Radio&quot; → &quot;EmeraldBar Radio&quot;.");
    expect(html).toContain("Re-approve");
    expect(html).toContain("Failed");
    expect(html).toContain("ElevenLabs is temporarily unavailable (HTTP 503). Try again in a minute.");
    expect(html).toContain(">Retry<");
    expect(html).toContain(">Continue<");
    expect(html).toContain("Welcome &amp; station identity");
  });

  it("settings: an interval over 12 uses the custom number field", () => {
    const html = render(
      createElement(AnnouncementSettingsCard, {
        everyNTracks: 20,
        volume: 1,
        action: async () => ({ ok: true, message: null, fieldErrors: {} }),
      }),
    );
    expect(html).toContain('<option value="custom" selected="">Custom…</option>');
    expect(hasTag(html, "input", ['name="announcementEveryNTracks"', 'type="number"', 'value="20"', 'max="50"'])).toBe(true);
    expect(html).toContain('aria-valuetext="100%"');
  });

  // A11Y-13: server field errors are linked to their controls.
  it("settings: field errors are referenced by the invalid controls", () => {
    const failure = {
      ok: false,
      message: "Check the highlighted settings.",
      fieldErrors: {
        announcementEveryNTracks: "Announcement interval must be at most 50.",
        announcementVolumePercent: "Announcement volume must be at least 10.",
      },
    };
    const idOf = (html: string, text: string) => html.match(new RegExp(`<p id="([^"]+)"[^>]*>${text}</p>`))?.[1];
    const tagWith = (html: string, needles: string[]) =>
      (html.match(/<input[^>]*>/g) ?? []).find((tag) => needles.every((needle) => tag.includes(needle))) ?? "";

    const custom = render(
      createElement(AnnouncementSettingsCard, { everyNTracks: 60, volume: 0.05, action: async () => failure, initialState: failure }),
    );
    const intervalErrorId = idOf(custom, "Announcement interval must be at most 50.");
    const volumeErrorId = idOf(custom, "Announcement volume must be at least 10.");
    expect(intervalErrorId).toBeTruthy();
    expect(volumeErrorId).toBeTruthy();
    const customInput = tagWith(custom, ['name="announcementEveryNTracks"', 'type="number"']);
    expect(customInput).toContain('aria-invalid="true"');
    expect(customInput).toMatch(new RegExp(`aria-describedby="[^"]*${intervalErrorId}`));
    const slider = tagWith(custom, ['type="range"']);
    expect(slider).toContain('aria-invalid="true"');
    expect(slider).toMatch(new RegExp(`aria-describedby="[^"]*${volumeErrorId}`));

    const preset = render(createElement(AnnouncementSettingsCard, { everyNTracks: 4, volume: 1, action: async () => failure, initialState: failure }));
    const presetErrorId = idOf(preset, "Announcement interval must be at most 50.");
    const select = preset.match(/<select[^>]*>/)?.[0] ?? "";
    expect(select).toContain('aria-invalid="true"');
    expect(select).toMatch(new RegExp(`aria-describedby="[^"]*${presetErrorId}`));

    // Without errors the controls point at their hints only.
    const clean = render(createElement(AnnouncementSettingsCard, { everyNTracks: 4, volume: 1, action: async () => failure }));
    expect(clean).not.toContain('aria-invalid="true"');
  });

  // NAV-01: the studio's wording and its settings card report unsaved work to the admin-wide guard.
  it("registers the editor and the settings card with the unsaved-changes guard", () => {
    guard.register.mockClear();
    render(createElement(AnnouncementsPreview, { tts: "on", scenario: "default" }));
    expect(guard.register).toHaveBeenCalledWith(false, { message: "Your announcement text hasn’t been saved." });
    expect(guard.register).toHaveBeenCalledWith(false, { message: "Your announcement settings haven’t been saved." });
  });

  it("loading skeleton announces itself", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementsLoading));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading announcements…");
  });
});
