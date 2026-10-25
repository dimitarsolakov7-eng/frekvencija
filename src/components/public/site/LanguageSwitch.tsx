"use client";

import { usePathname } from "next/navigation";
import { LOCALES, LOCALE_NAMES, fill, type Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils/cn";

export interface LanguageSwitchProps {
  locale: Locale;
  /** Accessible name of the group, e.g. "Јазик". */
  label: string;
  /** `{language}` template for each link's accessible name, e.g. "Префрли на {language}". */
  switchTo: string;
  /** `compact` ("MK / EN") for the header, `full` (native names) for the menu and footer. */
  variant?: "compact" | "full";
  /** Display classes of the nav element (default `inline-flex`). */
  className?: string;
}

/**
 * MK / EN switch: plain links to /lang/<locale>, a route handler that remembers the choice in a cookie
 * and returns to the current page — so it works without JavaScript and never changes the URLs.
 */
export function LanguageSwitch({ locale, label, switchTo, variant = "compact", className }: LanguageSwitchProps) {
  const pathname = usePathname() || "/";
  const compact = variant === "compact";
  return (
    <nav aria-label={label} className={className ?? "inline-flex"}>
      <ul className={cn("flex items-center", compact ? "label-mono gap-0.5" : "gap-2")}>
        {LOCALES.map((candidate, index) => {
          const current = candidate === locale;
          const names = LOCALE_NAMES[candidate];
          return (
            <li key={candidate} className="flex items-center gap-0.5">
              {compact && index > 0 && (
                <span aria-hidden="true" className="text-fg-subtle">
                  /
                </span>
              )}
              <a
                href={`/lang/${candidate}?next=${encodeURIComponent(pathname)}`}
                hrefLang={candidate}
                lang={candidate}
                aria-current={current ? "true" : undefined}
                aria-label={current ? undefined : fill(switchTo, { language: names.long })}
                className={cn(
                  "inline-flex h-11 items-center justify-center rounded-full transition-colors",
                  compact ? "min-w-9 px-1.5" : "border px-5 text-sm font-medium",
                  compact
                    ? current
                      ? "text-fg"
                      : "text-fg-subtle hover:text-fg"
                    : current
                      ? "border-fg bg-fg text-canvas"
                      : "border-border-strong text-fg-muted hover:border-fg/50 hover:text-fg",
                )}
              >
                {compact ? names.short : names.long}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
