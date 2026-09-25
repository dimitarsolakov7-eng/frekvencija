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

  it("loading skeleton announces itself", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementsLoading));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading announcements…");
  });
});
