import type { Metadata, Route } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/admin/shell";
import { isBusinessDetailTab } from "@/components/admin/businesses/detail-tabs";
import { cn } from "@/lib/utils/cn";
import { BusinessesPreview, type PreviewListState } from "../BusinessesPreview";
import { CAFE_CENTRAL_ID, EMERALDBAR_ID, PREVIEW_BASE_PATH, RESTAURANT_OLIVE_ID } from "../fixtures";

export const metadata: Metadata = { title: "Businesses preview" };

// Reads the view from the URL on every request.
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseListState(value: string | undefined): PreviewListState {
  return value === "empty" || value === "error" || value === "nokey" ? value : "default";
}

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
  { label: "Unknown venue", href: `${PREVIEW_BASE_PATH}/00000000-0000-4000-8000-000000000000` },
];

const LIST_STATES: readonly { value: PreviewListState; label: string }[] = [
  { value: "default", label: "Fixtures" },
  { value: "empty", label: "No businesses" },
  { value: "error", label: "Load error" },
  { value: "nokey", label: "No secret key" },
];

/**
 * Development-only preview of screen 06 (/dev/preview/businesses[/<id>|/new|/requests]): the real
 * business list, detail panel, add form and access-request list inside the admin shell, with the
 * design's example venues and no-op actions, so it can be reviewed at 1440/768/390 px without
 * Supabase. `?list=empty|error|nokey` picks a list state. The /dev layout returns 404 in production.
 */
export default async function BusinessesPreviewPage({ params, searchParams }: PageProps<"/dev/preview/businesses/[[...slug]]">) {
  const { slug } = await params;
  const query = await searchParams;
  const segment = slug?.[0] ?? "";
  const listState = parseListState(first(query.list));
  const tab = first(query.tab);
  const currentPath = slug && slug.length > 0 ? `${PREVIEW_BASE_PATH}/${slug.join("/")}` : PREVIEW_BASE_PATH;

  return (
    <AdminShell email="admin@frekvencija.online">
      <nav
        aria-label="Preview variants"
        className="mb-6 grid gap-2 rounded-card border border-dashed border-border-strong px-4 py-3 text-xs"
      >
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
              href={`${currentPath}${state.value === "default" ? "" : `?list=${state.value}`}` as Route}
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
      <BusinessesPreview
        key={listState}
        segment={segment}
        listState={listState}
        tab={isBusinessDetailTab(tab) ? tab : "profile"}
        fromRequest={first(query.fromRequest) !== undefined}
        created={first(query.created) === "1"}
      />
    </AdminShell>
  );
}
