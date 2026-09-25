import { Mail, Phone } from "lucide-react";
import { PLATFORM_NAME } from "@/config/platform";
import type { SupportContact } from "@/lib/api/contracts";
import { cn } from "@/lib/utils/cn";

/** Digits and a leading "+" only, for a tel: link (the visible text keeps the owner's formatting). */
export function telHref(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

export function hasSupportContact(support: SupportContact): boolean {
  return Boolean(support.email || support.phone);
}

/**
 * How to reach the platform owner (help page, inactive-venue screen): the contact details the owner
 * configured in platform settings, or an honest pointer to the administrator when there are none.
 */
export function SupportContactDetails({ support, className }: { support: SupportContact; className?: string }) {
  if (!hasSupportContact(support)) {
    return (
      <p className={cn("text-sm text-fg-muted text-pretty", className)}>
        Ask your {PLATFORM_NAME} administrator. They manage your venue&apos;s music, genres and announcements.
      </p>
    );
  }
  const tel = support.phone ? telHref(support.phone) : null;
  return (
    <ul className={cn("grid gap-2 text-sm", className)}>
      {support.email && (
        <li className="flex min-w-0 items-center gap-3">
          <Mail aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
          <a
            href={`mailto:${support.email}`}
            className="truncate rounded-sm font-medium text-accent-text underline-offset-4 hover:underline"
          >
            <span className="sr-only">Email </span>
            {support.email}
          </a>
        </li>
      )}
      {support.phone && (
        <li className="flex min-w-0 items-center gap-3">
          <Phone aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
          {tel ? (
            <a href={tel} className="truncate rounded-sm font-medium text-accent-text underline-offset-4 hover:underline">
              <span className="sr-only">Phone </span>
              {support.phone}
            </a>
          ) : (
            <span className="truncate font-medium text-fg">{support.phone}</span>
          )}
        </li>
      )}
    </ul>
  );
}
