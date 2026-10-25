/**
 * Server-render tests for the public website v2 (ivory / cobalt): section order, the Macedonian
 * default and the English version, honest demo and pricing states, the trial form, header and
 * footer variants, privacy/terms.
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
import { RadioConsole } from "@/components/public/site/RadioConsole";
import { SiteHeader } from "@/components/public/site/SiteHeader";
import { TrialRequestResult } from "@/components/public/site/TrialRequestForm";
import { PLANS } from "@/config/plans";
import { getSiteCopy } from "@/content/site";
import type { PublicSettingsResult } from "@/lib/data/public";
import type { Locale } from "@/lib/i18n/locale";

const mocks = vi.hoisted(() => ({
  loadPublicSettings: vi.fn(),
  getPublicViewer: vi.fn(),
  getLocale: vi.fn(),
}));

vi.mock("@/lib/data/public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/public")>()),
  loadPublicSettings: mocks.loadPublicSettings,
  getPublicViewer: mocks.getPublicViewer,
}));
vi.mock("@/lib/i18n/server", () => ({ getLocale: mocks.getLocale }));
// next/font needs the Next.js compiler; the layout only uses the class name.
vi.mock("@/app/(public)/_lib/fonts", () => ({ display: { variable: "font-display-test", className: "font-display-test" } }));
vi.mock("next/navigation", async () => ({ ...(await (await import("../auth/auth-mocks")).mockNavigation()), usePathname: () => "/" }));

const render = (element: ReactElement) => renderToString(element);
const props = (searchParams: Record<string, string> = {}) => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve(searchParams),
});
const mk = getSiteCopy("mk");
const en = getSiteCopy("en");

function settings(overrides: Partial<Extract<PublicSettingsResult, { status: "ok" }>["settings"]> = {}): PublicSettingsResult {
  return {
    status: "ok",
    settings: { contactEmail: null, contactPhone: null, privacyPolicy: null, termsOfService: null, ...overrides },
  };
}

const accountFor = (role: "platform_admin" | "business_user" | null, locale: Locale) => {
  const { nav } = getSiteCopy(locale);
  return role === "platform_admin"
    ? { href: "/admin" as const, label: nav.adminWorkspace }
    : role === "business_user"
      ? { href: "/radio" as const, label: nav.openRadio }
      : { href: "/login" as const, label: nav.logIn };
};

function header(role: "platform_admin" | "business_user" | null, locale: Locale = "mk") {
  const copy = getSiteCopy(locale);
  return render(h(SiteHeader, { locale, nav: copy.nav, common: copy.common, account: accountFor(role, locale), signedIn: role !== null }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Setup mode: no Supabase, so the homepage uses the default genre list.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  mocks.loadPublicSettings.mockResolvedValue(settings());
  mocks.getPublicViewer.mockResolvedValue(null);
  mocks.getLocale.mockResolvedValue("mk");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("homepage (Macedonian by default)", () => {
  it("renders the sections in order", async () => {
    const html = render(await HomePage(props()));
    const order = [
      'aria-labelledby="hero-title"',
      'id="listen"',
      'id="benefits"',
      'id="venues"',
      'id="genres"',
      'id="announcements"',
      'id="how-it-works"',
      'id="trial"',
      'id="plans"',
      'id="faq"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("uses the Macedonian hero copy with a single h1 and the two hero actions", async () => {
    const html = render(await HomePage(props()));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Атмосферата почнува[\s\S]*со вистинскиот звук\.[\s\S]*<\/h1>/);
    expect(html).toContain(mk.hero.lead);
    expect(html).toMatch(/href="\/#trial"[^>]*>[\s\S]*?Побарај 3 дена бесплатно/);
    expect(html).toMatch(/href="\/#listen"[^>]*>[\s\S]*?Слушни пример/);
  });

  it("shows the console as an example with an honest 'demo coming soon' state and no autoplaying audio", async () => {
    const html = render(await HomePage(props()));
    expect(html).toContain(mk.console.eyebrow);
    expect(html).toContain("EmeraldCaffe Radio");
    expect(html).toContain(mk.console.unavailableTitle);
    expect(html).toContain(mk.console.unavailableBody);
    expect(html).not.toContain("<audio");
    const play = html.match(/<button[^>]*aria-label="Пушти го примерот"[^>]*>/)?.[0] ?? "";
    expect(play).toContain("disabled");
  });

  it("plays nothing and animates nothing without a clip (console in isolation)", () => {
    const html = render(h(RadioConsole, { copy: mk.console, common: mk.common, clip: null, announcementClip: null }));
    expect(html).not.toContain("<audio");
    expect(html).not.toContain("animate-eq");
    expect((html.match(/console-bar/g) ?? []).length).toBeGreaterThan(20);
  });

  it("lets a visitor preview their station name and shows the example announcements as examples", async () => {
    const html = render(await HomePage(props()));
    expect(html).toContain(mk.personalizer.title);
    expect(html).toContain(mk.personalizer.note);
    expect(html).toContain("Го слушате <strong");
    expect(html).toContain("Пиња колада за 250 денари");
    expect(html).toContain(mk.personalizer.exampleUnavailable);
  });

  it("lists the catalogue genres with the website's own atmosphere lines", async () => {
    const html = render(await HomePage(props()));
    for (const name of ["House", "Lounge", "Jazz", "Deep House", "Balkan Hits", "Chillout"]) expect(html).toContain(name);
    expect(html).toContain(mk.genres.descriptions.house);
    expect(html).toContain(mk.genres.descriptions["balkan-hits"]);
    expect(html).toContain(mk.genres.sourceNote);
  });

  it("keeps the draft prices off the page while pricing is unpublished", async () => {
    const html = render(await HomePage(props()));
    expect(html).toContain(mk.plans.unpublishedTitle);
    expect(html).toMatch(/href="\/#trial"[^>]*>[\s\S]*?Побарај понуда/);
    for (const plan of PLANS) {
      expect(html).not.toContain(String(plan.monthlyPrice));
      expect(html).not.toContain(plan.name.mk);
    }
    expect(html).not.toContain("MKD");
    for (const included of mk.plans.includes) expect(html).toContain(included);
  });

  it("explains the four steps and when the three days start", async () => {
    const html = render(await HomePage(props()));
    for (const step of mk.howItWorks.steps) expect(html).toContain(step.title);
    expect(html).toContain(mk.howItWorks.note);
    expect(html).toContain(mk.announcements.privacyNote);
  });

  it("answers the FAQ in native details elements (first one open)", async () => {
    const html = render(await HomePage(props()));
    expect(html).toContain(mk.faq.title);
    expect(html.match(/<details/g)).toHaveLength(mk.faq.items.length);
    expect(html).toMatch(/<details[^>]*open=""/);
    expect(html).toContain(mk.faq.items[5].answer);
  });

  it("renders the trial form with every field, the recommendation option, the anti-spam field and the language", async () => {
    const html = render(await HomePage(props()));
    const form = mk.trial.form;
    for (const label of [form.venueName, form.venueType, form.city, form.contactName, form.email, form.phone, form.preferredGenre, form.message]) {
      expect(html).toMatch(new RegExp(`<label[^>]*for="[^"]+"[^>]*>${label}`));
    }
    expect(html).toContain(`<option value="recommendation">${form.recommendationOption}</option>`);
    expect(html).toContain('<option value="house">House</option>');
    expect(html).toContain('<option value="cafe">');
    expect(html).toMatch(/<input type="hidden" name="locale" value="mk"/);
    expect(html).toMatch(/<div aria-hidden="true"[^>]*><label for="frk_hp"/);
    expect(html).toContain(form.submit);
    expect(html).toContain(mk.trial.activationNote);
    expect(html).toContain('href="/privacy"');
  });

  it("makes no invented commercial claims", async () => {
    mocks.getLocale.mockResolvedValue("en");
    const html = render(await HomePage(props())).toLowerCase();
    for (const word of ["testimonial", "customers", "award", "partner", "most popular", "discount", "guarantee", "licensed"]) {
      expect(html, word).not.toContain(word);
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

describe("homepage in English", () => {
  it("renders the complete English version when the visitor chose it", async () => {
    mocks.getLocale.mockResolvedValue("en");
    const html = render(await HomePage(props()));
    expect(html).toMatch(/<h1[^>]*>[\s\S]*The atmosphere begins[\s\S]*with the right sound\.[\s\S]*<\/h1>/);
    expect(html).toContain(en.hero.lead);
    expect(html).toContain("Request a 3-Day Free Trial");
    expect(html).toContain(en.personalizer.title);
    expect(html).toContain(en.trial.form.submit);
    expect(html).toContain(en.faq.items[0].question);
    expect(html).toMatch(/<input type="hidden" name="locale" value="en"/);
    expect(html).not.toContain("Атмосферата почнува");
  });
});

describe("header", () => {
  it("offers the section links, MK / EN, Log in and the trial button to visitors", () => {
    const html = header(null);
    for (const id of ["how-it-works", "listen", "venues", "plans", "faq"]) expect(html).toContain(`href="/#${id}"`);
    expect(html).toMatch(/href="\/login"[^>]*>Најава/);
    expect(html).toMatch(/href="\/#trial"/);
    expect(html).toContain(mk.nav.trialCta);
    expect(html).toContain(`aria-label="${mk.common.brandHome}"`);
    expect(html).toContain("frekvencija-logo-cobalt.png");
    const mkSwitch = html.match(/<a[^>]*href="\/lang\/mk\?next=%2F"[^>]*>/)?.[0] ?? "";
    const enSwitch = html.match(/<a[^>]*href="\/lang\/en\?next=%2F"[^>]*>/)?.[0] ?? "";
    expect(mkSwitch).toContain('aria-current="true"');
    expect(enSwitch).toContain("English");
    expect(html).toMatch(/aria-label="Отвори го менито"[^>]*aria-haspopup="dialog"|aria-haspopup="dialog"[^>]*aria-label="Отвори го менито"/);
  });

  it("replaces Log in with the signed-in user's own area", () => {
    const business = header("business_user");
    expect(business).toMatch(/href="\/radio"[^>]*>Отвори го радиото/);
    expect(business).not.toContain(">Најава<");
    const admin = header("platform_admin", "en");
    expect(admin).toMatch(/href="\/admin"[^>]*>Admin workspace/);
  });
});

describe("public layout", () => {
  it("wraps pages in the ivory theme, skip link, main landmark and footer", async () => {
    mocks.getPublicViewer.mockResolvedValue({ role: "business_user" });
    mocks.loadPublicSettings.mockResolvedValue(settings({ contactEmail: "hello@frekvencija.online" }));
    const html = render(await PublicLayout({ params: Promise.resolve({}), children: h("p", null, "content") }));
    expect(html).toMatch(/<div lang="mk" class="theme-public[^"]*font-display-test/);
    expect(html.indexOf('href="#main-content"')).toBeLessThan(html.indexOf("<header"));
    expect(html).toMatch(/<main[^>]*id="main-content"/);
    expect(html).toContain("content");
    expect(html).toContain(mk.nav.openRadio);
    expect(html).toMatch(/href="\/privacy"[^>]*>Приватност/);
    expect(html).toMatch(/href="\/terms"[^>]*>Услови/);
    expect(html).toContain('href="mailto:hello@frekvencija.online"');
    expect(html).toContain("frekvencija.online");
    expect(html).toContain(mk.footer.tagline);
  });

  it("switches the wrapper language and header labels to English", async () => {
    mocks.getLocale.mockResolvedValue("en");
    const html = render(await PublicLayout({ params: Promise.resolve({}), children: null }));
    expect(html).toMatch(/<div lang="en" class="theme-public/);
    expect(html).toContain("How It Works");
    expect(html).toContain(en.footer.tagline);
  });
});

describe("trial request page and result", () => {
  it("renders the standalone trial page with the form and a sign-in link", async () => {
    const html = render(await RequestAccessPage());
    expect(html).toMatch(new RegExp(`<h1[^>]*>${mk.trialPage.title}</h1>`));
    expect(html).toContain(mk.trial.form.submit);
    expect(html).toMatch(/href="\/login"[^>]*>Најавете се/);
  });

  it("shows the real submission result with what happens next", () => {
    const sent = render(
      h(TrialRequestResult, {
        state: { ok: true, outcome: "sent", message: mk.trial.messages.sent, fieldErrors: {} },
        copy: mk.trial,
        contactEmail: "hello@frekvencija.online",
      }),
    );
    expect(sent).toContain(mk.trial.successTitle);
    expect(sent).toContain(mk.trial.successBody);
    expect(sent).toContain(mk.trial.nextSteps[2]);
    expect(sent).toContain('href="mailto:hello@frekvencija.online"');

    const duplicate = render(h(TrialRequestResult, { state: { ok: true, outcome: "duplicate", message: null, fieldErrors: {} }, copy: en.trial }));
    expect(duplicate).toContain(en.trial.duplicateTitle);
    expect(duplicate).toContain("no need to send another one");
  });
});

describe("privacy and terms", () => {
  it("renders the owner's text as escaped plain-text paragraphs", async () => {
    mocks.loadPublicSettings.mockResolvedValue(
      settings({ privacyPolicy: "We keep it short.\n\n<script>alert(1)</script> is shown as text.\nSecond line." }),
    );
    const html = render(await PrivacyPage());
    expect(html).toMatch(/<h1[^>]*>Политика за приватност<\/h1>/);
    expect(html).toContain('<p class="whitespace-pre-line');
    expect(html).toContain("We keep it short.");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; is shown as text.");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("says honestly when a policy has not been published, with a contact path", async () => {
    const privacy = render(await PrivacyPage());
    expect(privacy).toContain("Текстот на политиката за приватност сè уште не е објавен.");
    expect(privacy).toMatch(/href="\/#trial"[^>]*>[\s\S]*Контактирајте нè/);

    mocks.getLocale.mockResolvedValue("en");
    mocks.loadPublicSettings.mockResolvedValue(settings({ contactEmail: "hello@example.com" }));
    const terms = render(await TermsPage());
    expect(terms).toMatch(/<h1[^>]*>Terms of service<\/h1>/);
    expect(terms).toContain("This page isn’t published yet: our terms of service will appear here.");
    expect(terms).toContain('href="mailto:hello@example.com"');
  });

  it("distinguishes a failed load from an unpublished policy", async () => {
    mocks.loadPublicSettings.mockResolvedValue({ status: "unavailable" });
    const html = render(await TermsPage());
    expect(html).toContain(mk.policy.unavailableTitle);
    expect(html).not.toContain("не е објавен");
  });
});
