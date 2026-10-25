/**
 * Server-render tests for the public website v3 (night broadcast): chapter order, the Macedonian default and
 * the English version, the hero and intro markup, the numbers, honest pricing, the trial form, header and
 * footer, privacy/terms. Motion runs only in the browser, so the server output is the final readable state.
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
// next/font needs the Next.js compiler; the layout only uses the class names.
vi.mock("@/app/(public)/_lib/fonts", () => ({
  display: { variable: "font-display-test", className: "font-display-test" },
  serif: { variable: "font-serif-test", className: "font-serif-test" },
}));
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

function header(role: "platform_admin" | "business_user" | null, locale: Locale = "mk") {
  const copy = getSiteCopy(locale);
  const account =
    role === "platform_admin"
      ? { href: "/admin" as const, label: copy.nav.adminWorkspace }
      : role === "business_user"
        ? { href: "/radio" as const, label: copy.nav.openRadio }
        : { href: "/login" as const, label: copy.nav.logIn };
  return render(h(SiteHeader, { locale, nav: copy.nav, common: copy.common, account, signedIn: role !== null }));
}

/** Text content of the rendered HTML (tags removed, entities for quotes decoded). */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

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
  it("tells the story in chapters, in order", async () => {
    const html = render(await HomePage(props()));
    const order = ["top", "manifesto", "numbers", "how-it-works", "features", "venues", "announcements", "plans", "faq", "trial"].map((id) =>
      html.indexOf(`id="${id}"`),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("opens with a single h1 promise, the on-air line and both actions", async () => {
    const html = render(await HomePage(props()));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text(html)).toContain("Вашиот локал.Вашиот звук.Вашето радио.");
    expect(html).toContain("Во етер во 140+ локали");
    expect(html).toContain(mk.hero.lead);
    expect(html).toMatch(/href="\/#trial"[^>]*>[\s\S]*?Пробај 3 дена бесплатно/);
    expect(html).toMatch(/href="\/#how-it-works"[^>]*>[\s\S]*?Види како функционира/);
  });

  it("renders the intro overlay as decoration only, hidden unless the boot script asks for it", async () => {
    const html = render(await HomePage(props()));
    const overlay = html.match(/<div[^>]*data-intro=""[^>]*>/)?.[0] ?? "";
    expect(overlay).toContain('aria-hidden="true"');
    expect(overlay).not.toMatch(/class="[^"]*\bflex\b(?!-)/);
    expect(html).toContain(mk.intro.tuning);
  });

  it("marks the elements the motion layer reveals, and keeps the on-air card decorative", async () => {
    const html = render(await HomePage(props()));
    expect((html.match(/data-anim=""/g) ?? []).length).toBeGreaterThan(20);
    expect(html).toMatch(/<div aria-hidden="true" data-hero-card=""/);
    expect(html).not.toContain("<audio");
  });

  it("shows the headline numbers in their final form", async () => {
    const html = render(await HomePage(props()));
    for (const value of ["140+", "18", "52.000+", "0"]) expect(html).toContain(`>${value}</span>`);
    for (const label of Object.values(mk.stats.items)) expect(html).toContain(label);
  });

  it("lists the catalogue genres for screen readers and in the moving rows", async () => {
    const html = render(await HomePage(props()));
    expect(html).toMatch(new RegExp(`<section aria-label="${mk.marquee.label}"`));
    for (const name of ["House", "Lounge", "Jazz", "Deep House", "Balkan Hits", "Chillout"]) expect(html).toContain(`<li>${name}</li>`);
  });

  it("lets a visitor preview their station and shows the example announcements", async () => {
    const html = render(await HomePage(props()));
    expect(html).toContain(mk.announcements.title);
    expect(html).toContain(mk.announcements.note);
    expect(html).toContain("EmeraldCaffe Radio");
    expect(text(html)).toContain("„Го слушате EmeraldCaffe Radio.“");
    expect(text(html)).toContain("два коктели по цена на еден");
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
  });

  it("answers the FAQ in native details rows, one open at a time", async () => {
    const html = render(await HomePage(props()));
    const rows = html.match(/<details[^>]*>/g) ?? [];
    expect(rows).toHaveLength(mk.faq.items.length);
    expect(rows.every((row) => row.includes('name="faq"'))).toBe(true);
    expect(rows[0]).toContain('open=""');
    expect(html).toContain(mk.faq.items[5].answer);
  });

  it("renders the trial form with every field, the recommendation option, the anti-spam field and the language", async () => {
    const html = render(await HomePage(props()));
    const form = mk.trial.form;
    for (const label of [form.venueName, form.venueType, form.city, form.contactName, form.email, form.phone, form.preferredGenre, form.message]) {
      expect(html).toMatch(new RegExp(`<label[^>]*for="[^"]+"[^>]*>${label.replace(/[?]/g, "\\?")}`));
    }
    expect(html).toContain(`<option value="recommendation">${form.recommendationOption}</option>`);
    expect(html).toContain('<option value="house">House</option>');
    expect(html).toContain(`<option value="cafe">${form.venueTypes.cafe}</option>`);
    expect(html).toContain(`<option value="other">${form.otherType}</option>`);
    expect(html).toMatch(/<input type="hidden" name="locale" value="mk"/);
    expect(html).toMatch(/<div aria-hidden="true"[^>]*><label for="frk_hp"/);
    expect(html).toContain(form.submit);
    expect(html).toContain(mk.trial.activationNote);
    expect(text(html)).toContain("(по избор)");
    expect(html).toContain('href="/privacy"');
  });

  it("invents no testimonials, awards, partners or discounts", async () => {
    mocks.getLocale.mockResolvedValue("en");
    const html = render(await HomePage(props())).toLowerCase();
    for (const word of ["testimonial", "award", "partner", "most popular", "discount", "guarantee", "licensed"]) {
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
    expect(text(html)).toContain("Your place.Your sound.Your radio.");
    expect(html).toContain("On air in 140+ venues");
    expect(html).toContain(">52,000+</span>");
    expect(html).toContain(en.manifesto.label);
    expect(html).toContain(en.trial.form.submit);
    expect(html).toContain(en.faq.items[0].question);
    expect(text(html)).toContain("“You’re listening to EmeraldCaffe Radio.”");
    expect(html).toMatch(/<input type="hidden" name="locale" value="en"/);
    expect(html).not.toContain("Вашиот локал.");
  });
});

describe("header", () => {
  it("offers the chapters, MK / EN, Log in and the trial button to visitors", () => {
    const html = header(null);
    for (const id of ["how-it-works", "features", "venues", "plans", "faq"]) expect(html).toContain(`href="/#${id}"`);
    expect(html).toMatch(/href="\/login"[^>]*>Најава/);
    expect(html).toMatch(/href="\/#trial"/);
    expect(html).toContain(mk.nav.trialCta);
    expect(html).toContain(`aria-label="${mk.common.brandHome}"`);
    expect(html).toContain("frekvencija-logo-light.png");
    const mkLink = html.match(/<a[^>]*href="\/lang\/mk\?next=%2F"[^>]*>/)?.[0] ?? "";
    const enLink = html.match(/<a[^>]*href="\/lang\/en\?next=%2F"[^>]*>/)?.[0] ?? "";
    expect(mkLink).toContain('aria-current="true"');
    expect(enLink).toContain('aria-label="Префрли на English"');
    expect(html).toMatch(/aria-label="Отвори го менито"[^>]*aria-haspopup="dialog"/);
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
  it("wraps pages in the night theme with both fonts, the skip link, main landmark and footer", async () => {
    mocks.getPublicViewer.mockResolvedValue({ role: "business_user" });
    mocks.loadPublicSettings.mockResolvedValue(settings({ contactEmail: "hello@frekvencija.online" }));
    const html = render(await PublicLayout({ params: Promise.resolve({}), children: h("p", null, "content") }));
    expect(html).toMatch(/<div lang="mk" class="theme-night[^"]*font-display-test font-serif-test/);
    expect(html.indexOf('href="#main-content"')).toBeLessThan(html.indexOf("<header"));
    expect(html).toMatch(/<main[^>]*id="main-content"/);
    expect(html).toContain("content");
    expect(html).toContain(mk.nav.openRadio);
    expect(html).toMatch(/href="\/privacy"[^>]*>Приватност/);
    expect(html).toMatch(/href="\/terms"[^>]*>Услови/);
    expect(html).toContain('href="mailto:hello@frekvencija.online"');
    expect(html).toContain("frekvencija.online");
    expect(html).toContain(mk.footer.ctaTitle);
    expect(html).toContain(mk.footer.credits);
  });

  it("switches the wrapper language and labels to English", async () => {
    mocks.getLocale.mockResolvedValue("en");
    const html = render(await PublicLayout({ params: Promise.resolve({}), children: null }));
    expect(html).toMatch(/<div lang="en" class="theme-night/);
    expect(html).toContain("How it works");
    expect(html).toContain(en.footer.tagline);
  });
});

describe("trial request page and result", () => {
  it("renders the standalone trial page with the form and a sign-in link", async () => {
    const html = render(await RequestAccessPage());
    expect(html).toMatch(/<h1[^>]*id="trial-title"[^>]*>/);
    expect(html).toContain(mk.trialPage.title);
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
