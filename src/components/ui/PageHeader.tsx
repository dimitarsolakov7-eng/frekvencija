import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

export interface BreadcrumbItem {
  label: string;
  /** Omit for the current page (rendered as plain text with aria-current). */
  href?: Route;
}

/** "Businesses / EmeraldBar / Announcements" trail (screen 07). */
export function Breadcrumbs({ items, className }: { items: readonly BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted sm:text-[0.9375rem]">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${index}-${item.label}`} className="flex min-w-0 items-center gap-2">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="truncate rounded-sm underline-offset-4 transition-colors hover:text-fg hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className={cn("truncate", isLast && "text-fg")}>
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden="true" className="text-fg-subtle">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  /** Small uppercase label above the title, e.g. "Your station". Write it in sentence case. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Primary page actions, right-aligned on wide screens. */
  actions?: ReactNode;
  breadcrumbs?: readonly BreadcrumbItem[];
  /** Rendered under the title block, e.g. <NavTabs>. */
  children?: ReactNode;
  /** Heading element; default h1 (one per page). */
  as?: "h1" | "h2";
  /** id for the heading, e.g. to label a region with aria-labelledby. */
  titleId?: string;
  className?: string;
}

/**
 * Page title block (screens 03–08): optional breadcrumbs and eyebrow, the page's single <h1>
 * (30px mobile → 42px desktop), a one-line description and right-aligned actions.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  breadcrumbs,
  children,
  as: Heading = "h1",
  titleId,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("grid gap-5 pb-6 lg:pb-8", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid min-w-0 gap-1.5">
          {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} className="mb-1" />}
          {eyebrow && <p className="eyebrow text-fg-muted">{eyebrow}</p>}
          <Heading id={titleId} className="page-title text-fg">
            {title}
          </Heading>
          {description && <div className="max-w-2xl text-base text-fg-muted text-pretty sm:text-lg">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pb-1">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
