/**
 * Server-render smoke tests for the venue radio UI (no browser here): every client component must
 * render on the server without touching window/navigator/localStorage, from the static idle
 * snapshot, with the accessible markup the player relies on.
 */
import { createElement as h, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { describe, expect, it, vi } from "vitest";
import { loadDemoManifest } from "@/app/api/dev/_lib/demo-manifest";
import { VenueStatusScreen } from "@/app/(venue)/_components/VenueStatusScreen";
import RadioLoading from "@/app/(venue)/radio/loading";
import AccountLoading from "@/app/(venue)/account/loading";
import HelpLoading from "@/app/(venue)/help/loading";
import { buildLabCatalog } from "@/app/dev/player-lab/lab-catalog";
import { PlayerLab } from "@/app/dev/player-lab/PlayerLab";
import RadioPreviewPage from "@/app/dev/preview/radio/page";
import AccountPreviewPage from "@/app/dev/preview/radio/account/page";
import HelpPreviewPage from "@/app/dev/preview/radio/help/page";
import { AccountView } from "@/components/player/AccountView";
import { GenreCardAction } from "@/components/player/GenreGrid";
import { HelpScreen } from "@/components/player/HelpScreen";
import { HeroPrimaryControl } from "@/components/player/NowPlayingHero";
import { PlayerBar } from "@/components/player/PlayerBar";
import { PlayerProvider } from "@/components/player/PlayerProvider";
import { NO_VOICE_CLIP_COPY, SKIP_MUSIC_ONLY_COPY, createIdleSnapshot, genreCardState, getPrimaryAction } from "@/components/player/player-view";
import { RadioScreen } from "@/components/player/RadioScreen";
import { VenueAppShell } from "@/components/player/VenueAppShell";
import type { ActionState } from "@/lib/actions/state";
import type { PlayerBootstrap } from "@/lib/api/contracts";
import type { PlayerSnapshot } from "@/lib/player/types";

function bootstrap(overrides: Partial<PlayerBootstrap> = {}): PlayerBootstrap {
  return {
    userId: "user-1",
    business: {
      id: "biz-1",
      name: "EmeraldBar",
      stationName: "EmeraldBar Radio",
      type: "bar",
      logoUrl: null,
      language: "en",
      announcementEveryNTracks: 3,
      announcementVolume: 1,
    },
    genres: [
      { id: "g-lounge", name: "Lounge", slug: "lounge", description: "Stylish, relaxed, sophisticated.", trackCount: 4, coverUrl: null },
      { id: "g-pop", name: "Pop", slug: "pop", description: null, trackCount: 0, coverUrl: null },
    ],
    preferences: { genreId: null, volume: 0.6, muted: false },
    announcementCounts: { welcome: 1, rotation: 1 },
    announcements: [
      { id: "a-welcome", placement: "welcome", durationSeconds: 4, text: "Welcome to EmeraldBar. Enjoy the music." },
      { id: "a-station", placement: "rotation", durationSeconds: 3, text: "You’re listening to EmeraldBar Radio." },
    ],
    support: { email: null, phone: null },
    ...overrides,
  };
}

/** React separates adjacent text nodes with <!-- --> markers; tests read the text without them. */
const withoutTextMarkers = (html: string) => html.replaceAll("<!-- -->", "");

function renderInVenue(children: ReactNode, pathname = "/radio", data = bootstrap()): string {
  return withoutTextMarkers(
    renderToString(h(PathnameContext, { value: pathname, children: h(PlayerProvider, { bootstrap: data, children }) })),
  );
}

async function renderPage(element: Promise<ReactNode> | ReactNode, pathname: string): Promise<string> {
  return withoutTextMarkers(renderToString(h(PathnameContext, { value: pathname, children: await element })));
}

const render = (element: ReactNode) => withoutTextMarkers(renderToString(element));

/** The opening tag of the element enclosing the first occurrence of `marker` (text or attribute). */
function tagAround(html: string, marker: string, tag = "button"): string {
  const index = html.indexOf(marker);
  if (index === -1) throw new Error(`"${marker}" not found`);
  const start = html.lastIndexOf(`<${tag}`, index);
  if (start === -1) throw new Error(`no <${tag}> before "${marker}"`);
  return html.slice(start, html.indexOf(">", start) + 1);
}

/** The opening <button> tag of the button whose text ends with `label`. */
const buttonTag = (html: string, label: string) => tagAround(html, `${label}</button>`);

describe("RadioScreen (server render)", () => {
  it("renders the station heading, the ready hero and an enabled Start Radio button", () => {
    const html = renderInVenue(h(RadioScreen));
    expect(html).toMatch(/<h1[^>]*id="station-name"[^>]*>EmeraldBar Radio<\/h1>/);
    expect(html).toContain("Your station");
    expect(html).toContain("Choose the sound for your space.");
    expect(html).toContain("Ready to play");
    expect(html).toMatch(/<h2[^>]*id="now-playing-heading"[^>]*>Lounge<\/h2>/);
    expect(buttonTag(html, "Start Radio")).not.toMatch(/ disabled=""| aria-disabled="/);
  });

  it("gives each genre card a select toggle and a separate labelled Play button; empty genres are disabled", () => {
    const html = renderInVenue(h(RadioScreen));
    expect(tagAround(html, 'aria-label="Select Lounge"')).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Play Lounge"');
    const pop = tagAround(html, 'aria-label="Select Pop"');
    expect(pop).toContain('aria-pressed="false"');
    expect(pop).toMatch(/ disabled=""/);
    expect(html).not.toContain('aria-label="Play Pop"');
    expect(html).toContain("No tracks yet");
    expect(html).toContain("4 tracks");
    // Nothing is playing yet, so no card claims it is.
    expect(html).not.toMatch(/>Playing</);
  });

  it("shows the venue's station voice clip, its interval and a Preview button", () => {
    const html = renderInVenue(h(RadioScreen));
    expect(html).toContain("Your station voice");
    expect(html).toContain("You’re listening to EmeraldBar Radio.");
    expect(html).toContain("Every 3 songs");
    expect(buttonTag(html, "Preview")).not.toMatch(/ disabled=""/);
    expect(html).toContain("Coming up");
    expect(html).toContain("Start the radio to see the next songs.");
  });

  it("is honest when the venue has no approved clip", () => {
    const html = renderInVenue(h(RadioScreen), "/radio", bootstrap({ announcements: [], announcementCounts: { welcome: 0, rotation: 0 } }));
    expect(html).toContain(NO_VOICE_CLIP_COPY);
    expect(html).not.toContain(">Preview</button>");
  });

  it("says No music available yet without genres, and disables Start Radio (focusable, aria-disabled)", () => {
    const html = renderInVenue(h(RadioScreen), "/radio", bootstrap({ genres: [] }));
    expect(html).toContain("No music available yet.");
    expect(html).toContain("No genres to choose from yet");
    expect(buttonTag(html, "Start Radio")).toMatch(/aria-disabled="true"/);
  });

  it("says No music available yet when the genres have no tracks", () => {
    const html = renderInVenue(
      h(RadioScreen),
      "/radio",
      bootstrap({ genres: [{ id: "g-pop", name: "Pop", slug: "pop", description: null, trackCount: 0, coverUrl: null }] }),
    );
    expect(html).toContain("No music available yet.");
    expect(buttonTag(html, "Start Radio")).toMatch(/aria-disabled="true"/);
  });
});

describe("focus-stable controls (A11Y-03, A11Y-04)", () => {
  const idle = createIdleSnapshot({ genreId: "g-lounge", volume: 0.6, muted: false });
  const started = (overrides: Partial<PlayerSnapshot>): PlayerSnapshot => ({ ...idle, hasStarted: true, ...overrides });

  it("the hero's big control is the same host <button> for every action (React keeps the focused node)", () => {
    const snapshots: PlayerSnapshot[] = [
      idle,
      started({ status: "loading" }),
      started({ status: "playing" }),
      started({ status: "paused" }),
      started({ status: "blocked" }),
      started({ status: "error", errorCode: "network" }),
      started({ status: "error", errorCode: "auth_expired" }),
      started({ status: "empty" }),
    ];
    const kinds = new Set<string>();
    for (const snapshot of snapshots) {
      const action = getPrimaryAction(snapshot, true);
      kinds.add(action.kind);
      const element = HeroPrimaryControl({ action, onPrimary: () => undefined });
      expect(element.type, action.kind).toBe("button");
      expect(element.key).toBeNull();
      expect(element.props.type).toBe("button");
      expect(element.props["aria-disabled"]).toBe(action.disabled ? true : undefined);
      expect(element.props.disabled).toBeUndefined(); // `disabled` would drop focus
    }
    expect(kinds).toEqual(new Set(["start", "pause", "resume", "unblock", "retry", "none"]));
  });

  it("an unavailable hero action keeps its button but does nothing when pressed", () => {
    const onPrimary = vi.fn();
    HeroPrimaryControl({ action: { kind: "none", label: "Play", disabled: true }, onPrimary }).props.onClick();
    HeroPrimaryControl({ action: { kind: "start", label: "Start Radio", disabled: true }, onPrimary }).props.onClick();
    expect(onPrimary).not.toHaveBeenCalled();
    HeroPrimaryControl({ action: { kind: "pause", label: "Pause", disabled: false }, onPrimary }).props.onClick();
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("the genre card keeps one <button> in its action slot through Play → loading → playing", () => {
    const lounge = bootstrap().genres[0];
    const onPlay = vi.fn();
    const labels: string[] = [];
    for (const status of ["idle", "loading", "buffering", "playing", "paused"] as const) {
      const card = genreCardState(lounge, started({ status, genreId: "g-lounge" }));
      const element = GenreCardAction({ card, onPlay });
      expect(element?.type, status).toBe("button");
      expect(element?.key).toBeNull();
      expect(element?.props.disabled).toBeUndefined();
      labels.push(element?.props["aria-label"]);
      element?.props.onClick();
    }
    expect(labels).toEqual(["Play Lounge", "Lounge is loading", "Lounge is loading", "Lounge is playing", "Play Lounge"]);
    expect(onPlay).toHaveBeenCalledTimes(2); // only while it offers Play
    const empty = bootstrap().genres[1];
    expect(GenreCardAction({ card: genreCardState(empty, idle), onPlay })).toBeNull();
  });
});

describe("PlayerBar (server render)", () => {
  it("renders the persistent controls and the single live region; no previous button", () => {
    const html = renderInVenue(h(PlayerBar), "/account");
    expect(html).toContain('aria-label="Radio player"');
    expect(html).toMatch(/role="status"[^>]*>Ready\. Press Start Radio to begin\./);
    expect(html).toMatch(/aria-label="Start Radio"/);
    expect(tagAround(html, 'aria-label="Skip"')).toMatch(/aria-disabled="true"/);
    expect(tagAround(html, 'aria-label="Mute"')).toContain('aria-pressed="false"');
    expect(html).toMatch(/type="range"[^>]*aria-valuetext="60%"/);
    expect(html).toContain('aria-label="Volume"');
    expect(html).not.toMatch(/previous/i);
    expect(html).toContain("Lounge · Ready to play");
  });
});

describe("VenueAppShell (server render)", () => {
  const shell = (pathname: string) =>
    renderInVenue(h(VenueAppShell, { business: bootstrap().business, email: "bar@example.com", children: h("p", null, "PAGE") }), pathname);

  it("composes the sidebar, the mobile bars and the player bar around the page", () => {
    const html = shell("/radio");
    expect(html).toContain("PAGE");
    expect(html).toMatch(/<a[^>]*href="\/radio"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/radio"/);
    expect(html).toContain(">Your radio<");
    expect(html).toContain(">Account<");
    expect(html).toContain('href="/help"');
    expect(html).toContain(">Sign out<");
    expect(html).toContain('aria-label="EmeraldBar, account menu"');
    expect(html).toContain(">Radio<");
    expect(html).toContain('aria-label="Radio player"');
    expect(html.match(/id="main-content"/g)).toHaveLength(1);
  });

  it("marks Account as current on /account", () => {
    const html = shell("/account");
    expect(tagAround(html, ">Account<", "a")).toContain('aria-current="page"');
  });
});

describe("AccountView (server render)", () => {
  const noop = async (): Promise<ActionState> => ({ ok: true, message: "sent", fieldErrors: {} });
  const html = () =>
    renderInVenue(
      h(AccountView, {
        details: {
          businessName: "EmeraldBar",
          stationName: "EmeraldBar Radio",
          businessType: "Bar",
          contactEmail: null,
          announcementLanguage: "English (en)",
          signedInEmail: "bar@example.com",
        },
        resetAction: noop,
        changePasswordHref: "/reset-password",
      }),
      "/account",
    );

  it("shows the venue details read-only and the password actions", () => {
    const out = html();
    expect(out).toMatch(/<input[^>]*readOnly=""[^>]*value="EmeraldBar Radio"|<input[^>]*value="EmeraldBar Radio"[^>]*readOnly=""/);
    expect(out).toContain('value="English (en)"');
    expect(out).toContain('placeholder="Not set"');
    expect(out).toContain(">Send password reset email</button>");
    expect(tagAround(out, "Change password now", "a")).toContain('href="/reset-password"');
    expect(out).toContain(">Sign out<");
  });

  it("holds the playback preferences: shortcuts (on by default) and keep screen awake", () => {
    const out = html();
    expect(out).toContain("Playback on this device");
    expect(out).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(out).toContain("Keep screen awake");
    expect(out).toContain("can&#x27;t keep the screen awake");
    expect(out).toContain(">Space<");
  });
});

describe("HelpScreen (server render)", () => {
  it("explains the radio with the venue's interval and an honest device-sleep note", () => {
    const out = renderInVenue(h(HelpScreen), "/help");
    expect(out).toMatch(/<h1[^>]*>How your radio works<\/h1>/);
    expect(out).toContain("every 3 completed songs");
    expect(out).toContain("A welcome recording also plays");
    expect(out).toContain("Audio stops if the computer sleeps");
    expect(out).toContain("Tap to resume your radio.");
    expect(out).toContain("Ask your Frekvencija administrator");
  });

  it("shows the owner's contact details when configured", () => {
    const out = renderInVenue(h(HelpScreen), "/help", bootstrap({ support: { email: "owner@example.com", phone: "+389 70 123 456" } }));
    expect(out).toContain('href="mailto:owner@example.com"');
    expect(out).toContain('href="tel:+38970123456"');
  });
});

describe("VenueStatusScreen (server render)", () => {
  it("explains accounts without a venue, with a way to sign out and the contact path", () => {
    const none = render(h(VenueStatusScreen, { variant: "no-business", email: "bar@example.com", support: { email: null, phone: null } }));
    expect(none).toContain("No venue is linked to this account");
    expect(none).toContain("bar@example.com");
    expect(none).toContain(">Sign out<");
    expect(none).toContain('id="main-content"');
    expect(none).toContain("Ask your Frekvencija administrator");
  });

  it("explains an inactive venue with the configured owner contact", () => {
    const inactive = render(
      h(VenueStatusScreen, {
        variant: "inactive",
        email: "bar@example.com",
        business: { name: "EmeraldBar", stationName: "EmeraldBar Radio" },
        support: { email: "owner@example.com", phone: null },
      }),
    );
    expect(inactive).toContain("This venue is not active yet");
    expect(inactive).toContain("contact your administrator");
    expect(inactive).toContain('href="mailto:owner@example.com"');
  });
});

describe("loading skeletons", () => {
  it("announce loading once and keep the page geometry", () => {
    for (const [Loading, text] of [
      [RadioLoading, "Loading your radio…"],
      [AccountLoading, "Loading your account…"],
      [HelpLoading, "Loading help…"],
    ] as const) {
      const out = render(h(Loading));
      expect(out).toContain('role="status"');
      expect(out).toContain(text);
    }
  });
});

describe("PlayerLab (server render)", () => {
  it("renders the real radio screen inside the venue shell plus the collapsible diagnostics", async () => {
    const manifest = await loadDemoManifest();
    const html = render(
      h(PathnameContext, {
        value: "/dev/player-lab",
        children: h(PlayerLab, { catalog: buildLabCatalog(manifest.notice, manifest.entries) }),
      }),
    );
    for (const text of ["Player lab", "Synthetic test audio", "Engine setup", "Fault injection", "Live snapshot", "Event log", "Removed genre"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("Next sign → 410");
    expect(html).toMatch(/<h1[^>]*id="station-name"[^>]*>EmeraldBar Radio<\/h1>/);
    expect(html).toContain(">Start Radio</button>");
    expect(html).toContain("You’re listening to EmeraldBar Radio.");
    expect(html).toContain('aria-label="Radio player"');
    expect(html).toContain('href="/dev/preview/radio/help"');
  });
});

describe("dev previews (server render)", () => {
  const preview = (state?: string) =>
    renderPage(
      RadioPreviewPage({ params: Promise.resolve({}), searchParams: Promise.resolve(state ? { state } : {}) }),
      "/dev/preview/radio",
    );

  it("defaults to the playing state of the design", async () => {
    const html = await preview();
    expect(html).toContain("Afterglow");
    expect(html).toContain("Frekvencija Sessions");
    expect(html).toContain("Slow Motion");
    expect(html).toContain("Station voice after 2 more songs");
    expect(html).toMatch(/>Playing</);
    expect(html).toContain('aria-label="Pause"');
    expect(html).toContain('aria-current="page"');
  });

  it("renders the blocked, buffering, network, session and empty states with their copy", async () => {
    expect(await preview("blocked")).toContain("Tap to resume your radio.");
    expect(await preview("buffering")).toContain("Buffering…");
    const network = await preview("network");
    expect(network).toContain("Connection lost");
    expect(network).toContain(">Retry</button>");
    const session = await preview("session");
    expect(tagAround(session, ">Log in again</a>", "a")).toContain('href="/login?error=session_expired&amp;next=%2Fradio"');
    const empty = await preview("empty");
    expect(empty).toContain("No tracks in this genre yet");
    expect(tagAround(empty, 'aria-label="Select Pop"')).toContain('aria-pressed="true"');
    expect(await preview("no-genres")).toContain("No music available yet.");
    expect(await preview("single-track")).toContain("only one track");
    expect(await preview("fixed-volume")).toContain("volume buttons");
  });

  it("falls back to the playing state for an unknown state", async () => {
    expect(await preview("nonsense")).toContain("Afterglow");
  });

  it("keeps the playing genre's action as a focusable status button, and every other card's Play button", async () => {
    const playing = await preview();
    const house = tagAround(playing, 'aria-label="House is playing"');
    expect(house).toContain('aria-disabled="true"');
    expect(playing).toContain('aria-label="Play Deep House"');
    expect(tagAround(await preview("loading"), 'aria-label="House is loading"')).toContain('aria-disabled="true"');
  });

  it("Skip is available during music only: unavailable, and explained, while the station voice plays", async () => {
    const music = await preview();
    expect(tagAround(music, 'aria-label="Skip"')).not.toContain(' aria-disabled="');
    expect(music).not.toContain(SKIP_MUSIC_ONLY_COPY);

    const voice = await preview("announcement");
    const skip = tagAround(voice, 'aria-label="Skip"');
    expect(skip).toContain('aria-disabled="true"');
    expect(skip).toContain(`title="${SKIP_MUSIC_ONLY_COPY}"`);
    expect(voice).toContain(`>${SKIP_MUSIC_ONLY_COPY}</p>`); // the hero says it where it can be seen
  });

  it("an expired session keeps the hero's control (aria-disabled) instead of removing it", async () => {
    const session = await preview("session");
    expect(tagAround(session, 'aria-label="Play"')).toContain('aria-disabled="true"');
  });

  it("renders the account and help previews without Supabase", async () => {
    const account = await renderPage(
      AccountPreviewPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }),
      "/dev/preview/radio/account",
    );
    expect(account).toContain("Venue details");
    expect(account).toContain('value="manager@emeraldbar.example"');
    const help = await renderPage(
      HelpPreviewPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ contact: "0" }) }),
      "/dev/preview/radio/help",
    );
    expect(help).toContain("How your radio works");
    expect(help).toContain("Ask your Frekvencija administrator");
  });
});
