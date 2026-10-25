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
  /** `compact` for the header, `full` (native names) for the menu and footer. */
  variant?: "compact" | "full";
  /** Display classes for the nav element (default `inline-flex`; the header hides it on phones). */
  className?: string;
}

/**
 * MK / EN switch. Plain links to /lang/<locale> (a route handler that sets the cookie and redirects
 * back to the current page), so it works without JavaScript and never changes the URL structure.
 */
export function LanguageSwitch({ locale, label, switchTo, variant = "compact", className }: LanguageSwitchProps) {
  const pathname = usePathname() || "/";
  return (
    <nav aria-label={label} className={className ?? "inline-flex"}>
      <ul
        className={cn(
          "flex items-center",
          variant === "compact" ? "h-10 rounded-full border border-border bg-surface p-0.5" : "gap-2",
        )}
      >
        {LOCALES.map((candidate) => {
          const current = candidate === locale;
          const names = LOCALE_NAMES[candidate];
          return (
            <li key={candidate}>
              <a
                href={`/lang/${candidate}?next=${encodeURIComponent(pathname)}`}
                hrefLang={candidate}
                lang={candidate}
                aria-current={current ? "true" : undefined}
                aria-label={current ? undefined : fill(switchTo, { language: names.long })}
                className={cn(
                  "inline-flex items-center justify-center font-semibold tracking-wide transition-colors",
                  variant === "compact"
                    ? "h-9 min-w-11 rounded-full px-3 text-xs uppercase"
                    : "h-11 rounded-full border px-4 text-sm",
                  current
                    ? variant === "compact"
                      ? "bg-fg text-canvas"
                      : "border-fg bg-fg text-canvas"
                    : variant === "compact"
                      ? "text-fg-muted hover:bg-surface-2 hover:text-fg"
                      : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {variant === "compact" ? names.short : names.long}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
