/**
 * Server-render tests for the public website: section order and exact copy of screen 01, honest
 * example/station labelling, the genre collection, header variants, request access, privacy/terms.
 */
import { createElement as h, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureRedirect } from "../auth/auth-mocks";
import PublicLayout from "@/app/(public)/layout";
import HomePage from "@/app/(public)/page";
import PrivacyPage from "@/app/(public)/privacy/page";
import RequestAccessPage from "@/app/(public)/request-access/page";
import TermsPage from "@/app/(public)/terms/page";
import { GenreCollection } from "@/components/public/GenreCollection";
import { PublicHeader } from "@/components/public/PublicHeader";
import { RequestAccessResult } from "@/components/public/RequestAccessForm";
import type { PublicGenre, PublicSettingsResult } from "@/lib/data/public";

const mocks = vi.hoisted(() => ({
  loadPublicSettings: vi.fn(),
  getPublicViewer: vi.fn(),
}));

vi.mock("@/lib/data/public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/public")>()),
  loadPublicSettings: mocks.loadPublicSettings,
  getPublicViewer: mocks.getPublicViewer,
}));
vi.mock("next/navigation", async () => (await import("../auth/auth-mocks")).mockNavigation());

const render = (element: ReactElement) => renderToString(element);
const props = (searchParams: Record<string, string> = {}) => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve(searchParams),
});

function settings(overrides: Partial<Extract<PublicSettingsResult, { status: "ok" }>["settings"]> = {}): PublicSettingsResult {
  return {
    status: "ok",
    settings: { contactEmail: null, contactPhone: null, privacyPolicy: null, termsOfService: null, ...overrides },
  };
}

function genre(index: number, overrides: Partial<PublicGenre> = {}): PublicGenre {
  return {
    key: `g${index}`,
    slug: `genre-${index}`,
    name: `Genre ${index}`,
    description: `Description ${index}`,
    artworkUrl: `/brand/genres/default-0${(index % 8) + 1}.jpg`,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Setup mode: no Supabase, so the homepage uses the default genre list.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  mocks.loadPublicSettings.mockResolvedValue(settings());
  mocks.getPublicViewer.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("homepage", () => {
  it("renders the sections in the approved order", async () => {
    const html = render(await HomePage(props()));
    const order = [
      'aria-labelledby="hero-title"',
      "For cafés.",
      'id="how-it-works"',
      'id="genres"',
      "Make it sound like you.",
      'id="faq"',
      "Your space deserves its own station.",
    ].map((marker) => html.indexOf(marker));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("uses the exact hero copy with a single h1 and the two hero actions", async () => {
    const html = render(await HomePage(props()));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Your place\.[\s\S]*Your sound\.[\s\S]*Your radio\.[\s\S]*<\/h1>/);
    expect(html).toMatch(/text-accent-text">Your radio\./);
    expect(html).toContain("Radio for your business");
    expect(html).toContain("Music for your atmosphere.");
    expect(html).toContain("A station with your name.");
    expect(html).toContain('href="/request-access"');
    expect(html).toMatch(/href="#genres"[^>]*>Explore genres/);
  });

  it("labels the hero player as an example and has no playback control in it", async () => {
    const html = render(await HomePage(props()));
    expect(html).toContain("Example station");
    expect(html).toContain("EmeraldBar Radio");
    expect(html).toContain("You’re listening to EmeraldBar Radio.");
    const hero = html.slice(html.indexOf('aria-labelledby="hero-title"'), html.indexOf("For cafés."));
    expect(hero).not.toContain("<button");
    expect(hero).not.toMatch(/aria-label="[^"]*(Pause|Play)/);
    expect(hero).not.toContain("<audio");
  });

  it("lists who it is for and the three steps", async () => {
    const html = render(await HomePage(props()));
    for (const text of ["For cafés.", "For restaurants.", "For hotels.", "For bars."]) expect(html).toContain(text);
    expect(html).toContain("One login. Your own atmosphere.");
    for (const text of [
      "Choose a genre",
      "Find the right sound for your space.",
      "Press play",
      "Start your station in one click.",
      "Hear your name",
      "Your business name is announced on air.",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("shows the default genre collection with sign-in play links and no tracks", async () => {
    const html = render(await HomePage(props()));
    expect(html).toContain("A sound for every space.");
    for (const name of ["House", "Lounge", "Jazz", "Deep House", "Balkan Hits", "Chillout"]) {
      expect(html).toContain(`aria-label="Log in to play ${name}"`);
    }
    expect(html).toContain("Uplifting, rhythmic, timeless.");
    expect(html).toContain("Laid-back sounds for any time.");
    expect(html).not.toContain("Explore all genres");
    expect(html).not.toContain("<audio");
  });

  it("answers the FAQ exactly as approved, in native details elements (first one open)", async () => {
    const html = render(await HomePage(props()));
    expect(html).toContain("Frequently asked questions");
    expect(html).toContain("Choose another genre whenever you like.");
    expect(html).toContain("Your station can play approved recordings with your business name between songs.");
    expect(html).toContain(
      "Use a supported browser on a device connected to your venue’s sound system and an internet connection.",
    );
    expect(html.match(/<details/g)).toHaveLength(3);
    expect(html).toMatch(/<details open=""/);
  });

  it("makes no invented commercial claims", async () => {
    const html = render(await HomePage(props())).toLowerCase();
    for (const word of ["free trial", "pricing", "per month", "testimonial", "licensed", "customers", "live broadcast"]) {
      expect(html).not.toContain(word);
    }
  });

  it("forwards an email-link callback that landed on the root to /auth/confirm", async () => {
    expect(await captureRedirect(() => HomePage(props({ code: "34e770dd-9ff9-416c-87fa-43b31d7ef225", utm: "x" })))).toBe(
      "/auth/confirm?code=34e770dd-9ff9-416c-87fa-43b31d7ef225",
    );
    expect(await captureRedirect(() => HomePage(props({ error: "access_denied", error_code: "otp_expired" })))).toBe(
      "/auth/confirm?error=access_denied&error_code=otp_expired",
    );
  });
});

describe("genre collection", () => {
  it("expands to the rest of the genres with an accessible disclosure button", () => {
    const genres = Array.from({ length: 8 }, (_, index) => genre(index + 1));
    const html = render(h(GenreCollection, { genres }));
    const button = html.match(/<button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"[^>]*>/);
    expect(button).not.toBeNull();
    expect(html).toContain("Explore all genres");
    const controlled = button?.[1] ?? "";
    expect(html).toMatch(new RegExp(`<ul id="${controlled.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" hidden=""`));
    expect(html).toContain("Genre 8");
  });

  it("shows owner covers as-is (signed URLs are not sent through the image optimiser)", () => {
    const cover = "https://abc.supabase.co/storage/v1/object/sign/genre-covers/g1/a.webp?token=t";
    const html = render(h(GenreCollection, { genres: [genre(1, { artworkUrl: cover })] }));
    expect(html).toContain(`src="${cover.replace(/&/g, "&amp;")}"`);
    expect(html).not.toContain("/_next/image?url=https");
  });
});

describe("public header and layout", () => {
  it("offers Log in and Request access to visitors, with section links", () => {
    const html = render(h(PublicHeader, { viewerRole: null }));
    expect(html).toMatch(/href="\/login"[^>]*>Log in/);
    expect(html).toMatch(/href="\/request-access"[^>]*>Request access/);
    expect(html).toContain('href="/#how-it-works"');
    expect(html).toContain('href="/#genres"');
    expect(html).toContain('aria-label="Frekvencija home"');
  });

  it("replaces Log in with the signed-in user's own area", () => {
    const business = render(h(PublicHeader, { viewerRole: "business_user" }));
    expect(business).toMatch(/href="\/radio"[^>]*>Open radio/);
    expect(business).not.toContain(">Log in<");
    const admin = render(h(PublicHeader, { viewerRole: "platform_admin" }));
    expect(admin).toMatch(/href="\/admin"[^>]*>Admin workspace/);
  });

  it("wraps pages in the skip link, main landmark and footer (Contact, Privacy, Terms, domain)", async () => {
    mocks.getPublicViewer.mockResolvedValue({ role: "business_user" });
    const html = render(await PublicLayout({ params: Promise.resolve({}), children: h("p", null, "content") }));
    expect(html.indexOf('href="#main-content"')).toBeLessThan(html.indexOf("<header"));
    expect(html).toMatch(/<main[^>]*id="main-content"/);
    expect(html).toContain("Open radio");
    expect(html).toMatch(/href="\/request-access"[^>]*>Contact/);
    expect(html).toMatch(/href="\/privacy"[^>]*>Privacy/);
    expect(html).toMatch(/href="\/terms"[^>]*>Terms/);
    expect(html).toContain("frekvencija.online");
  });
});

describe("request access page", () => {
  it("renders the labelled form with the business types, optional fields and a hidden anti-spam field", async () => {
    const html = render(await RequestAccessPage());
    expect(html).toMatch(/<h1[^>]*>Get your own station<\/h1>/);
    for (const label of ["Business name", "Business type", "Contact name", "Email address", "Phone", "Message"]) {
      expect(html).toMatch(new RegExp(`<label[^>]*for="[^"]+"[^>]*>${label}`));
    }
    for (const option of ["Café", "Restaurant", "Hotel", "Bar", "Other"]) expect(html).toContain(`>${option}</option>`);
    expect(html.match(/\(optional\)/g)).toHaveLength(2);
    expect(html).toMatch(/autocomplete="organization"/i);
    expect(html).toMatch(/autocomplete="email"/i);
    expect(html).toMatch(/<div aria-hidden="true"[^>]*><label for="frk_hp"/);
    expect(html).toContain("Send request");
    expect(html).toContain("What happens next");
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/privacy"');
  });

  it("shows a real submission result with what happens next", () => {
    const sent = render(
      h(RequestAccessResult, {
        state: {
          ok: true,
          outcome: "sent",
          message: "Thanks — we’ll be in touch.",
          fieldErrors: {},
          values: { businessName: "EmeraldBar", businessType: "bar", contactName: "Ana", email: "ana@example.com", phone: "", message: "" },
        },
        contactEmail: "hello@frekvencija.online",
      }),
    );
    expect(sent).toContain("Thanks — we’ll be in touch");
    expect(sent).toContain("for EmeraldBar");
    expect(sent).toContain("No account is created automatically.");
    expect(sent).toContain("We reply to ana@example.com");
    expect(sent).toContain('href="mailto:hello@frekvencija.online"');

    const duplicate = render(
      h(RequestAccessResult, {
        state: { ok: true, outcome: "duplicate", message: null, fieldErrors: {}, values: { businessName: "", businessType: "", contactName: "", email: "ana@example.com", phone: "", message: "" } },
      }),
    );
    expect(duplicate).toContain("We already have your request");
    expect(duplicate).toContain("no need to send another one");
  });
});

describe("privacy and terms", () => {
  it("renders the owner's text as escaped plain-text paragraphs", async () => {
    mocks.loadPublicSettings.mockResolvedValue(
      settings({ privacyPolicy: "We keep it short.\n\n<script>alert(1)</script> is shown as text.\nSecond line." }),
    );
    const html = render(await PrivacyPage());
    expect(html).toMatch(/<h1[^>]*>Privacy policy<\/h1>/);
    expect(html).toContain("<p class=\"whitespace-pre-line");
    expect(html).toContain("We keep it short.");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; is shown as text.");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("says honestly when a policy has not been published, with a contact path", async () => {
    const privacy = render(await PrivacyPage());
    expect(privacy).toContain("Our privacy policy hasn’t been published yet.");
    expect(privacy).toMatch(/href="\/request-access"[^>]*>[\s\S]*Contact us/);

    mocks.loadPublicSettings.mockResolvedValue(settings({ contactEmail: "hello@example.com" }));
    const terms = render(await TermsPage());
    expect(terms).toMatch(/<h1[^>]*>Terms of service<\/h1>/);
    expect(terms).toContain("Our terms of service haven’t been published yet.");
    expect(terms).toContain('href="mailto:hello@example.com"');
  });

  it("distinguishes a failed load from an unpublished policy", async () => {
    mocks.loadPublicSettings.mockResolvedValue({ status: "unavailable" });
    const html = render(await TermsPage());
    expect(html).toContain("Our terms of service couldn’t be loaded");
    expect(html).not.toContain("published yet");
  });
});
