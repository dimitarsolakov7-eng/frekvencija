"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { CAFE_CENTRAL_ID, EMERALDBAR_ID, parseListState, PREVIEW_BASE_PATH, RESTAURANT_OLIVE_ID, type PreviewListState } from "./fixtures";

const VIEWS: readonly { label: string; href: string }[] = [
  { label: "List", href: PREVIEW_BASE_PATH },
  { label: "EmeraldBar (Active)", href: `${PREVIEW_BASE_PATH}/${EMERALDBAR_ID}` },
  { label: "Access tab", href: `${PREVIEW_BASE_PATH}/${EMERALDBAR_ID}?tab=access` },
  { label: "Announcements tab", href: `${PREVIEW_BASE_PATH}/${EMERALDBAR_ID}?tab=announcements` },
  { label: "Café Central (Invited)", href: `${PREVIEW_BASE_PATH}/${CAFE_CENTRAL_ID}` },
  { label: "Restaurant Olive (Inactive)", href: `${PREVIEW_BASE_PATH}/${RESTAURANT_OLIVE_ID}` },
  { label: "Just created", href: `${PREVIEW_BASE_PATH}/${CAFE_CENTRAL_ID}?created=1` },
  { label: "Add business", href: `${PREVIEW_BASE_PATH}/new` },
  { label: "Add from request", href: `${PREVIEW_BASE_PATH}/new?fromRequest=1` },
  { label: "Access requests", href: `${PREVIEW_BASE_PATH}/requests` },
  { label: "Request conflicts", href: `${PREVIEW_BASE_PATH}/requests?conflict=1` },
  { label: "Unknown venue", href: `${PREVIEW_BASE_PATH}/00000000-0000-4000-8000-000000000000` },
];

const LIST_STATES: readonly { value: PreviewListState; label: string }[] = [
  { value: "default", label: "Fixtures" },
  { value: "empty", label: "No businesses" },
  { value: "error", label: "Load error" },
  { value: "nokey", label: "No secret key" },
];

/** The preview's own navigation: the views of screen 06 and the list states (`?list=`). */
export function PreviewVariants() {
  const pathname = usePathname() ?? PREVIEW_BASE_PATH;
  const listState = parseListState(useSearchParams()?.get("list"));

  return (
    <nav aria-label="Preview variants" className="mb-6 grid gap-2 rounded-card border border-dashed border-border-strong px-4 py-3 text-xs">
      <span className="font-semibold text-fg">Dev preview · fixtures only, nothing is saved</span>
      <div className="flex flex-wrap gap-2">
        {VIEWS.map((view) => (
          <Link
            key={view.href}
            href={(listState === "default" ? view.href : `${view.href}${view.href.includes("?") ? "&" : "?"}list=${listState}`) as Route}
            className="rounded-full border border-border px-2.5 py-1 text-fg-muted transition-colors hover:text-fg"
          >
            {view.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-subtle">List:</span>
        {LIST_STATES.map((state) => (
          <Link
            key={state.value}
            href={`${pathname}${state.value === "default" ? "" : `?list=${state.value}`}` as Route}
            aria-current={state.value === listState ? "page" : undefined}
            className={cn(
              "rounded-full border px-2.5 py-1 transition-colors",
              state.value === listState ? "border-accent/50 bg-accent/15 text-fg" : "border-border text-fg-muted hover:text-fg",
            )}
          >
            {state.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
