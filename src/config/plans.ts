/**
 * Monthly packages. The amounts are PROPOSED package data (excluding VAT where applicable) and stay
 * off the public website until `PRICING_PUBLISHED` is true: until then the Plans section shows a
 * "find the right plan" invitation with a request-pricing action instead.
 */
import type { Locale } from "@/lib/i18n/locale";

export type PlanKey = "basic" | "standard" | "premium";

export interface PlanConfig {
  key: PlanKey;
  /** Monthly price in `PLAN_CURRENCY`, excluding VAT where applicable. */
  monthlyPrice: number;
  name: Record<Locale, string>;
  features: Record<Locale, readonly string[]>;
}

/** Flip to true once the owner approves the prices for publication. */
export const PRICING_PUBLISHED = false;

export const PLAN_CURRENCY = "MKD";

export const PLANS: readonly PlanConfig[] = [
  {
    key: "basic",
    monthlyPrice: 1490,
    name: { mk: "Основен", en: "Basic" },
    features: {
      mk: ["Една најава на станицата со името на локалот", "Стандардна поддршка"],
      en: ["One station announcement using the venue’s name", "Standard support"],
    },
  },
  {
    key: "standard",
    monthlyPrice: 2490,
    name: { mk: "Стандард", en: "Standard" },
    features: {
      mk: ["Три различни најави", "Една нова или изменета промотивна порака месечно"],
      en: ["Three different announcements", "One new or edited promotional message monthly"],
    },
  },
  {
    key: "premium",
    monthlyPrice: 2890,
    name: { mk: "Премиум", en: "Premium" },
    features: {
      mk: ["Пет најави", "До четири промотивни пораки или измени месечно", "Приоритетна поддршка во работно време"],
      en: ["Five announcements", "Up to four promotional messages or edits monthly", "Priority support during working hours"],
    },
  },
];

/** Formats a monthly amount for display, e.g. "1.490 MKD" (mk) or "1,490 MKD" (en). */
export function formatPlanPrice(amount: number, locale: Locale): string {
  const formatted = new Intl.NumberFormat(locale === "mk" ? "mk-MK" : "en-US", { maximumFractionDigits: 0 }).format(amount);
  return `${formatted} ${PLAN_CURRENCY}`;
}

/** The plans to show publicly: none while pricing is unpublished. */
export function publishedPlans(): readonly PlanConfig[] {
  return PRICING_PUBLISHED ? PLANS : [];
}
