"use client";

import { useRef, type ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { ArrowLeft, Plus, RotateCcw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { PageHeading } from "@/components/shell/PageHeading";
import { Alert, Button, ButtonLink } from "@/components/ui";
import type { AdminBusinessList } from "@/lib/data/admin/businesses";
import { cn } from "@/lib/utils/cn";
import type { BusinessDirectoryActions } from "./action-types";
import { BusinessActionsProvider, selectedSegment } from "./BusinessActionDialogs";
import { BusinessList } from "./BusinessList";
import { useDirectoryFocus } from "./detail-focus";

export interface BusinessesDirectoryProps {
  /** The venues, or null when they could not be loaded. */
  list: AdminBusinessList | null;
  newRequestCount: number | null;
  /** "/admin/businesses" (the development preview passes its own route). */
  basePath: string;
  /** "/admin/announcements" (the venue is added as ?business=<id>). */
  announcementsPath: string;
  actions: BusinessDirectoryActions;
  /** Why invitations and resets can't be sent (no secret key), or null. */
  accessUnavailableReason: string | null;
  /** The detail column: the selected venue, the add form or a placeholder. */
  children: ReactNode;
}

function RetryButton() {
  const router = useRouter();
  return (
    <Button variant="secondary" size="sm" icon={<RotateCcw aria-hidden="true" />} onClick={() => router.refresh()}>
      Try again
    </Button>
  );
}

/**
 * Screen 06 master–detail: heading, the business list, and the detail column (desktop ≥1024px:
 * list left, sticky detail panel right). Below 1024px one column shows at a time: the list, or the
 * selected venue / add form with "Back to list"; focus follows the switch (the detail's heading, or
 * the venue's row on the way back). Unsaved edits are guarded by the admin-wide guard (AdminShell).
 */
export function BusinessesDirectory({
  list,
  newRequestCount,
  basePath,
  announcementsPath,
  actions,
  accessUnavailableReason,
  children,
}: BusinessesDirectoryProps) {
  const pathname = usePathname();
  const selected = selectedSegment(pathname, basePath);
  const selectedId = selected && selected !== "new" && selected !== "requests" ? selected : null;
  const showsDetail = selected !== null;
  const listRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  useDirectoryFocus(selected, listRef, detailRef);

  return (
    <BusinessActionsProvider
      actions={actions}
      basePath={basePath}
      announcementsPath={announcementsPath}
      accessUnavailableReason={accessUnavailableReason}
    >
      <PageHeading
        title="Businesses"
        description="A personal station for every space."
        actions={
          <ButtonLink href={`${basePath}/new` as Route} icon={<Plus aria-hidden="true" />} size="lg">
            Add business
          </ButtonLink>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section
          ref={listRef}
          aria-label="Business list"
          tabIndex={-1}
          className={cn("min-w-0 focus:outline-none", showsDetail && "hidden lg:block")}
        >
          {list ? (
            <BusinessList
              items={list.items}
              statusNote={list.statusNote}
              selectedId={selectedId}
              basePath={basePath}
              requestsHref={`${basePath}/requests`}
              newRequestCount={newRequestCount}
            />
          ) : (
            <Alert
              tone="danger"
              title="The businesses couldn’t be loaded"
              description="The database didn’t answer as expected. Nothing was changed. Try again in a moment."
              action={<RetryButton />}
            />
          )}
        </section>

        <div
          ref={detailRef}
          className={cn(
            "grid min-w-0 content-start gap-3",
            "lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain lg:rounded-card",
            !showsDetail && "hidden lg:grid",
          )}
        >
          {showsDetail && (
            <Link
              href={basePath as Route}
              scroll={false}
              className="inline-flex min-h-11 w-fit items-center gap-2 rounded-control text-sm font-medium text-fg-muted hover:text-fg lg:hidden"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to list
            </Link>
          )}
          {children}
        </div>
      </div>
    </BusinessActionsProvider>
  );
}
